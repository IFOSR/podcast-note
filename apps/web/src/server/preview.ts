import type { Watch } from "../../../../packages/core/src/types.ts";
import { createCodexInsightProvider, createVolcengineTranscriptProvider } from "../../../../packages/ai/src/index.ts";
import { createRepositories, openPodcastNoteDb } from "../../../../packages/db/src/index.ts";
import {
  createLocalSession,
  getInboxView,
  getSessionContext,
  listWatchCards,
  recordInsightFeedback,
  type SessionContext
} from "./m1-app.ts";
import { processSourceInputs } from "../../../worker/src/process-sources.ts";

const options = parseArgs(process.argv.slice(2));
const port = Number(options["port"] ?? process.env["PORT"] ?? 3000);
const host = options["host"] ?? process.env["HOST"] ?? "127.0.0.1";
const dbPath = options["db"] ?? process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite";
const token = options["token"] ?? process.env["PODCAST_NOTE_SESSION_TOKEN"] ?? "local-dev-token";
const now = new Date().toISOString();
const db = openPodcastNoteDb(dbPath);
const repos = createRepositories(db);
const session = createLocalSession({
  repositories: repos,
  user: {
    id: "user_local_preview",
    email: "local-preview@example.invalid",
    name: "Local Preview",
    timezone: "Asia/Shanghai"
  },
  token,
  now,
  expiresAt: "2099-01-01T00:00:00.000Z"
});
const context = getSessionContext({ repositories: repos, token, now }) ?? { session, user: session.user, workspace: session.workspace };

const server = Bun.serve({
  hostname: host,
  port,
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") {
        return json({ ok: true, app: "podcast-note", dbPath, workspaceId: context.workspace.id });
      }
      if (url.pathname === "/api/summary") {
        return json(summary(context));
      }
      if (url.pathname === "/api/agent-status") {
        return json({ ok: true, agentRun: latestAgentRun(context) });
      }
      if (url.pathname === "/api/run-once" && request.method === "POST") {
        throw new Error("Web 已禁用旧 run-once mock 队列。请使用“处理一个播客链接”或“监控一个目标”，它们会调用真实转录和真实 insight provider。");
      }
      if (url.pathname === "/api/process-link" && request.method === "POST") {
        const form = await request.formData();
        const podcastUrl = stringField(form, "podcastUrl");
        const result = await processWithRealProviders({
          context,
          name: titleFromInput(podcastUrl, "单次播客处理"),
          topic: stringField(form, "keywords") || podcastUrl,
          mustInclude: termsFromText(stringField(form, "keywords")),
          sources: [podcastUrl],
          maxEpisodesPerSource: 1
        });
        return redirect(`/?notice=${encodeURIComponent(`真实处理完成：处理 ${result.length} 集播客`)}`);
      }
      if (url.pathname === "/api/monitor-target" && request.method === "POST") {
        const form = await request.formData();
        const target = stringField(form, "target");
        const keywords = stringField(form, "keywords");
        const result = await processWithRealProviders({
          context,
          name: titleFromInput(target, "目标监控"),
          topic: keywords || target,
          mustInclude: termsFromText(keywords),
          sources: [monitorQuery(target, keywords)],
          maxEpisodesPerSource: Math.min(numberField(form, "maxEpisodes", 3), 10)
        });
        return redirect(`/?notice=${encodeURIComponent(`真实监控处理完成：处理 ${result.length} 集播客`)}`);
      }
      if (url.pathname === "/api/watches" && request.method === "POST") {
        const form = await request.formData();
        createWatch({
          repositories: repos,
          context,
          input: {
            name: stringField(form, "name"),
            query: stringField(form, "query"),
            includeTerms: stringField(form, "includeTerms"),
            excludeTerms: stringField(form, "excludeTerms"),
            minRelevanceScore: numberField(form, "minRelevanceScore", 0.6),
            frequency: frequencyField(form, "frequency"),
            backfillDays: numberField(form, "backfillDays", 30),
            outputLanguage: "zh-CN",
            enabled: true
          }
        });
        return redirect("/?notice=已添加关注主题");
      }
      if (url.pathname === "/api/feedback" && request.method === "POST") {
        const form = await request.formData();
        const action = stringField(form, "action") === "irrelevant" ? "irrelevant" : "saved";
        recordInsightFeedback({ repositories: repos, context, insightId: stringField(form, "insightId"), action });
        return redirect(`/?notice=${encodeURIComponent(action === "saved" ? "已保存" : "已标记没用")}`);
      }
      if (url.pathname === "/") {
        return html(renderHome(context, url.searchParams.get("notice")));
      }
      return html(renderNotFound(url.pathname), 404);
    } catch (error) {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      return html(renderError(error), 500);
    }
  }
});

