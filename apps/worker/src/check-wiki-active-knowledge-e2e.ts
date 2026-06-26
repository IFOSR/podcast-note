import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { $ } from "bun";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-wiki-active-e2e-"));
const dbPath = join(dir, "check.sqlite");
const vaultRoot = join(dir, "vault");
const port = 5600 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;

let server: ReturnType<typeof Bun.spawn> | undefined;
try {
  const repos = createRepositories(openPodcastNoteDb(dbPath));
  const user = repos.upsertUser({ id: "user_local_preview", email: "local-preview@example.invalid", name: "Local Preview" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const watch = {
    id: "watch_wiki_active_e2e",
    workspaceId: workspace.id,
    name: "AI Agent 商业化",
    type: "topic" as const,
    query: "AI Agent 商业化",
    outputLanguage: "zh-CN",
    includeTerms: ["AI Agent"],
    excludeTerms: [],
    expandedTerms: ["enterprise workflow"],
    minRelevanceScore: 0.65,
    frequency: "daily" as const,
    backfillDays: 30,
    enabled: true
  };
  repos.upsertWatch(watch);
  seedResult("episode_active_old", "Agent 产品竞争转向企业工作流。", "Agent 产品竞争转向企业工作流", 10, 40);
  seedResult("episode_active_new", "新证据挑战 Agent 产品竞争转向企业工作流，企业工作流并非唯一方向。", "新证据挑战 Agent 产品竞争转向企业工作流，企业工作流并非唯一方向", 50, 90);
  const oldClaim = writeWikiPage("40 Claims/Agent 产品竞争转向企业工作流.md", "claim", "active", "Agent 产品竞争转向企业工作流", "旧观点用户备注。");
  const staleClaim = writeWikiPage("40 Claims/旧增长结论.md", "claim", "active", "旧增长结论", "旧增长用户备注。");
  const archiveClaim = writeWikiPage("40 Claims/应归档旧结论.md", "claim", "deprecated", "应归档旧结论", "归档用户备注。");
  for (const page of [
    repos.upsertWikiPage({
      workspaceId: workspace.id,
      vaultRoot,
      path: oldClaim,
      pageType: "claim",
      title: "Agent 产品竞争转向企业工作流",
      status: "active",
      sourceCount: 1,
      confidenceScore: 0.88,
      freshnessScore: 0.9,
      contradictionCount: 0,
      lastSupportedAt: "2026-06-20T00:00:00.000Z"
    }),
    repos.upsertWikiPage({
      workspaceId: workspace.id,
      vaultRoot,
      path: staleClaim,
      pageType: "claim",
      title: "旧增长结论",
      status: "active",
      sourceCount: 1,
      confidenceScore: 0.5,
      freshnessScore: 1,
      contradictionCount: 0,
      lastSupportedAt: "2026-01-01T00:00:00.000Z"
    }),
    repos.upsertWikiPage({
      workspaceId: workspace.id,
      vaultRoot,
      path: archiveClaim,
      pageType: "claim",
      title: "应归档旧结论",
      status: "deprecated",
      sourceCount: 1,
      confidenceScore: 0.2,
      freshnessScore: 0.2,
      contradictionCount: 0,
      lastSupportedAt: "2025-01-01T00:00:00.000Z"
    })
  ]) {
    repos.upsertWikiPageEvidence({
      workspaceId: workspace.id,
      pageId: page.id,
      insightId: "insight_episode_active_old",
      episodeId: "episode_active_old",
      watchId: watch.id,
      supportType: "supporting",
      claim: page.title,
      evidenceExcerpt: `${page.title}。`,
      timestampStartSec: 10,
      timestampEndSec: 40,
      confidence: 0.88,
      groundednessScore: 0.86,
      observedAt: "2026-01-01T00:00:00.000Z"
    });
  }

  await $`bun apps/worker/src/cli.ts wiki:synthesize --db ${dbPath} --workspace-id ${workspace.id} --vault ${vaultRoot} --now 2026-06-26T12:00:00.000Z`;
  await $`bun apps/worker/src/cli.ts wiki:conflict --db ${dbPath} --workspace-id ${workspace.id} --vault ${vaultRoot} --now 2026-06-26T12:00:00.000Z`;
  await $`bun apps/worker/src/cli.ts wiki:decay --db ${dbPath} --workspace-id ${workspace.id} --vault ${vaultRoot} --now 2026-06-26T12:00:00.000Z --stale-days 90`;
  const pending = repos.listWikiUpdateProposals({ workspaceId: workspace.id, status: "pending", limit: 20 });
  for (const type of ["refresh_synthesis", "flag_conflict", "mark_stale", "archive_page"]) {
    if (!pending.some((proposal) => proposal.proposalType === type)) {
      throw new Error(`Expected pending ${type} proposal, got ${JSON.stringify(pending)}`);
    }
  }
  const feedBefore = JSON.parse(await $`bun apps/worker/src/cli.ts wiki:feed --db ${dbPath} --workspace-id ${workspace.id} --vault ${vaultRoot} --format json`.text()) as {
    counts: { pendingProposals: number; conflicts: number };
    feed: Array<{ type: string }>;
  };
  if (feedBefore.counts.pendingProposals < 4 || !feedBefore.feed.some((item) => item.type === "conflict_detected")) {
    throw new Error(`Expected pending active knowledge feed, got ${JSON.stringify(feedBefore)}`);
  }

  for (const proposal of pending) repos.updateWikiUpdateProposalStatus(proposal.id, "approved");
  await $`bun apps/worker/src/cli.ts wiki:apply-proposals --db ${dbPath} --workspace-id ${workspace.id} --vault ${vaultRoot} --workspace-id ${workspace.id} --status approved --now 2026-06-26T12:30:00.000Z`;
  const concept = await readFile(join(vaultRoot, "20 Concepts", "AI Agent 商业化.md"), "utf8");
  if (!concept.includes("截至 2026-06-26") || !concept.includes("新证据挑战 Agent 产品竞争转向企业工作流")) {
    throw new Error(`Expected synthesized concept page, got ${concept}`);
  }
  if ((concept.match(/## 当前综合判断/g) ?? []).length !== 1) {
    throw new Error(`Synthesis page should contain one managed section heading, got ${concept}`);
  }
  const conflict = await readFile(join(vaultRoot, "40 Claims", "Agent 产品竞争转向企业工作流.md"), "utf8");
  if (!conflict.includes("新反证") || !conflict.includes("insight_episode_active_new")) {
    throw new Error(`Expected applied conflict evidence, got ${conflict}`);
  }
  const stale = await readFile(join(vaultRoot, "40 Claims", "旧增长结论.md"), "utf8");
  if (!stale.includes("status: stale") || !stale.includes("旧增长用户备注。")) {
    throw new Error(`Expected stale frontmatter preserving user content, got ${stale}`);
  }
  if (existsSync(join(vaultRoot, "40 Claims", "应归档旧结论.md"))) throw new Error("Expected deprecated page to move out of active claims.");
  const archived = await readFile(join(vaultRoot, "80 Archive", "Claims", "应归档旧结论.md"), "utf8");
  if (!archived.includes("status: archived") || !archived.includes("归档用户备注。")) {
    throw new Error(`Expected archived page preserving user content, got ${archived}`);
  }
  const contestedPage = repos.getWikiPageByPath({ workspaceId: workspace.id, vaultRoot, path: oldClaim });
  const stalePage = repos.getWikiPageByPath({ workspaceId: workspace.id, vaultRoot, path: staleClaim });
  const archivedPage = repos.getWikiPageByPath({ workspaceId: workspace.id, vaultRoot, path: "80 Archive/Claims/应归档旧结论.md" });
  if (contestedPage?.status !== "contested" || stalePage?.status !== "stale" || archivedPage?.status !== "archived") {
    throw new Error(`Expected registry statuses contested/stale/archived, got ${JSON.stringify({ contestedPage, stalePage, archivedPage })}`);
  }
  const ask = JSON.parse(await $`bun apps/worker/src/cli.ts wiki:ask --db ${dbPath} --workspace-id ${workspace.id} --vault ${vaultRoot} --question "AI Agent 商业化有什么结论？"`.text()) as {
    insufficient: boolean;
    hasConflict: boolean;
    citations: Array<{ wikiPath: string; episodeTitle: string; timestamp?: string }>;
  };
  if (ask.insufficient || !ask.hasConflict || !ask.citations.some((citation) => citation.episodeTitle === "episode_active_old" && citation.timestamp === "0:10-0:40")) {
    throw new Error(`Expected cited Ask Wiki answer with conflict disclosure, got ${JSON.stringify(ask)}`);
  }

  server = Bun.spawn({
    cmd: ["bun", "apps/web/src/server/preview.ts", "--port", String(port), "--db", dbPath, "--scheduler", "false", "--wiki-llm", "false"],
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
  waitForHealth(baseUrl);
  const wiki = fetchText(`${baseUrl}/wiki?question=${encodeURIComponent("AI Agent 商业化有什么结论？")}`);
  for (const needle of ["知识库总览", "知识动态 Feed", "冲突提醒", "衰退知识", "Ask Wiki", "当前知识库中有冲突观点", "Agent 产品竞争转向企业工作流", "旧增长结论", "80 Archive/Claims/应归档旧结论.md"]) {
    if (!wiki.includes(needle)) throw new Error(`Wiki UI missing ${needle}`);
  }
  console.log(JSON.stringify({ ok: true, proposalCount: pending.length, askCitations: ask.citations.length }, null, 2));

  function seedResult(episodeId: string, evidence: string, claim: string, start: number, end: number): void {
    repos.upsertEpisode({
      id: episodeId,
      title: episodeId,
      pageUrl: `https://example.invalid/${episodeId}`,
      audioUrl: `https://example.invalid/${episodeId}.mp3`,
      publishedAt: "2026-06-25T00:00:00.000Z"
    });
    repos.saveProcessingResult({
      episode: { id: episodeId, title: episodeId, pageUrl: `https://example.invalid/${episodeId}`, audioUrl: `https://example.invalid/${episodeId}.mp3`, publishedAt: "2026-06-25T00:00:00.000Z" },
      summary: { oneLiner: evidence, overview: evidence, chapters: [], worthListening: { recommendation: "listen_segments", reason: "Relevant.", bestSegments: [] }, entities: [] },
      segments: [{ index: 0, startSec: start, endSec: end, text: evidence, textExcerpt: evidence, title: "Evidence", summary: evidence }],
      insights: [{
        id: `insight_${episodeId}`,
        workspaceId: workspace.id,
        watchId: watch.id,
        episodeId,
        segmentIndex: 0,
        claim,
        evidenceExcerpt: evidence,
        reasoning: evidence,
        implication: "Supports active knowledge E2E.",
        timestampStartSec: start,
        timestampEndSec: end,
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
  }

  function writeWikiPage(path: string, type: string, status: string, title: string, userContent: string): string {
    const fullPath = join(vaultRoot, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, [
      "---",
      `type: ${type}`,
      `status: ${status}`,
      "freshness_score: 1",
      "---",
      "",
      `# ${title}`,
      "",
      "<!-- podcast-note:start -->",
      "",
      "## 支持证据",
      "",
      "- seeded evidence",
      "",
      "<!-- podcast-note:end -->",
      "",
      userContent
    ].join("\n"));
    return path;
  }
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
