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
      VOLCENGINE_ASR_ACCESS_TOKEN: "",
      LISTEN_NOTES_API_KEY: ""
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
  assertIncludes(home, "name=\"podcastUrl\"", "播客链接表单需要 podcastUrl 输入框。");
  assertIncludes(home, "action=\"/api/process-link\"", "播客链接表单需要提交到专用处理接口。");
  assertIncludes(home, "href=\"/monitor\"", "首页需要提供进入监控任务页面的导航。");
  assertNotIncludes(home, "action=\"/api/monitor-target\"", "即时处理首页不应混入目标监控表单。");
  assertNotIncludes(home, "id=\"monitorKeywords\"", "即时处理首页不需要填写关键词。");
  assertNotIncludes(home, "监控中", "即时处理首页不应展示监控任务管理列表。");
  assertIncludes(home, "Agent 执行过程", "结果前需要展示 Agent 的执行过程。");
  assertIncludes(home, "<details class=\"card full agent-panel\"", "Agent 执行过程默认应是可收起的 details 面板。");
  assertIncludes(home, "当前没有正在处理的即时任务", "没有当前任务时 Agent 面板应展示空态，而不是历史执行流程。");
  assertIncludes(home, "历史处理结果只展示在下方结果区", "Agent 面板必须说明历史结果与当前任务状态分离。");
  assertNotIncludes(home, "最近一次已完成", "没有当前任务时不应展示最近一次历史任务状态。");
  assertIncludes(home, "data-busy-label=\"正在处理\"", "提交按钮需要点击后的处理中状态。");
  assertIncludes(home, "请不要重复提交", "前端脚本需要在提交后告诉用户长流程处理中不要重复提交。");
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

  const monitorPage = fetchText(`${url}/monitor`);
  assertIncludes(monitorPage, "监控一个目标", "监控页必须保留目标监控入口。");
  assertIncludes(monitorPage, "name=\"target\"", "监控页需要目标站点或平台输入框。");
  assertIncludes(monitorPage, "name=\"channel\"", "监控页需要频道名称或主播名称输入框。");
  assertIncludes(monitorPage, "频道链接 / 频道名称 / 主播名称", "监控页应允许用户提供频道链接或频道名称。");
  assertIncludes(monitorPage, "优先填频道链接", "监控页需要明确频道链接是更可靠输入。");
  assertIncludes(monitorPage, "关键词（可选，多个用逗号分割）", "监控关键词必须是可选且支持逗号分割。");
  assertIncludes(monitorPage, "name=\"frequency\"", "监控页需要频率输入。");
  assertIncludes(monitorPage, "name=\"maxEpisodes\"", "监控页需要回看集数输入。");
  assertIncludes(monitorPage, "action=\"/api/monitor-target\"", "目标监控表单需要提交到专用监控接口。");
  assertIncludes(monitorPage, "data-busy-label=\"正在创建\"", "监控按钮只需要展示创建任务中的短暂状态。");
  assertIncludes(monitorPage, "监控任务", "监控页应展示当前监控任务列表。");
  assertNotIncludes(monitorPage, "action=\"/api/process-link\"", "监控页不应混入即时处理表单。");
  assertNotIncludes(monitorPage, "name=\"podcastUrl\"", "监控页不应展示具体播客链接输入框。");
  assertNotIncludes(monitorPage, "<details class=\"card full agent-panel\" id=\"agent-status\">", "监控页不应展示即时任务的 Agent 执行过程面板。");
  assertNotIncludes(monitorPage, "<h2>结果</h2>", "监控页不应展示即时任务全局结果区。");

  const linkResponse = postFormAllowError(`${url}/api/process-link`, {
    podcastUrl: "listennotes:podcast-fixture"
  });
  if (linkResponse.status !== 500) {
    throw new Error(`未配置真实处理时应返回 500 配置错误，got ${JSON.stringify(linkResponse)}`);
  }
  assertIncludes(linkResponse.body, "真实处理未配置", "Web 不能在缺少真实处理配置时返回 mock 结果。");

  const monitorResponse = postFormAllowError(`${url}/api/monitor-target`, {
    target: "小宇宙",
    channel: "AI组织",
    keywords: "AI agent, workflow",
    frequency: "realtime",
    maxEpisodes: "4"
  });
  if (monitorResponse.status !== 303 || !monitorResponse.headers.includes("/monitor")) {
    throw new Error(`目标监控创建应立即重定向回监控页，不应阻塞等待真实处理，got ${JSON.stringify(monitorResponse)}`);
  }
  assertIncludes(monitorResponse.headers, "set-cookie: podcast_note_notice=", "监控创建提示应通过 flash cookie 传递，避免中文 notice 出现在 URL 中变成乱码。");
  assertNotIncludes(monitorResponse.headers, "%25E", "Location header 不应包含二次编码后的中文提示。");
  assertNotIncludes(monitorResponse.body, "Listen Notes episode requires an id", "目标监控的文本输入不能被当成 Listen Notes 单集 ID 解析。");
  const asyncMonitorPage = fetchText(`${url}/monitor`);
  assertIncludes(asyncMonitorPage, "AI组织", "监控任务创建后应立即出现在监控任务列表。");
  assertIncludes(asyncMonitorPage, "回看处理进度", "异步监控任务需要在任务卡片内展示后台回看进度。");
  assertIncludes(asyncMonitorPage, "data-watch-progress", "监控进度需要有可局部替换的 DOM 容器。");
  assertIncludes(asyncMonitorPage, "startMonitorPolling()", "监控页应使用局部轮询更新，不应整页刷新。");
  assertNotIncludes(asyncMonitorPage, "window.location.href = \"/monitor\"", "监控页不能通过整页刷新更新进度，否则会折叠用户正在阅读的内容。");
  assertIncludes(asyncMonitorPage, "回看失败", "缺少真实处理配置时，后台 run 应失败并在监控任务内展示。");
  assertIncludes(asyncMonitorPage, "真实处理未配置", "后台处理配置错误应展示在监控任务进度里，而不是阻塞表单提交。");
  const fragments = JSON.parse(fetchText(`${url}/api/monitor-fragments`)) as {
    ok: boolean;
    watches: Array<{ id: string; progressHtml: string; outputCountHtml: string; outputs: Array<{ id: string; html: string }> }>;
  };
  if (!fragments.ok || !fragments.watches.some((watch) => watch.progressHtml.includes("回看处理进度"))) {
    throw new Error("监控局部更新 API 需要返回每个任务的进度片段。");
  }

  const refreshed = fetchText(url);
  assertNotIncludes(refreshed, "AI Agent 产品团队如何落地工作流", "Web preview 不应再生成本地示例/mock insight。");
  assertNotIncludes(refreshed, "local-demo", "Web preview 不应再展示 local-demo mock 数据。");

  seedImmediateOnlyEpisode(dbPath);
  const immediateOnlyHome = fetchText(url);
  assertIncludes(immediateOnlyHome, "Immediate-only Xiaoyuzhou episode", "即时处理历史结果应该展示在首页结果区。");
  const immediateOnlyMonitorPage = fetchText(`${url}/monitor`);
  assertNotIncludes(immediateOnlyMonitorPage, "Immediate-only Xiaoyuzhou episode", "即时处理历史结果不应出现在监控任务页。");

  seedMonitorOnlySummary(dbPath);
  const monitorOnlyHome = fetchText(url);
  assertNotIncludes(monitorOnlyHome, "Monitor-only Xiaoyuzhou episode", "监控任务生成的结果不应映射到即时处理结果区。");

  seedEmptyMonitorRun(dbPath);
  const emptyRunMonitorPage = fetchText(`${url}/monitor`);
  assertIncludes(emptyRunMonitorPage, "Empty Monitor", "无产出的监控任务也应该展示任务卡片。");
  assertIncludes(emptyRunMonitorPage, "回看处理进度", "监控任务需要展示最近一次回看处理进度。");
  assertIncludes(emptyRunMonitorPage, "解析目标", "监控进度需要展示正在解析的目标。");
  assertIncludes(emptyRunMonitorPage, "当前处理", "监控进度需要展示当前处理对象。");
  assertIncludes(emptyRunMonitorPage, "最近检查", "监控进度需要展示最近检查与产出数量。");
  assertIncludes(emptyRunMonitorPage, "回看完成", "已完成的回看任务需要展示完成状态。");
  assertIncludes(emptyRunMonitorPage, "没有产出内容", "无产出的回看需要明确告诉用户没有产出。");
  assertIncludes(emptyRunMonitorPage, "请优先提供频道页、RSS 或单集链接", "无产出的回看需要给出下一步修正建议。");

  seedFailedMonitorRun(dbPath);
  const failedRunMonitorPage = fetchText(`${url}/monitor`);
  assertIncludes(failedRunMonitorPage, "Failed Monitor", "失败的监控任务也应该展示任务卡片。");
  assertIncludes(failedRunMonitorPage, ">重试失败项</button>", "失败的监控任务需要提供批量重试入口。");
  assertIncludes(failedRunMonitorPage, ">重新处理本集</button>", "失败的单集需要提供单集重试入口。");
  assertIncludes(failedRunMonitorPage, "失败处理：系统会按阶段和音频时长判断是否卡死", "真正失败的监控任务需要展示失败处理说明。");

  seedRetriedRunningMonitorRun(dbPath);
  const retriedRunningMonitorPage = fetchText(`${url}/monitor`);
  const retriedRunningSection = sectionFor(retriedRunningMonitorPage, "Retried Running Monitor");
  assertIncludes(retriedRunningSection, "正在转写音频中", "重试后的运行中单集应展示当前运行状态。");
  assertIncludes(retriedRunningSection, "当前单集正在处理中", "运行中的监控任务应说明当前还在处理。");
  assertNotIncludes(retriedRunningSection, "失败处理：", "历史失败已经重试后，不应继续把当前状态渲染成失败处理。");
  assertNotIncludes(retriedRunningSection, ">重试失败项</button>", "运行中的监控任务不应展示批量重试失败入口。");
  assertNotIncludes(retriedRunningSection, "请优先提供频道页、RSS 或单集链接", "运行中的监控任务无产出时不应误导用户认为目标无法解析。");

  const retryEpisodeResponse = postForm(`${url}/api/watch-action`, {
    watchId: "watch_failed_monitor",
    action: "retry-episode",
    episodeId: "ep_failed_monitor"
  });
  if (!retryEpisodeResponse.includes("/monitor")) {
    throw new Error(`单集重试后应重定向回监控页，got ${retryEpisodeResponse}`);
  }
  const retryRepos = createRepositories(openPodcastNoteDb(dbPath));
  const retriedJob = retryRepos.getEpisodeProcessingJob("epjob_failed_monitor");
  if (retriedJob?.status !== "queued") {
    throw new Error(`单集重试后 job 应重新入队，got ${JSON.stringify(retriedJob)}.`);
  }

  seedProcessedEpisode(dbPath);
  const reportHome = fetchText(url);
  assertIncludes(reportHome, "音频核验", "结果报告需要提供音频核验入口。");
  assertIncludes(reportHome, "<audio", "结果报告需要内嵌音频播放器。");
  assertIncludes(reportHome, "data-seek", "章节和核心观点时间戳需要能跳到对应音频片段。");
  assertIncludes(reportHome, "跳到对应音频片段播放", "时间戳按钮需要说明可播放对应片段。");
  assertNotIncludes(reportHome, "<span class=\"score\">相关度", "核心观点不应再使用含糊的相关度文案。");
  assertNotIncludes(reportHome, "打开原文</a><form method=\"post\" action=\"/api/feedback\"", "核心观点卡片不应提供打开原文按钮。");
  assertNotIncludes(reportHome, "action=\"/api/watch-action\"", "即时处理首页不应展示监控任务管理操作。");

  const reportMonitorPage = fetchText(`${url}/monitor`);
  assertIncludes(reportMonitorPage, "action=\"/api/watch-action\"", "监控卡片需要提供任务管理操作。");
  assertIncludes(reportMonitorPage, "<details class=\"watch\" data-watch-id=", "每个监控任务默认应是可收起的 details，并带有局部更新标识。");
  assertIncludes(reportMonitorPage, "<details class=\"watch-output\" data-output-id=", "每个监控任务产出默认应是可收起的 details，并带有稳定输出标识。");
  assertIncludes(reportMonitorPage, ">停止</button>", "运行中的监控需要提供停止操作。");
  assertIncludes(reportMonitorPage, ">删除</button>", "监控需要提供删除操作。");
  assertIncludes(reportMonitorPage, "Preview Audio", "监控任务列表需要展示任务名称。");
  assertIncludes(reportMonitorPage, "Preview audio verification episode", "展开监控任务后应能看到该任务产出的内容。");
  assertIncludes(reportMonitorPage, "节目发布时间：", "监控结果必须优先展示播客原始发布时间。");
  assertIncludes(reportMonitorPage, "与处理目标匹配度", "核心观点匹配度需要说明是和当前处理目标匹配。");
  assertNotIncludes(reportMonitorPage, "<span class=\"score\">相关度", "核心观点不应再使用含糊的相关度文案。");

  const pauseResponse = postForm(`${url}/api/watch-action`, { watchId: "watch_preview_audio", action: "pause" });
  if (!pauseResponse.includes("/monitor")) {
    throw new Error(`暂停监控后应重定向回监控页，got ${pauseResponse}`);
  }
  const pausedMonitorPage = fetchText(`${url}/monitor`);
  assertIncludes(pausedMonitorPage, ">开始</button>", "暂停后的监控需要提供开始操作。");
  assertIncludes(pausedMonitorPage, "已停止", "暂停后的监控任务状态应显示已停止。");

  const summaryBeforeFeedback = JSON.parse(fetchText(`${url}/api/summary`));
  const insightId = summaryBeforeFeedback.inbox?.[0]?.id;
  if (insightId) {
    const feedbackResponse = postForm(`${url}/api/feedback`, { insightId, action: "saved" });
    if (!feedbackResponse.includes("/")) {
      throw new Error(`保存反馈后应重定向回首页，got ${feedbackResponse}`);
    }
    assertIncludes(feedbackResponse, "set-cookie: podcast_note_notice=", "保存反馈提示应通过 flash cookie 传递。");
    const afterFeedbackSummary = JSON.parse(fetchText(`${url}/api/summary`));
    const feedbackAction = afterFeedbackSummary.inbox?.find((item: { id: string }) => item.id === insightId)?.feedbackAction;
    if (feedbackAction !== "saved") {
      throw new Error(`提交保存反馈后应持久化 feedbackAction=saved，got ${feedbackAction}`);
    }
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

function sectionFor(html: string, marker: string): string {
  const start = html.indexOf(marker);
  if (start < 0) throw new Error(`Expected page to include section marker: ${marker}`);
  const next = html.indexOf("<details class=\"watch\"", start + marker.length);
  return next < 0 ? html.slice(start) : html.slice(start, next);
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
    publishedAt: "2026-05-07T06:00:00.000Z",
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

function seedImmediateOnlyEpisode(path: string): void {
  const db = openPodcastNoteDb(path);
  const repos = createRepositories(db);
  const user = repos.upsertUser({ id: "user_local_preview", email: "local-preview@example.invalid", name: "Local Preview", timezone: "Asia/Shanghai" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const watch = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_immediate_only",
    name: "Immediate-only task",
    type: "topic",
    query: "即时处理：https://www.xiaoyuzhoufm.com/episode/immediate-only",
    outputLanguage: "zh-CN",
    includeTerms: [],
    excludeTerms: [],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 1,
    enabled: true
  });
  const episode = repos.upsertEpisode({
    id: "ep_immediate_only",
    sourceId: undefined,
    title: "Immediate-only Xiaoyuzhou episode",
    description: "Fixture used to ensure immediate results do not leak into monitor tasks.",
    durationSec: 90,
    audioUrl: "https://example.invalid/immediate-only.mp3",
    pageUrl: "https://www.xiaoyuzhoufm.com/episode/immediate-only",
    language: "zh-CN"
  });
  repos.saveTranscript({
    episodeId: episode.id,
    provider: "fixture",
    model: "fixture",
    transcript: {
      language: "zh-CN",
      durationSec: 90,
      segments: [{ startSec: 0, endSec: 30, text: "Immediate-only transcript segment." }]
    }
  });
  db.query(`
    insert into episode_summaries (
      id, episode_id, output_language, one_liner, overview, chapters_json, worth_listening_json, entities_json, prompt_version, model
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "sum_immediate_only",
    episode.id,
    "zh-CN",
    "Immediate-only summary.",
    "This result should appear only on the immediate processing page.",
    JSON.stringify([{ title: "Immediate", startSec: 0, endSec: 30, summary: "Immediate-only content." }]),
    JSON.stringify({ recommendation: "listen_segments", reason: "Short fixture.", bestSegments: [{ startSec: 0, endSec: 30, reason: "Fixture segment." }] }),
    JSON.stringify([{ name: "Immediate", type: "fixture", mentions: 1 }]),
    "fixture",
    "fixture"
  );
  const runId = repos.startProcessingRun({ watchId: watch.id, sources: ["https://www.xiaoyuzhoufm.com/episode/immediate-only"] });
  repos.updateEpisodeProcessingStatus({
    runId,
    episodeId: episode.id,
    sourceUrl: "https://www.xiaoyuzhoufm.com/episode/immediate-only",
    stage: "exported",
    status: "completed"
  });
  repos.completeProcessingRun(runId);
}

function seedMonitorOnlySummary(path: string): void {
  const db = openPodcastNoteDb(path);
  const repos = createRepositories(db);
  const user = repos.upsertUser({ id: "user_local_preview", email: "local-preview@example.invalid", name: "Local Preview", timezone: "Asia/Shanghai" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const watch = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_monitor_only_summary",
    name: "Monitor-only task",
    type: "topic",
    query: "小宇宙 / Monitor-only / AI",
    outputLanguage: "zh-CN",
    includeTerms: ["AI"],
    excludeTerms: [],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 3,
    enabled: true
  });
  const episode = repos.upsertEpisode({
    id: "ep_monitor_only_summary",
    sourceId: undefined,
    title: "Monitor-only Xiaoyuzhou episode",
    description: "Fixture used to ensure monitor results do not leak into immediate results.",
    publishedAt: "2026-05-08T06:00:00.000Z",
    durationSec: 120,
    audioUrl: "https://example.invalid/monitor-only.mp3",
    pageUrl: "https://www.xiaoyuzhoufm.com/episode/monitor-only",
    language: "zh-CN"
  });
  repos.saveTranscript({
    episodeId: episode.id,
    provider: "fixture",
    model: "fixture",
    transcript: {
      language: "zh-CN",
      durationSec: 120,
      segments: [{ startSec: 0, endSec: 30, text: "Monitor-only transcript segment." }]
    }
  });
  db.query(`
    insert into episode_summaries (
      id, episode_id, output_language, one_liner, overview, chapters_json, worth_listening_json, entities_json, prompt_version, model
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "sum_monitor_only",
    episode.id,
    "zh-CN",
    "Monitor-only summary.",
    "This result should appear only inside its monitor task.",
    JSON.stringify([{ title: "Monitor", startSec: 0, endSec: 30, summary: "Monitor-only content." }]),
    JSON.stringify({ recommendation: "listen_segments", reason: "Short fixture.", bestSegments: [{ startSec: 0, endSec: 30, reason: "Fixture segment." }] }),
    JSON.stringify([{ name: "Monitor", type: "fixture", mentions: 1 }]),
    "fixture",
    "fixture"
  );
  const runId = repos.startProcessingRun({ watchId: watch.id, sources: ["小宇宙 Monitor-only AI"] });
  repos.updateEpisodeProcessingStatus({
    runId,
    episodeId: episode.id,
    sourceUrl: "小宇宙 Monitor-only AI",
    stage: "exported",
    status: "completed"
  });
  repos.completeProcessingRun(runId);
}

function seedEmptyMonitorRun(path: string): void {
  const repos = createRepositories(openPodcastNoteDb(path));
  const user = repos.upsertUser({ id: "user_local_preview", email: "local-preview@example.invalid", name: "Local Preview", timezone: "Asia/Shanghai" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const watch = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_empty_monitor",
    name: "Empty Monitor",
    type: "topic",
    query: "小宇宙 / 深思圈 / AI",
    outputLanguage: "zh-CN",
    includeTerms: ["AI"],
    excludeTerms: [],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 3,
    enabled: true
  });
  const runId = repos.startProcessingRun({ watchId: watch.id, sources: ["小宇宙 深思圈 AI"] });
  repos.completeProcessingRun(runId);
}

function seedFailedMonitorRun(path: string): void {
  const db = openPodcastNoteDb(path);
  const repos = createRepositories(db);
  const user = repos.upsertUser({ id: "user_local_preview", email: "local-preview@example.invalid", name: "Local Preview", timezone: "Asia/Shanghai" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const watch = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_failed_monitor",
    name: "Failed Monitor",
    type: "topic",
    query: "小宇宙 / Failed Monitor / AI",
    outputLanguage: "zh-CN",
    includeTerms: ["AI"],
    excludeTerms: [],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 3,
    enabled: true
  });
  const episode = repos.upsertEpisode({
    id: "ep_failed_monitor",
    title: "Failed monitor episode",
    pageUrl: "https://example.invalid/failed-monitor",
    audioUrl: "https://example.invalid/failed-monitor.mp3"
  });
  db.query(`
    insert into processing_runs (id, watch_id, input_sources_json, status, started_at, finished_at, error)
    values (?, ?, ?, 'failed', ?, ?, ?)
  `).run(
    "run_failed_monitor",
    watch.id,
    JSON.stringify([episode.pageUrl]),
    "2026-06-08 00:00:00",
    "2026-06-08 00:30:00",
    "Unable to connect. Automatic retry limit reached."
  );
  db.query(`
    insert into episode_processing_jobs (
      id, workspace_id, watch_id, episode_id, source_url, status, attempts,
      relevance_reason_json, processing_run_id, error, queued_at, started_at, finished_at, updated_at
    ) values (?, ?, ?, ?, ?, 'failed', 3, '{}', ?, ?, ?, ?, ?, ?)
  `).run(
    "epjob_failed_monitor",
    workspace.id,
    watch.id,
    episode.id,
    episode.pageUrl,
    "run_failed_monitor",
    "Unable to connect. Automatic retry limit reached.",
    "2026-06-08T00:00:00.000Z",
    "2026-06-08 00:00:00",
    "2026-06-08 00:30:00",
    "2026-06-08 00:30:00"
  );
  repos.updateEpisodeProcessingStatus({
    runId: "run_failed_monitor",
    episodeId: episode.id,
    sourceUrl: episode.pageUrl,
    stage: "failed",
    status: "failed",
    error: "Unable to connect. Automatic retry limit reached."
  });
}

function seedRetriedRunningMonitorRun(path: string): void {
  const db = openPodcastNoteDb(path);
  const repos = createRepositories(db);
  const user = repos.upsertUser({ id: "user_local_preview", email: "local-preview@example.invalid", name: "Local Preview", timezone: "Asia/Shanghai" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const watch = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_retried_running_monitor",
    name: "Retried Running Monitor",
    type: "topic",
    query: "小宇宙 / Retried Running Monitor / AI",
    outputLanguage: "zh-CN",
    includeTerms: ["AI"],
    excludeTerms: [],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 3,
    enabled: true
  });
  const episode = repos.upsertEpisode({
    id: "ep_retried_running_monitor",
    title: "Retried running episode",
    pageUrl: "https://example.invalid/retried-running-monitor",
    audioUrl: "https://example.invalid/retried-running-monitor.mp3"
  });
  db.query(`
    insert into processing_runs (id, watch_id, input_sources_json, status, started_at, finished_at, error)
    values (?, ?, ?, 'failed', ?, ?, ?)
  `).run(
    "run_retried_running_old_failed",
    watch.id,
    JSON.stringify([episode.pageUrl]),
    "2026-06-08 00:00:00",
    "2026-06-08 00:10:00",
    "Processing worker exceeded its stage timeout and was requeued."
  );
  repos.updateEpisodeProcessingStatus({
    runId: "run_retried_running_old_failed",
    episodeId: episode.id,
    sourceUrl: episode.pageUrl,
    stage: "failed",
    status: "failed",
    error: "Processing worker exceeded its stage timeout and was requeued."
  });
  db.query(`
    insert into processing_runs (id, watch_id, input_sources_json, status, started_at)
    values (?, ?, ?, 'running', ?)
  `).run(
    "run_retried_running_current",
    watch.id,
    JSON.stringify([episode.pageUrl]),
    "2026-06-08 00:12:00"
  );
  db.query(`
    insert into episode_processing_jobs (
      id, workspace_id, watch_id, episode_id, source_url, status, attempts,
      relevance_reason_json, processing_run_id, error, queued_at, started_at, updated_at
    ) values (?, ?, ?, ?, ?, 'running', 2, '{}', ?, null, ?, ?, ?)
  `).run(
    "epjob_retried_running_monitor",
    workspace.id,
    watch.id,
    episode.id,
    episode.pageUrl,
    "run_retried_running_current",
    "2026-06-08T00:12:00.000Z",
    "2026-06-08 00:12:00",
    "2026-06-08 00:12:00"
  );
  repos.updateEpisodeProcessingStatus({
    runId: "run_retried_running_current",
    episodeId: episode.id,
    sourceUrl: episode.pageUrl,
    stage: "transcribing",
    status: "running"
  });
}