console.log(JSON.stringify({ ok: true, message: "Podcast Note preview server started", url: `http://${host}:${server.port}`, dbPath, workspaceId: context.workspace.id }, null, 2));

async function processWithRealProviders(input: {
  context: SessionContext;
  name: string;
  topic: string;
  mustInclude: string[];
  sources: string[];
  maxEpisodesPerSource: number;
}) {
  assertRealProcessingConfigured();
  return processSourceInputs({
    options: {
      watch: {
        workspaceId: input.context.workspace.id,
        name: input.name,
        topic: input.topic,
        language: "zh-CN",
        mustInclude: input.mustInclude
      },
      sources: { sources: input.sources },
      outputDir: "outputs/web-preview",
      maxEpisodesPerSource: input.maxEpisodesPerSource
    },
    transcriptProvider: createVolcengineTranscriptProvider(),
    insightProvider: createCodexInsightProvider(),
    repositories: repos
  });
}

function assertRealProcessingConfigured(): void {
  const hasVolcengineAuth = Boolean(process.env["VOLCENGINE_ASR_API_KEY"] || process.env["VOLCENGINE_ASR_APP_ID"]);
  const hasVolcengineToken = Boolean(process.env["VOLCENGINE_ASR_API_KEY"] || process.env["VOLCENGINE_ASR_ACCESS_TOKEN"]);
  if (!hasVolcengineAuth || !hasVolcengineToken) {
    throw new Error("真实处理未配置：需要 VOLCENGINE_ASR_API_KEY，或同时提供 VOLCENGINE_ASR_APP_ID 和 VOLCENGINE_ASR_ACCESS_TOKEN。Web 不再使用 mock 数据。");
  }
}

function monitorQuery(target: string, keywords: string): string {
  if (isHttpUrl(target)) return target;
  return [target, keywords].filter(Boolean).join(" ");
}

function titleFromInput(input: string, fallback: string): string {
  if (!input) return fallback;
  if (!isHttpUrl(input)) return input.slice(0, 40);
  try {
    const url = new URL(input);
    return url.hostname.replace(/^www\./, "") || input.slice(0, 40);
  } catch {
    return input.slice(0, 40);
  }
}

function isHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

function termsFromText(input: string): string[] {
  return input.split(/[,，\n]/).map((term) => term.trim()).filter(Boolean);
}

function summary(context: SessionContext) {
  const watches = listWatchCards({ repositories: repos, context });
  const inbox = getInboxView({ repositories: repos, context, limit: 20 });
  const episodeReports = [...new Set(inbox.items.map((item) => item.episodeId))]
    .map((episodeId) => repos.getEpisodeDetailForWorkspace({
      workspaceId: context.workspace.id,
      userId: context.user.id,
      episodeId
    }))
    .filter((report) => report !== undefined);
  const usageEvents = repos.listUsageEvents({ workspaceId: context.workspace.id, userId: context.user.id, limit: 20 });
  return {
    ok: true,
    workspace: context.workspace,
    user: context.user,
    watches,
    inbox: inbox.items,
    episodeReports,
    agentRun: latestAgentRun(context),
    usageEventCount: usageEvents.length
  };
}

type AgentRun = {
  id: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  sources: string[];
  currentStage?: string;
  currentStageStatus?: string;
  currentStageError?: string;
  updatedAt?: string;
};

