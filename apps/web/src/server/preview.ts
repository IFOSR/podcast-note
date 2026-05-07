import type { Episode, EpisodeProcessingResult, Insight, Source, Watch } from "../../../../packages/core/src/types.ts";
import { createRepositories, openPodcastNoteDb } from "../../../../packages/db/src/index.ts";
import {
  createLocalSession,
  createWatch,
  getInboxView,
  getSessionContext,
  listWatchCards,
  recordInsightFeedback,
  type SessionContext
} from "./m1-app.ts";

const options = parseArgs(process.argv.slice(2));
const port = Number(options["port"] ?? process.env["PORT"] ?? 3000);
const host = options["host"] ?? process.env["HOST"] ?? "127.0.0.1";
const dbPath = options["db"] ?? process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite";
const token = options["token"] ?? process.env["PODCAST_NOTE_SESSION_TOKEN"] ?? "local-dev-token";
const now = new Date().toISOString();
const repos = createRepositories(openPodcastNoteDb(dbPath));
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
seedDefaultWatch(context);

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
      if (url.pathname === "/api/run-once" && request.method === "POST") {
        const { runM1Once } = await import("../../../worker/src/m1-run-once.ts");
        const result = await runM1Once({ repositories: repos, workspaceId: context.workspace.id });
        return redirect(`/?notice=${encodeURIComponent(`运行完成：发现 ${result.discoveredEpisodes} 集，生成 ${result.insightCount} 条 insight`)}`);
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
      if (url.pathname === "/api/demo" && request.method === "POST") {
        seedDemoInsight(context);
        return redirect("/?notice=已生成示例数据，可以直接试用 Inbox");
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

function seedDefaultWatch(context: SessionContext): Watch {
  const watches = listWatchCards({ repositories: repos, context });
  if (watches.length > 0) return watches[0]!;
  return createWatch({
    repositories: repos,
    context,
    input: {
      name: "AI Agent Workflow",
      type: "topic",
      query: "AI agent workflow",
      outputLanguage: "zh-CN",
      includeTerms: "AI agent, workflow",
      excludeTerms: "sports",
      minRelevanceScore: 0.6,
      frequency: "daily",
      backfillDays: 30
    }
  });
}

function seedDemoInsight(context: SessionContext): void {
  const watch = seedDefaultWatch(context);
  const source: Source = {
    id: "src_local_demo",
    type: "rss",
    url: "https://example.invalid/podcast.xml",
    title: "Podcast Note 示例播客",
    author: "Podcast Note"
  };
  const episode: Episode = {
    id: "episode_local_demo_ai_agent",
    sourceId: source.id,
    guid: "episode_local_demo_ai_agent",
    title: "AI Agent 产品团队如何落地工作流",
    description: "一集用于本地试用的示例播客，展示 Inbox、证据、反馈和原文链接。",
    publishedAt: "2026-05-07T06:00:00.000Z",
    durationSec: 1260,
    audioUrl: "https://example.invalid/demo.mp3",
    pageUrl: "https://example.invalid/demo-ai-agent-workflow",
    language: "zh-CN"
  };
  const insight: Insight = {
    id: "insight_local_demo_ai_agent",
    workspaceId: context.workspace.id,
    watchId: watch.id,
    episodeId: episode.id,
    segmentIndex: 0,
    claim: "AI Agent 产品团队需要把任务拆成可验收的短闭环，而不是只追求一次性全自动。",
    evidenceExcerpt: "团队先把任务拆成检索、执行、验收三个阶段，每个阶段都有可观察输出，再逐步交给 agent 自动处理。",
    reasoning: "这条内容直接对应当前 Watch 的 AI agent workflow 主题，并提供了产品落地方法。",
    implication: "可以优先把 Podcast Note 的试用流程做成“添加关注 → 跑一次 → 看 insight → 反馈”的闭环。",
    timestampStartSec: 120,
    timestampEndSec: 210,
    entities: [{ name: "AI Agent", type: "technology" }, { name: "工作流", type: "method" }],
    relevanceScore: 0.94,
    confidence: 0.91,
    groundednessScore: 0.92,
    outputLanguage: "zh-CN",
    status: "published",
    promptVersion: "local-demo-v1",
    model: "local-demo"
  };
  const result: EpisodeProcessingResult = {
    episode,
    summary: {
      oneLiner: "产品团队落地 AI Agent 时，应先建立短闭环和验收标准。",
      overview: "这集示例内容说明了如何把 AI Agent 工作流拆成可测试、可反馈、可逐步自动化的产品闭环。",
      chapters: [{ title: "短闭环", startSec: 120, endSec: 210, summary: "先拆阶段，再自动化。" }],
      worthListening: { recommendation: "listen_segments", reason: "和当前关注主题高度相关。", bestSegments: [{ startSec: 120, endSec: 210, reason: "核心方法论。" }] },
      entities: [{ name: "AI Agent", type: "technology", mentions: 2 }, { name: "工作流", type: "method", mentions: 1 }]
    },
    segments: [],
    insights: [insight]
  };

  repos.upsertSource(source);
  repos.upsertEpisode(episode);
  repos.saveTranscript({
    episodeId: episode.id,
    provider: "local-demo",
    model: "local-demo",
    transcript: {
      language: "zh-CN",
      durationSec: episode.durationSec,
      segments: [
        {
          startSec: 120,
          endSec: 210,
          text: "团队先把任务拆成检索、执行、验收三个阶段，每个阶段都有可观察输出，再逐步交给 agent 自动处理。"
        }
      ]
    }
  });
  repos.saveProcessingResult(result, watch, "local-demo");
}

function summary(context: SessionContext) {
  const watches = listWatchCards({ repositories: repos, context });
  const inbox = getInboxView({ repositories: repos, context, limit: 20 });
  const usageEvents = repos.listUsageEvents({ workspaceId: context.workspace.id, userId: context.user.id, limit: 20 });
  return {
    ok: true,
    workspace: context.workspace,
    user: context.user,
    watches,
    inbox: inbox.items,
    usageEventCount: usageEvents.length
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
    :root { color-scheme: light; --bg: #f6f7fb; --card: #ffffff; --text: #172033; --muted: #667085; --line: #e5e7eb; --blue: #2563eb; --blue-soft: #eff6ff; --green: #047857; --red: #b42318; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
    main { max-width: 1120px; margin: 0 auto; padding: 28px 18px 56px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 22px; }
    h1 { font-size: 34px; margin: 0 0 8px; letter-spacing: -0.03em; }
    h2 { font-size: 18px; margin: 0 0 14px; }
    h3 { font-size: 16px; margin: 0 0 8px; }
    p { line-height: 1.55; }
    .muted { color: var(--muted); }
    .small { font-size: 13px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; background: var(--blue-soft); color: #1d4ed8; font-weight: 700; font-size: 12px; }
    .notice { margin: 0 0 16px; padding: 12px 14px; border: 1px solid #bfdbfe; background: #eff6ff; color: #1e40af; border-radius: 12px; }
    .grid { display: grid; grid-template-columns: minmax(300px, 0.9fr) minmax(360px, 1.4fr); gap: 16px; align-items: start; }
    .stack { display: grid; gap: 16px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 18px; box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06); }
    label { display: block; font-weight: 700; font-size: 13px; margin: 12px 0 6px; }
    input, select { width: 100%; border: 1px solid #d0d5dd; border-radius: 10px; padding: 10px 12px; font: inherit; background: white; color: var(--text); }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    button, .button { display: inline-flex; justify-content: center; align-items: center; border: 0; border-radius: 10px; padding: 10px 14px; background: var(--blue); color: white; font-weight: 800; text-decoration: none; cursor: pointer; }
    .secondary { background: #f2f4f7; color: #344054; border: 1px solid #d0d5dd; }
    .danger { background: #fff1f0; color: var(--red); border: 1px solid #fecdca; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .watch { padding: 12px; border: 1px solid var(--line); border-radius: 14px; margin-top: 10px; background: #fcfcfd; }
    .pill { display: inline-block; padding: 3px 8px; border-radius: 999px; background: #ecfdf3; color: var(--green); font-size: 12px; font-weight: 800; }
    .pill.paused { background: #f2f4f7; color: #475467; }
    .empty { border: 1px dashed #cbd5e1; border-radius: 16px; padding: 18px; background: #f8fafc; }
    .insight { border: 1px solid #dbeafe; background: #ffffff; border-radius: 16px; padding: 16px; margin-bottom: 14px; }
    .score { color: #1d4ed8; font-weight: 800; }
    .meta { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0 12px; }
    .quote { border-left: 4px solid #93c5fd; padding: 10px 12px; background: #f8fbff; border-radius: 8px; color: #344054; }
    code, pre { background: #101828; color: #f9fafb; border-radius: 12px; padding: 12px; overflow: auto; }
    a { color: #1d4ed8; }
    @media (max-width: 820px) { header, .grid, .row { grid-template-columns: 1fr; display: grid; } }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <span class="badge">M1.5 local preview</span>
      <h1>Podcast Note 本地试用</h1>
      <p class="muted">先添加关注主题，再运行一次或生成示例数据，然后在 Inbox 里看结果、保存/标记没用。</p>
    </div>
    <div class="small muted">Workspace: ${escapeHtml(data.workspace.id)}<br/>User: ${escapeHtml(data.user.id)}</div>
  </header>
  ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ""}
  <div class="grid">
    <aside class="stack">
      <section class="card">
        <h2>1. 立即试用：添加关注主题</h2>
        <form method="post" action="/api/watches">
          <label for="name">主题名称</label>
          <input id="name" name="name" value="AI Agent 产品动态" placeholder="例如：AI Agent 产品动态" />
          <label for="query">你想关注什么？</label>
          <input id="query" name="query" value="AI agent workflow" placeholder="播客/主题/RSS URL" />
          <label for="includeTerms">关键词（逗号分隔）</label>
          <input id="includeTerms" name="includeTerms" value="AI agent, workflow, product" />
          <label for="excludeTerms">排除词（可选）</label>
          <input id="excludeTerms" name="excludeTerms" value="sports" />
          <div class="row">
            <div><label for="minRelevanceScore">最低相关度</label><input id="minRelevanceScore" name="minRelevanceScore" type="number" min="0" max="1" step="0.05" value="0.6" /></div>
            <div><label for="backfillDays">回看天数</label><input id="backfillDays" name="backfillDays" type="number" min="1" value="30" /></div>
          </div>
          <label for="frequency">频率</label>
          <select id="frequency" name="frequency"><option value="daily">每天</option><option value="weekly">每周</option><option value="realtime">实时</option></select>
          <p><button type="submit">添加 Watch</button></p>
        </form>
      </section>
      <section class="card">
        <h2>2. Watches</h2>
        ${data.watches.map((watch) => `<div class="watch"><div class="actions"><strong>${escapeHtml(watch.name)}</strong><span class="pill ${watch.enabled ? "" : "paused"}">${watch.enabled ? "运行中" : "已暂停"}</span></div><p class="muted small">${escapeHtml(watch.query)}</p><p class="small">关键词：${escapeHtml(watch.includeTermText || "未设置")}<br/>最低相关度：${watch.minRelevanceScore} · ${escapeHtml(frequencyLabel(watch.frequency))}</p></div>`).join("") || `<div class="empty">还没有关注主题。用上面的表单添加一个。</div>`}
      </section>
      <section class="card">
        <h2>3. Actions</h2>
        <div class="actions">
          <form method="post" action="/api/run-once"><button type="submit">运行一次</button></form>
          <form method="post" action="/api/demo"><button class="secondary" type="submit">生成示例数据</button></form>
        </div>
        <p class="muted small">运行一次等价于 <code>scripts/podcast-note run-once</code>。如果还没配置真实 RSS，先点“生成示例数据”也能完整试用 Inbox。</p>
      </section>
    </aside>
    <section class="card">
      <h2>4. Inbox</h2>
      ${renderInbox(data.inbox)}
    </section>
  </div>
  <section class="card" style="margin-top:16px">
    <h2>CLI</h2>
    <pre>scripts/podcast-note status
scripts/podcast-note run-once
scripts/podcast-note stop</pre>
  </section>
</main>
</body>
</html>`;
}

function renderInbox(items: ReturnType<typeof summary>["inbox"]): string {
  if (items.length === 0) {
    return `<div class="empty"><h3>还没有 insight</h3><p class="muted">这不是错误：当前本地库里还没有处理过的播客结果。你可以：</p><div class="actions"><form method="post" action="/api/demo"><button type="submit">生成示例数据</button></form><form method="post" action="/api/run-once"><button class="secondary" type="submit">运行一次真实流程</button></form></div></div>`;
  }
  return items.map((item) => `<article class="insight"><div class="meta"><span class="pill">${escapeHtml(item.watchName)}</span><span class="score">相关度 ${Math.round(item.relevanceScore * 100)}%</span>${item.feedbackAction ? `<span class="pill">${feedbackLabel(item.feedbackAction)}</span>` : ""}</div><h3>${escapeHtml(item.claim)}</h3><p class="muted">${escapeHtml(item.episodeTitle)}${item.episodePublishedAt ? ` · ${escapeHtml(item.episodePublishedAt.slice(0, 10))}` : ""}</p>${item.implication ? `<p><strong>为什么重要：</strong>${escapeHtml(item.implication)}</p>` : ""}<p class="quote"><strong>证据：</strong>${escapeHtml(item.evidenceExcerpt)}</p><div class="actions"><a class="button secondary" href="${escapeHtml(item.episodePageUrl)}" target="_blank" rel="noreferrer">打开原文</a><form method="post" action="/api/feedback"><input type="hidden" name="insightId" value="${escapeHtml(item.id)}"/><input type="hidden" name="action" value="saved"/><button type="submit">保存</button></form><form method="post" action="/api/feedback"><input type="hidden" name="insightId" value="${escapeHtml(item.id)}"/><input type="hidden" name="action" value="irrelevant"/><button class="danger" type="submit">没用</button></form></div></article>`).join("");
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
