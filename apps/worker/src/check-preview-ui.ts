import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-preview-ui-"));
const dbPath = join(dir, "preview.sqlite");
const port = 3400 + Math.floor(Math.random() * 1000);
const url = `http://127.0.0.1:${port}`;
const repoRoot = process.cwd();

let server: ReturnType<typeof Bun.spawn> | undefined;
try {
  server = Bun.spawn({
    cmd: ["bun", "apps/web/src/server/preview.ts", "--port", String(port), "--db", dbPath],
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ""}`,
      VOLCENGINE_ASR_API_KEY: "",
      VOLCENGINE_ASR_APP_ID: "",
      VOLCENGINE_ASR_ACCESS_TOKEN: ""
    },
    stdout: "pipe",
    stderr: "pipe"
  });

  if (server.stderr) {
    server.stderr.pipeTo(new WritableStream({
      write(chunk) {
        process.stderr.write(chunk);
      }
    })).catch(() => {});
  }
  server.stdout.pipeTo(new WritableStream({
    write(chunk) {
      process.stderr.write(chunk);
    }
  })).catch(() => {});

  waitForHealth(url);

  const home = fetchText(url);
  assertIncludes(home, "处理一个播客链接", "首页必须保留具体播客链接处理入口。");
  assertIncludes(home, "监控一个目标", "首页必须保留目标站点和关键词监控入口。");
  assertIncludes(home, "name=\"podcastUrl\"", "播客链接表单需要 podcastUrl 输入框。");
  assertIncludes(home, "action=\"/api/process-link\"", "播客链接表单需要提交到专用处理接口。");
  assertIncludes(home, "action=\"/api/monitor-target\"", "目标监控表单需要提交到专用监控接口。");
  assertIncludes(home, "监控中", "首页应展示当前监控列表。");
  assertIncludes(home, "Agent 执行过程", "结果前需要展示 Agent 的执行过程。");
  assertIncludes(home, "解析来源", "Agent 执行过程需要说明解析来源步骤。");
  assertIncludes(home, "转写音频", "Agent 执行过程需要说明转写音频步骤。");
  assertIncludes(home, "提炼内容", "Agent 执行过程需要说明提炼内容步骤。");
  assertIncludes(home, "生成报告", "Agent 执行过程需要说明生成报告步骤。");
  assertIncludes(home, "data-busy-label=\"正在处理\"", "提交按钮需要点击后的处理中状态。");
  assertIncludes(home, "data-busy-label=\"正在监控\"", "监控按钮需要点击后的处理中状态。");
  assertIncludes(home, "请不要重复提交", "页面需要告诉用户长流程处理中不要重复提交。");
  assertIncludes(home, "结果", "首页应展示处理结果区域。");
  assertNotIncludes(home, "添加 Watch", "现阶段首页不应暴露通用 Watch 创建入口。");
  assertNotIncludes(home, "立即试用：添加关注主题", "现阶段首页不应继续使用旧的新手引导。");
  assertNotIncludes(home, "生成示例数据", "现阶段首页不应把示例数据作为主流程。");
  assertNotIncludes(home, "<h2>CLI</h2>", "普通用户试用页不应直接暴露 CLI 区块，容易误以为页面里出现 terminal。");
  assertNotIncludes(home, "<pre>scripts/podcast-note", "普通用户试用页不应显示大块终端命令，避免遮挡正文和造成困惑。");
  assertNotIncludes(home, "运行一次等价于", "运行一次说明不应以 terminal 命令作为用户解释，避免用户困惑。");
  assertNotIncludes(home, "状态与辅助命令", "页面不应再展示终端辅助命令区域。");
  assertNotIncludes(home, "scripts/podcast-note", "普通用户页面不应展示终端命令。");
  assertNotIncludes(home, "No insights yet. Run the worker once after configuring real sources.", "首页不能再显示旧的不可操作空态文案。");

  const linkResponse = postFormAllowError(`${url}/api/process-link`, {
    podcastUrl: "listennotes:podcast-fixture",
    keywords: "AI agent, workflow"
  });
  if (linkResponse.status !== 500) {
    throw new Error(`未配置真实处理时应返回 500 配置错误，got ${JSON.stringify(linkResponse)}`);
  }
  assertIncludes(linkResponse.body, "真实处理未配置", "Web 不能在缺少真实处理配置时返回 mock 结果。");

  const monitorResponse = postFormAllowError(`${url}/api/monitor-target`, {
    target: "AI组织",
    keywords: "AI agent, workflow",
    frequency: "realtime",
    backfillDays: "14"
  });
  if (monitorResponse.status !== 500) {
    throw new Error(`未配置真实处理时目标监控应返回 500 配置错误，got ${JSON.stringify(monitorResponse)}`);
  }
  assertIncludes(monitorResponse.body, "真实处理未配置", "目标监控不能在缺少真实处理配置时返回 mock 结果。");

  const refreshed = fetchText(url);
  assertNotIncludes(refreshed, "AI Agent 产品团队如何落地工作流", "Web preview 不应再生成本地示例/mock insight。");
  assertNotIncludes(refreshed, "local-demo", "Web preview 不应再展示 local-demo mock 数据。");

  seedProcessedEpisode(dbPath);
  const reportHome = fetchText(url);
  assertIncludes(reportHome, "音频核验", "结果报告需要提供音频核验入口。");
  assertIncludes(reportHome, "<audio", "结果报告需要内嵌音频播放器。");
  assertIncludes(reportHome, "data-seek", "章节和核心观点时间戳需要能跳到对应音频片段。");
  assertIncludes(reportHome, "跳到对应音频片段播放", "时间戳按钮需要说明可播放对应片段。");

  const summaryBeforeFeedback = JSON.parse(fetchText(`${url}/api/summary`));
  const insightId = summaryBeforeFeedback.inbox?.[0]?.id;
  if (insightId) {
    const feedbackResponse = postForm(`${url}/api/feedback`, { insightId, action: "saved" });
    if (!feedbackResponse.includes("/")) {
      throw new Error(`保存反馈后应重定向回首页，got ${feedbackResponse}`);
    }
    const afterFeedback = fetchText(url);
    assertIncludes(afterFeedback, "已保存", "提交保存反馈后 Insight 卡片应显示已保存状态。");
  }

  console.log(JSON.stringify({ ok: true, port, dbPath }, null, 2));
} finally {
  if (server) server.kill();
  rmSync(dir, { recursive: true, force: true });
}

function waitForHealth(baseUrl: string): void {
  const deadline = Date.now() + 10_000;
  let lastError = "";
  while (Date.now() < deadline) {
    const result = spawnSync("curl", ["-fsS", `${baseUrl}/health`], { encoding: "utf8" });
    if (result.status === 0) return;
    lastError = result.stderr || result.stdout;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  throw new Error(`Preview server did not become healthy: ${lastError}`);
}

function fetchText(targetUrl: string): string {
  const result = spawnSync("curl", ["-fsS", targetUrl], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`GET ${targetUrl} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function postForm(targetUrl: string, fields: Record<string, string>): string {
  const args = ["-fsS", "-X", "POST"];
  for (const [key, value] of Object.entries(fields)) {
    args.push("--data-urlencode", `${key}=${value}`);
  }
  args.push("-D", "-", "-o", "/dev/null", targetUrl);
  const result = spawnSync("curl", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`POST ${targetUrl} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function postFormAllowError(targetUrl: string, fields: Record<string, string>): { status: number; headers: string; body: string } {
  const args = ["-sS", "-X", "POST"];
  for (const [key, value] of Object.entries(fields)) {
    args.push("--data-urlencode", `${key}=${value}`);
  }
  args.push("-D", "-", targetUrl);
  const result = spawnSync("curl", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`POST ${targetUrl} failed: ${result.stderr || result.stdout}`);
  const splitAt = result.stdout.indexOf("\r\n\r\n");
  const headers = splitAt >= 0 ? result.stdout.slice(0, splitAt) : "";
  const body = splitAt >= 0 ? result.stdout.slice(splitAt + 4) : result.stdout;
  const status = Number(headers.match(/^HTTP\/\S+\s+(\d+)/)?.[1] ?? 0);
  return { status, headers, body };
}

function assertIncludes(haystack: string, needle: string, message: string): void {
  if (!haystack.includes(needle)) throw new Error(message);
}

function assertNotIncludes(haystack: string, needle: string, message: string): void {
  if (haystack.includes(needle)) throw new Error(message);
}

function seedProcessedEpisode(path: string): void {
  const repos = createRepositories(openPodcastNoteDb(path));
  const user = repos.upsertUser({ id: "user_local_preview", email: "local-preview@example.invalid", name: "Local Preview", timezone: "Asia/Shanghai" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const watch = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_preview_audio",
    name: "Preview Audio",
    type: "topic",
    query: "AI audio verification",
    outputLanguage: "zh-CN",
    includeTerms: ["AI"],
    excludeTerms: [],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 30,
    enabled: true
  });
  const episode = repos.upsertEpisode({
    id: "ep_preview_audio",
    sourceId: undefined,
    title: "Preview audio verification episode",
    description: "Fixture used to verify audio-backed result rendering.",
    durationSec: 120,
    audioUrl: "https://example.invalid/preview-audio.mp3",
    pageUrl: "https://example.invalid/episode",
    language: "zh-CN"
  });
  repos.saveProcessingResult({
    episode,
    summary: {
      oneLiner: "Audio verification should be available from the report.",
      overview: "The rendered report should expose a player and seek buttons for chapters and evidence.",
      chapters: [{ title: "Evidence", startSec: 10, endSec: 40, summary: "The key evidence can be checked by playing the audio segment." }],
      worthListening: { recommendation: "listen_segments", reason: "The relevant part is short.", bestSegments: [{ startSec: 10, endSec: 40, reason: "Core evidence." }] },
      entities: [{ name: "Audio", type: "feature", mentions: 1 }]
    },
    segments: [],
    insights: [{
      id: "ins_preview_audio",
      workspaceId: workspace.id,
      watchId: watch.id,
      episodeId: episode.id,
      segmentIndex: 0,
      claim: "Audio-backed evidence is visible in the preview report.",
      evidenceExcerpt: "The key evidence can be checked by playing the audio segment.",
      implication: "Users can verify whether summaries match source audio.",
      timestampStartSec: 10,
      timestampEndSec: 40,
      entities: [{ name: "Audio", type: "feature" }],
      relevanceScore: 0.95,
      confidence: 0.9,
      outputLanguage: "zh-CN",
      status: "published",
      promptVersion: "preview-audio-check",
      model: "fixture"
    }]
  }, watch, "fixture");
}