function latestAgentRun(context: SessionContext): AgentRun | undefined {
  const row = db.query(`
    select pr.*
    from processing_runs pr
    join watches w on w.id = pr.watch_id
    where w.workspace_id = ?
    order by pr.started_at desc, pr.id desc
    limit 1
  `).get(context.workspace.id) as Record<string, unknown> | null;
  if (!row) return undefined;
  const status = db.query(`
    select * from processing_episode_statuses
    where run_id = ?
    order by updated_at desc
    limit 1
  `).get(String(row["id"])) as Record<string, unknown> | null;
  return {
    id: String(row["id"]),
    status: String(row["status"]),
    startedAt: optionalString(row["started_at"]),
    finishedAt: optionalString(row["finished_at"]),
    error: optionalString(row["error"]),
    sources: parseJsonArray(row["input_sources_json"]),
    currentStage: status ? String(status["stage"]) : undefined,
    currentStageStatus: status ? String(status["status"]) : undefined,
    currentStageError: status ? optionalString(status["error"]) : undefined,
    updatedAt: status ? optionalString(status["updated_at"]) : undefined
  };
}

function renderHome(context: SessionContext, notice?: string | null): string {
  const data = summary(context);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Podcast Note 本地试用</title>
  <style>
    :root { color-scheme: light; --bg: #f5f7fb; --card: #ffffff; --text: #172033; --muted: #667085; --line: #e5e7eb; --blue: #2563eb; --blue-soft: #eff6ff; --green: #047857; --red: #b42318; --ink: #0f172a; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: radial-gradient(circle at top left, #e0f2fe, transparent 32rem), var(--bg); color: var(--text); }
    main { max-width: 1060px; margin: 0 auto; padding: 30px 18px 56px; }
    header { margin-bottom: 22px; }
    h1 { font-size: 34px; margin: 0 0 8px; letter-spacing: -0.035em; color: var(--ink); }
    h2 { font-size: 19px; margin: 0 0 8px; color: var(--ink); }
    h3 { font-size: 16px; margin: 0 0 8px; }
    p { line-height: 1.55; }
    .muted { color: var(--muted); }
    .small { font-size: 13px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; background: var(--blue-soft); color: #1d4ed8; font-weight: 700; font-size: 12px; }
    .notice { margin: 0 0 16px; padding: 12px 14px; border: 1px solid #bfdbfe; background: #eff6ff; color: #1e40af; border-radius: 12px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(280px, 1fr)); gap: 16px; align-items: start; }
    .stack { display: grid; gap: 16px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 18px; box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06); }
    label { display: block; font-weight: 700; font-size: 13px; margin: 12px 0 6px; }
    input, select { width: 100%; border: 1px solid #d0d5dd; border-radius: 12px; padding: 11px 12px; font: inherit; background: white; color: var(--text); }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    button, .button { display: inline-flex; justify-content: center; align-items: center; border: 0; border-radius: 10px; padding: 10px 14px; background: var(--blue); color: white; font-weight: 800; text-decoration: none; cursor: pointer; }
    button[disabled] { cursor: wait; opacity: 0.58; filter: grayscale(0.2); }
    .spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.5); border-top-color: white; border-radius: 999px; margin-right: 8px; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .secondary { background: #f2f4f7; color: #344054; border: 1px solid #d0d5dd; }
    .danger { background: #fff1f0; color: var(--red); border: 1px solid #fecdca; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .watch { padding: 12px; border: 1px solid var(--line); border-radius: 14px; margin-top: 10px; background: #fcfcfd; }
    .pill { display: inline-block; padding: 3px 8px; border-radius: 999px; background: #ecfdf3; color: var(--green); font-size: 12px; font-weight: 800; }
    .pill.paused { background: #f2f4f7; color: #475467; }
    .empty { border: 1px dashed #cbd5e1; border-radius: 16px; padding: 18px; background: #f8fafc; }
    .agent-panel { border: 1px solid #c7d2fe; background: linear-gradient(180deg, #ffffff, #f8fbff); }
    .agent-steps { display: grid; gap: 10px; margin: 14px 0 0; padding: 0; list-style: none; }
    .agent-step { display: grid; grid-template-columns: 28px 1fr; gap: 10px; align-items: start; padding: 10px; border: 1px solid #e5e7eb; border-radius: 14px; background: #ffffff; }
    .step-dot { width: 22px; height: 22px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; background: #e5e7eb; color: #475467; font-size: 12px; font-weight: 900; }
    .agent-step.done .step-dot { background: #dcfce7; color: #047857; }
    .agent-step.active .step-dot { background: #dbeafe; color: #1d4ed8; animation: pulse 1.2s ease-in-out infinite; }
    .agent-step.failed .step-dot { background: #fee2e2; color: #b42318; }
    .agent-step strong { display: block; margin-bottom: 3px; }
    .agent-live { display: none; margin-top: 10px; color: #1d4ed8; font-weight: 800; }
    .agent-live.active { display: block; }
    @keyframes pulse { 50% { transform: scale(1.08); } }
    .report { border: 1px solid #bfdbfe; background: #ffffff; border-radius: 18px; padding: 18px; margin-bottom: 16px; }
    .report-head { display: grid; gap: 8px; margin-bottom: 14px; }
    .report-title { font-size: 22px; margin: 0; letter-spacing: -0.02em; }
    .player { display: grid; gap: 8px; padding: 12px; border: 1px solid #dbeafe; border-radius: 14px; background: #f8fbff; }
    .player audio { width: 100%; }
    .seek { border: 1px solid #bfdbfe; background: #eff6ff; color: #1d4ed8; padding: 4px 8px; border-radius: 999px; font-size: 12px; font-weight: 900; cursor: pointer; }
    .seek:hover { background: #dbeafe; }
    .summary-box { display: grid; gap: 10px; background: #f8fbff; border: 1px solid #dbeafe; border-radius: 14px; padding: 14px; margin: 12px 0; }
    .summary-box p { margin: 0; }
    .section-title { margin: 18px 0 10px; font-size: 15px; color: #0f172a; }
    .chapters { display: grid; gap: 8px; padding: 0; margin: 0; list-style: none; }
    .chapter { border: 1px solid #e5e7eb; border-radius: 12px; padding: 10px 12px; background: #fcfcfd; }
    .chapter strong { display: block; margin-bottom: 4px; }
    .timestamp { font-variant-numeric: tabular-nums; color: #1d4ed8; font-weight: 800; }
    .entity-list { display: flex; gap: 8px; flex-wrap: wrap; }
    .entity { padding: 4px 8px; border-radius: 999px; background: #f2f4f7; color: #344054; font-size: 12px; font-weight: 700; }
    .insight { border: 1px solid #dbeafe; background: #ffffff; border-radius: 16px; padding: 16px; margin-bottom: 14px; }
    .insight.compact { margin-bottom: 10px; background: #fdfefe; }
    .score { color: #1d4ed8; font-weight: 800; }
    .meta { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0 12px; }
    .quote { border-left: 4px solid #93c5fd; padding: 10px 12px; background: #f8fbff; border-radius: 8px; color: #344054; }
    code { background: #eef2ff; color: #344054; border-radius: 6px; padding: 1px 5px; }
    pre { background: #101828; color: #f9fafb; border-radius: 12px; padding: 12px; overflow: auto; }
    .full { margin-top: 16px; }
    details.helper { margin-top: 16px; border: 1px dashed #d0d5dd; background: #fcfcfd; color: #475467; }
    details.helper summary { cursor: pointer; font-weight: 800; color: #344054; }
    details.helper ul { margin: 10px 0 0; padding-left: 20px; }
    details.helper code { background: #f2f4f7; color: #344054; }
    a { color: #1d4ed8; }
    @media (max-width: 820px) { header, .grid, .row { grid-template-columns: 1fr; display: grid; } }
  </style>
</head>
<body>
<main>
  <header>
    <span class="badge">Local preview</span>
    <h1>Podcast Note</h1>
    <p class="muted">现在只保留两个入口：处理一个具体播客链接，或监控一个目标站点/平台和关键词。</p>
  </header>
  ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ""}
  <div class="grid">
    <section class="card">
      <h2>1. 处理一个播客链接</h2>
      <p class="muted small">粘贴 RSS、Apple Podcasts、Spotify、YouTube、小宇宙、Listen Notes 或单集页面链接。提交后会立即处理一次。</p>
      <form method="post" action="/api/process-link" data-processing-form>
        <label for="podcastUrl">播客链接</label>
        <input id="podcastUrl" name="podcastUrl" placeholder="https://example.com/feed.xml" required />
        <label for="linkKeywords">关键词（可选）</label>
        <input id="linkKeywords" name="keywords" placeholder="AI agent, product, workflow" />
        <p><button type="submit" data-idle-label="立即处理" data-busy-label="正在处理">立即处理</button></p>
      </form>
    </section>
    <section class="card">
      <h2>2. 监控一个目标</h2>
      <p class="muted small">填写目标站点、平台、播客名或域名，再填关键词。系统会创建监控并立即尝试找到可处理的 URL。</p>
      <form method="post" action="/api/monitor-target" data-processing-form>
        <label for="target">目标站点 / 平台 / 播客名</label>
        <input id="target" name="target" placeholder="小宇宙 / Apple Podcasts / listen notes / example.com" required />
        <label for="monitorKeywords">关键词</label>
        <input id="monitorKeywords" name="keywords" placeholder="AI组织, agent workflow" required />
        <div class="row">
          <div><label for="frequency">频率</label><select id="frequency" name="frequency"><option value="daily">每天</option><option value="weekly">每周</option><option value="realtime">实时</option></select></div>
          <div><label for="backfillDays">回看天数</label><input id="backfillDays" name="backfillDays" type="number" min="1" value="30" /></div>
        </div>
        <p><button type="submit" data-idle-label="开始监控" data-busy-label="正在监控">开始监控</button></p>
      </form>
    </section>
  </div>
  <section class="card full">
    <h2>监控中</h2>
    ${renderWatches(data.watches)}
  </section>
  <section class="card full agent-panel" id="agent-status">
    <h2>Agent 执行过程</h2>
    ${renderAgentRun(data.agentRun)}
  </section>
  <section class="card full">
    <h2>结果</h2>
    ${renderResults(data.episodeReports)}
  </section>
</main>
<script>
  const stageLabels = {
    submitted: ["接收任务", "读取你提交的播客链接或监控目标。"],
    resolving: ["解析来源", "识别平台、抓取公开页面或 RSS，并找到可处理的单集。"],
    resolved: ["解析来源", "识别平台、抓取公开页面或 RSS，并找到可处理的单集。"],
    transcribing: ["转写音频", "把公开音频交给火山引擎 ASR，生成带时间戳的转录文本。"],
    transcribed: ["转写音频", "把公开音频交给火山引擎 ASR，生成带时间戳的转录文本。"],
    analyzing: ["提炼内容", "按语义分段，生成总结、章节、核心观点和证据。"],
    analyzed: ["提炼内容", "按语义分段，生成总结、章节、核心观点和证据。"],
    exported: ["生成报告", "保存结果，并在下方结果区展示可核验的单集报告。"],
    failed: ["处理失败", "处理过程中出现错误，页面会显示具体错误。"]
  };

  const orderedStages = ["submitted", "resolved", "transcribing", "analyzing", "exported"];

  document.querySelectorAll("[data-processing-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!(form instanceof HTMLFormElement)) return;
      const button = form.querySelector("button[type='submit']");
      setBusyButton(button, true);
      renderLiveAgentStatus("submitted", "running", "Agent 已接收任务，开始处理。长音频转写和分析可能需要几分钟。");
      try {
        const response = await fetch(form.action, { method: "POST", body: new FormData(form), redirect: "manual" });
        if (response.status >= 300 && response.status < 400) {
          window.location.href = response.headers.get("Location") || "/";
          return;
        }
        if (!response.ok) {
          document.open();
          document.write(await response.text());
          document.close();
          return;
        }
        window.location.reload();
      } catch (error) {
        renderLiveAgentStatus("failed", "failed", error instanceof Error ? error.message : String(error));
        setBusyButton(button, false);
      }
    });
  });

  function setBusyButton(button, busy) {
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = busy;
    button.innerHTML = busy
      ? '<span class="spinner"></span>' + (button.getAttribute("data-busy-label") || "处理中")
      : (button.getAttribute("data-idle-label") || "提交");
  }

  function renderLiveAgentStatus(stage, status, message) {
    const panel = document.getElementById("agent-status");
    if (!panel) return;
    panel.innerHTML = '<h2>Agent 执行过程</h2>' + agentStatusHtml(stage, status, message, true);
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function agentStatusHtml(stage, status, message, live) {
    const stageIndex = orderedStages.indexOf(stage);
    const normalizedIndex = stageIndex >= 0 ? stageIndex : 0;
    const steps = orderedStages.map((item, index) => {
      const [title, description] = stageLabels[item];
      const state = status === "failed" && index === normalizedIndex ? "failed" : index < normalizedIndex || status === "completed" ? "done" : index === normalizedIndex ? "active" : "";
      return '<li class="agent-step ' + state + '"><span class="step-dot">' + (state === "done" ? "✓" : index + 1) + '</span><div><strong>' + title + '</strong><span class="muted small">' + description + '</span></div></li>';
    }).join("");
    return '<p class="muted">' + message + '</p><p class="agent-live active">处理中，请不要重复提交。完成后页面会自动刷新。</p><ol class="agent-steps">' + steps + '</ol>';
  }

  document.addEventListener("click", (event) => {
    const button = event.target instanceof HTMLElement ? event.target.closest("[data-seek]") : null;
    if (!(button instanceof HTMLElement)) return;
    const playerId = button.getAttribute("data-player");
    const seconds = Number(button.getAttribute("data-seek"));
    const player = playerId ? document.getElementById(playerId) : null;
    if (!(player instanceof HTMLAudioElement) || !Number.isFinite(seconds)) return;
    player.currentTime = Math.max(0, seconds);
    player.play().catch(() => {});
    player.scrollIntoView({ behavior: "smooth", block: "center" });
  });
</script>
</body>
</html>`;
}

function renderResults(reports: ReturnType<typeof summary>["episodeReports"]): string {
  if (reports.length === 0) {
    return `<div class="empty"><h3>还没有结果</h3><p class="muted">提交一个播客链接，或创建一个目标监控后，这里会显示单集总结、章节、核心观点和证据。</p></div>`;
  }
  return reports.map(renderEpisodeReport).join("");
}

function renderAgentRun(run: ReturnType<typeof summary>["agentRun"]): string {
  const stage = run?.currentStage ?? (run ? "submitted" : "submitted");
  const status = run?.status === "completed" ? "completed" : run?.status === "failed" ? "failed" : run ? "running" : "idle";
  const currentIndex = Math.max(0, agentStageIndex(stage));
  const message = run
    ? agentRunMessage(run, status)
    : "还没有执行记录。提交一个播客链接或监控目标后，这里会显示 Agent 的实时处理步骤。";
  const steps = agentStages.map((item, index) => {
    const state = status === "failed" && index === currentIndex
      ? "failed"
      : status === "completed" || index < currentIndex
        ? "done"
        : status === "running" && index === currentIndex
          ? "active"
          : "";
    return `<li class="agent-step ${state}"><span class="step-dot">${state === "done" ? "✓" : index + 1}</span><div><strong>${escapeHtml(item.title)}</strong><span class="muted small">${escapeHtml(item.description)}</span></div></li>`;
  }).join("");
  return `<p class="muted">${escapeHtml(message)}</p>${status === "running" ? `<p class="agent-live active">处理中，请不要重复提交。长音频转写和内容分析可能需要几分钟。</p>` : ""}<ol class="agent-steps">${steps}</ol>`;
}

const agentStages = [
  { key: "submitted", title: "接收任务", description: "读取你提交的播客链接或监控目标。" },
  { key: "resolved", title: "解析来源", description: "识别平台、抓取公开页面或 RSS，并找到可处理的单集和音频直链。" },
  { key: "transcribing", title: "转写音频", description: "把公开音频交给火山引擎 ASR，生成带时间戳的转录文本。" },
  { key: "analyzing", title: "提炼内容", description: "按语义分段，生成总结、章节、核心观点和证据。" },
  { key: "exported", title: "生成报告", description: "保存结果，并在下方结果区展示可核验的单集报告。" }
] as const;

function agentStageIndex(stage: string): number {
  if (stage === "transcribed") return 2;
  if (stage === "analyzed") return 3;
  if (stage === "failed") return 4;
  return agentStages.findIndex((item) => item.key === stage);
}

function agentRunMessage(run: AgentRun, status: string): string {
  const source = run.sources[0] ? `输入：${run.sources[0]}` : "输入已记录";
  if (status === "completed") return `${source}。最近一次处理已完成：已解析来源、转写音频、提炼内容并生成报告。`;
  if (status === "failed") return `${source}。处理失败：${run.error ?? run.currentStageError ?? "未知错误"}`;
  return `${source}。当前阶段：${stageLabel(run.currentStage)}。`;
}

function stageLabel(stage?: string): string {
  if (!stage) return "接收任务";
  if (stage === "resolved") return "解析来源完成";
  if (stage === "transcribing") return "正在转写音频";
  if (stage === "transcribed") return "转写完成";
  if (stage === "analyzing") return "正在提炼内容";
  if (stage === "analyzed") return "内容提炼完成";
  if (stage === "exported") return "报告已生成";
  if (stage === "failed") return "处理失败";
  return stage;
}

function renderEpisodeReport(report: ReturnType<typeof summary>["episodeReports"][number]): string {
  const summary = report.summary;
  const worthListening = summary?.worthListening;
  const entities = summary?.entities ?? [];
  const playerId = `player-${safeDomId(report.episode.id)}`;
  return `<article class="report">
    <div class="report-head">
      <div class="meta"><span class="pill">${escapeHtml(report.source?.title ?? report.source?.type ?? "播客")}</span><span class="pill paused">${escapeHtml(report.transcript?.language ?? report.episode.language ?? "unknown")}</span>${report.player.durationSec ? `<span class="pill paused">${escapeHtml(formatDuration(report.player.durationSec))}</span>` : ""}</div>
      <h3 class="report-title">${escapeHtml(report.episode.title)}</h3>
      ${report.episode.description ? `<p class="muted">${escapeHtml(report.episode.description)}</p>` : ""}
      <div class="actions"><a class="button secondary" href="${escapeHtml(report.player.pageUrl)}" target="_blank" rel="noreferrer">打开原文</a>${report.player.audioUrl ? `<a class="button secondary" href="${escapeHtml(report.player.audioUrl)}" target="_blank" rel="noreferrer">打开音频</a>` : ""}</div>
    </div>
    ${report.player.audioUrl ? `<div class="player"><strong>音频核验</strong><audio id="${escapeHtml(playerId)}" controls preload="metadata" src="${escapeHtml(report.player.audioUrl)}"></audio><p class="muted small">点击章节或核心观点旁的时间戳，会跳到对应音频片段播放，用来核对总结和证据是否准确。</p></div>` : `<div class="empty">这集没有可直接播放的公开音频 URL，无法在页面内核验音频片段。</div>`}
    ${summary ? `<div class="summary-box">
      <p><strong>一句话总结：</strong>${escapeHtml(summary.oneLiner)}</p>
      <p><strong>内容总结：</strong>${escapeHtml(summary.overview)}</p>
      ${worthListening ? `<p><strong>是否值得听：</strong>${escapeHtml(recommendationLabel(worthListening.recommendation))}。${escapeHtml(worthListening.reason)}</p>` : ""}
      ${worthListening?.bestSegments?.length ? `<p><strong>推荐跳听：</strong>${worthListening.bestSegments.map((segment) => `${renderSeekButton(playerId, segment.startSec, `${formatTimestamp(segment.startSec)}-${formatTimestamp(segment.endSec)}`)} ${escapeHtml(segment.reason)}`).join("；")}</p>` : ""}
    </div>` : `<div class="empty">这集已经生成核心观点，但还没有 episode-level 总结。</div>`}
    ${entities.length ? `<h4 class="section-title">关键实体</h4><div class="entity-list">${entities.slice(0, 18).map((entity) => `<span class="entity">${escapeHtml(entity.name)}${entity.type ? ` · ${escapeHtml(entity.type)}` : ""}${typeof entity.mentions === "number" ? ` ×${entity.mentions}` : ""}</span>`).join("")}</div>` : ""}
    ${summary?.chapters?.length ? `<h4 class="section-title">章节与段落摘要</h4><ol class="chapters">${summary.chapters.map((chapter) => `<li class="chapter"><strong>${renderSeekButton(playerId, chapter.startSec, formatTimestamp(chapter.startSec))} ${escapeHtml(chapter.title)}</strong><span>${escapeHtml(chapter.summary)}</span></li>`).join("")}</ol>` : ""}
    <h4 class="section-title">核心观点与证据</h4>
    ${report.insights.length ? report.insights.map((item) => renderInsight(item, report.player.pageUrl, playerId)).join("") : `<div class="empty">没有达到发布阈值的核心观点。</div>`}
  </article>`;
}

function renderInsight(item: ReturnType<typeof summary>["episodeReports"][number]["insights"][number], pageUrl: string, playerId: string): string {
  return `<article class="insight compact"><div class="meta">${renderSeekButton(playerId, item.timestampStartSec, `${formatTimestamp(item.timestampStartSec)}-${formatTimestamp(item.timestampEndSec)}`)}<span class="score">相关度 ${Math.round(item.relevanceScore * 100)}%</span>${item.feedbackAction ? `<span class="pill">${feedbackLabel(item.feedbackAction)}</span>` : ""}</div><h3>${escapeHtml(item.claim)}</h3>${item.implication ? `<p><strong>为什么重要：</strong>${escapeHtml(item.implication)}</p>` : ""}<p class="quote"><strong>证据：</strong>${escapeHtml(item.evidenceExcerpt)}</p><div class="actions"><a class="button secondary" href="${escapeHtml(pageUrl)}" target="_blank" rel="noreferrer">打开原文</a><form method="post" action="/api/feedback"><input type="hidden" name="insightId" value="${escapeHtml(item.id)}"/><input type="hidden" name="action" value="saved"/><button type="submit">保存</button></form><form method="post" action="/api/feedback"><input type="hidden" name="insightId" value="${escapeHtml(item.id)}"/><input type="hidden" name="action" value="irrelevant"/><button class="danger" type="submit">没用</button></form></div></article>`;
}

function renderWatches(watches: ReturnType<typeof summary>["watches"]): string {
  if (watches.length === 0) {
    return `<div class="empty">还没有监控。用上面的两个入口提交后会自动创建。</div>`;
  }
  return watches.map((watch) => `<div class="watch"><div class="actions"><strong>${escapeHtml(watch.name)}</strong><span class="pill ${watch.enabled ? "" : "paused"}">${watch.enabled ? "运行中" : "已暂停"}</span></div><p class="muted small">${escapeHtml(watch.query)}</p><p class="small">类型：${escapeHtml(watch.type)} · 关键词：${escapeHtml(watch.includeTermText || "未设置")} · ${escapeHtml(frequencyLabel(watch.frequency))}</p></div>`).join("");
}

function feedbackLabel(action: string): string {
  if (action === "saved") return "已保存";
  if (action === "irrelevant") return "已标记没用";
  if (action === "wrong") return "已标记错误";
  if (action === "archived") return "已归档";
  return action;
}

function frequencyLabel(frequency: Watch["frequency"]): string {
  if (frequency === "realtime") return "实时（M1 本地预览会按每天运行）";
  if (frequency === "weekly") return "每周";
  return "每天";
}

function recommendationLabel(recommendation: string): string {
  if (recommendation === "listen_full") return "建议完整听";
  if (recommendation === "listen_segments") return "建议跳听重点片段";
  if (recommendation === "skip") return "可以跳过";
  return recommendation;
}

function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatDuration(seconds: number): string {
  return `时长 ${formatTimestamp(seconds)}`;
}

function renderSeekButton(playerId: string, seconds: number, label: string): string {
  return `<button class="seek" type="button" data-player="${escapeHtml(playerId)}" data-seek="${escapeHtml(Math.max(0, Math.floor(seconds)))}" title="跳到该音频片段播放">${escapeHtml(label)}</button>`;
}

function safeDomId(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function renderNotFound(pathname: string): string {
  return `<!doctype html><h1>Not found</h1><p>${escapeHtml(pathname)}</p><p><a href="/">Back home</a></p>`;
}

function renderError(error: unknown): string {
  return `<!doctype html><h1>Podcast Note error</h1><pre>${escapeHtml(error instanceof Error ? error.stack ?? error.message : String(error))}</pre><p><a href="/">Back home</a></p>`;
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location: encodeURI(location) } });
}

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    parsed[arg.slice(2)] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
  }
  return parsed;
}

function stringField(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function numberField(form: FormData, name: string, fallback: number): number {
  const value = Number(form.get(name));
  return Number.isFinite(value) ? value : fallback;
}

function frequencyField(form: FormData, name: string): Watch["frequency"] {
  const value = stringField(form, name);
  if (value === "weekly" || value === "realtime") return value;
  return "daily";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
