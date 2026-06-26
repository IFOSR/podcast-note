import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-wiki-ui-"));
const dbPath = join(dir, "preview.sqlite");
const vaultRoot = join(dir, "vault");
const port = 4600 + Math.floor(Math.random() * 1000);
const url = `http://127.0.0.1:${port}`;

let server: ReturnType<typeof Bun.spawn> | undefined;
try {
  server = Bun.spawn({
    cmd: ["bun", "apps/web/src/server/preview.ts", "--port", String(port), "--db", dbPath],
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ""}`,
      PODCAST_NOTE_OBSIDIAN_VAULT: vaultRoot,
      VOLCENGINE_ASR_API_KEY: "",
      VOLCENGINE_ASR_APP_ID: "",
      VOLCENGINE_ASR_ACCESS_TOKEN: "",
      LISTEN_NOTES_API_KEY: ""
    },
    stdout: "pipe",
    stderr: "pipe"
  });
  server.stdout.pipeTo(new WritableStream({ write(chunk) { process.stderr.write(chunk); } })).catch(() => {});
  server.stderr?.pipeTo(new WritableStream({ write(chunk) { process.stderr.write(chunk); } })).catch(() => {});
  waitForHealth(url);
  seedWikiData();

  const home = fetchText(url);
  assertIncludes(home, "href=\"/wiki\"", "首页导航必须提供知识库一级入口。");
  assertIncludes(home, ">知识库</a>", "知识库入口应与即时处理、监控任务、飞书集成并列。");
  const wiki = fetchText(`${url}/wiki?question=${encodeURIComponent("AI Agent 商业化有什么结论？")}`);
  assertIncludes(wiki, "<title>知识库 · Podcast Note</title>", "知识库页需要独立标题。");
  assertIncludes(wiki, "<a class=\"active\" href=\"/wiki\">知识库</a>", "知识库导航项需要高亮。");
  assertIncludes(wiki, "知识库总览", "知识库页需要总览模块。");
  assertIncludes(wiki, "知识动态 Feed", "知识库页需要动态 feed。");
  assertIncludes(wiki, "待审更新", "知识库页需要待审 proposal 模块。");
  assertIncludes(wiki, "冲突提醒", "知识库页需要冲突提醒模块。");
  assertIncludes(wiki, "衰退知识", "知识库页需要衰退知识模块。");
  assertIncludes(wiki, "Ask Wiki", "知识库页需要主动问答模块。");
  assertIncludes(wiki, "AI Agent 商业化转向企业工作流集成", "Ask Wiki 应渲染有引用的知识库回答。");
  assertIncludes(wiki, "当前知识库中有冲突观点", "Ask Wiki 遇到冲突 proposal 时必须提示冲突。");
  assertIncludes(wiki, "Agent Workflow Evidence", "Ask Wiki 回答必须带 episode title。");
  assertIncludes(wiki, "2:00-3:00", "Ask Wiki 回答必须带 timestamp。");
  assertIncludes(wiki, "20 Concepts/AI Agent 商业化.md", "Ask Wiki 回答必须带 wiki page 引用。");
  assertIncludes(wiki, "40 Claims/旧 Agent 结论.md", "冲突和衰退模块应展示影响页面。");
  assertIncludes(wiki, "批准", "待审更新需要提供批准动作入口。");
  assertIncludes(wiki, "拒绝", "待审更新需要提供拒绝动作入口。");
  const approveResponse = postForm(`${url}/api/wiki/proposal-status`, {
    proposalId: "wiki_prop_ui_conflict",
    status: "approved"
  });
  if (!approveResponse.includes("/wiki")) throw new Error(`Approving a wiki proposal should redirect to /wiki, got ${approveResponse}`);
  const approvedWiki = fetchText(`${url}/wiki`);
  assertIncludes(approvedWiki, "发现冲突：旧 Agent 结论", "批准后的 proposal 仍应显示为待应用，不能从知识库页面消失。");
  assertIncludes(approvedWiki, "已批准待应用", "批准后的 proposal 需要明确展示待应用状态。");
  assertIncludes(approvedWiki, "应用已批准更新", "已批准 proposal 需要保留应用入口。");

  const api = JSON.parse(fetchText(`${url}/api/wiki/ask?question=${encodeURIComponent("量子烹饪有什么结论？")}`)) as { ok: boolean; insufficient: boolean; citations: unknown[] };
  if (!api.ok || !api.insufficient || api.citations.length !== 0) {
    throw new Error(`Ask Wiki API should return explicit insufficient result, got ${JSON.stringify(api)}`);
  }

  console.log(JSON.stringify({ ok: true, port, dbPath }, null, 2));
} finally {
  if (server) server.kill();
  rmSync(dir, { recursive: true, force: true });
}

function seedWikiData(): void {
  const repos = createRepositories(openPodcastNoteDb(dbPath));
  const user = repos.upsertUser({ id: "user_local_preview", email: "local-preview@example.invalid", name: "Local Preview" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const watch = {
    id: "watch_wiki_ui",
    workspaceId: workspace.id,
    name: "AI Agent 商业化",
    type: "topic" as const,
    query: "AI Agent 商业化",
    outputLanguage: "zh-CN",
    includeTerms: ["AI Agent"],
    excludeTerms: [],
    expandedTerms: [],
    minRelevanceScore: 0.65,
    frequency: "daily" as const,
    backfillDays: 30,
    enabled: true
  };
  repos.upsertWatch(watch);
  repos.upsertEpisode({
    id: "episode_wiki_ui",
    title: "Agent Workflow Evidence",
    pageUrl: "https://example.invalid/wiki-ui",
    audioUrl: "https://example.invalid/wiki-ui.mp3"
  });
  repos.saveProcessingResult({
    episode: { id: "episode_wiki_ui", title: "Agent Workflow Evidence", pageUrl: "https://example.invalid/wiki-ui", audioUrl: "https://example.invalid/wiki-ui.mp3" },
    summary: { oneLiner: "Agent.", overview: "Agent.", chapters: [], worthListening: { recommendation: "listen_segments", reason: "Agent.", bestSegments: [] }, entities: [] },
    segments: [{ index: 0, startSec: 120, endSec: 180, text: "AI Agent 商业化转向企业工作流集成。", textExcerpt: "AI Agent 商业化转向企业工作流集成。", title: "Agent", summary: "Agent." }],
    insights: [{
      id: "insight_wiki_ui",
      workspaceId: workspace.id,
      watchId: watch.id,
      episodeId: "episode_wiki_ui",
      segmentIndex: 0,
      claim: "AI Agent 商业化转向企业工作流集成",
      evidenceExcerpt: "AI Agent 商业化转向企业工作流集成。",
      timestampStartSec: 120,
      timestampEndSec: 180,
      entities: [],
      relevanceScore: 0.9,
      confidence: 0.9,
      groundednessScore: 0.88,
      outputLanguage: "zh-CN",
      status: "published",
      promptVersion: "watch-insight-v1",
      model: "check"
    }]
  }, watch, "check");
  const concept = repos.upsertWikiPage({
    workspaceId: workspace.id,
    vaultRoot,
    path: "20 Concepts/AI Agent 商业化.md",
    pageType: "concept",
    title: "AI Agent 商业化",
    status: "active",
    sourceCount: 1,
    confidenceScore: 0.9,
    freshnessScore: 1,
    contradictionCount: 1,
    lastSupportedAt: "2026-06-26T00:00:00.000Z"
  });
  repos.upsertWikiPage({
    workspaceId: workspace.id,
    vaultRoot,
    path: "40 Claims/旧 Agent 结论.md",
    pageType: "claim",
    title: "旧 Agent 结论",
    status: "stale",
    sourceCount: 1,
    confidenceScore: 0.4,
    freshnessScore: 0.2,
    contradictionCount: 1,
    lastSupportedAt: "2025-01-01T00:00:00.000Z"
  });
  repos.upsertWikiPageEvidence({
    workspaceId: workspace.id,
    pageId: concept.id,
    insightId: "insight_wiki_ui",
    episodeId: "episode_wiki_ui",
    watchId: watch.id,
    supportType: "supporting",
    claim: "AI Agent 商业化转向企业工作流集成",
    evidenceExcerpt: "AI Agent 商业化转向企业工作流集成。",
    timestampStartSec: 120,
    timestampEndSec: 180,
    confidence: 0.9,
    groundednessScore: 0.88,
    observedAt: "2026-06-26T00:00:00.000Z"
  });
  repos.recordWikiExport({
    workspaceId: workspace.id,
    vaultRoot,
    episodeId: "episode_wiki_ui",
    watchId: watch.id,
    exportType: "wiki_page",
    filePath: "20 Concepts/AI Agent 商业化.md",
    contentHash: "hash_ui",
    status: "written"
  });
  repos.upsertWikiUpdateProposal({
    id: "wiki_prop_ui_conflict",
    workspaceId: workspace.id,
    episodeId: "episode_wiki_ui",
    insightId: "insight_wiki_ui",
    targetPath: "40 Claims/旧 Agent 结论.md",
    proposalType: "flag_conflict",
    title: "发现冲突：旧 Agent 结论",
    rationale: "新证据挑战旧观点。",
    patch: { section: "冲突与反证", operation: "append", markdown: "- conflict", citations: [{ episodeId: "episode_wiki_ui", insightId: "insight_wiki_ui" }] },
    status: "pending"
  });
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

function assertIncludes(haystack: string, needle: string, message: string): void {
  if (!haystack.includes(needle)) throw new Error(`${message}\nMissing: ${needle}`);
}
