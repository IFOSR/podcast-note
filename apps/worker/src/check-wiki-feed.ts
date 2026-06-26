import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-wiki-feed-"));
const dbPath = join(dir, "check.sqlite");

try {
  const repos = createRepositories(openPodcastNoteDb(dbPath));
  const user = repos.upsertUser({ id: "user_wiki_feed", email: "wiki-feed@example.invalid", name: "Wiki Feed" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const vaultRoot = join(dir, "vault");
  repos.upsertWatch({
    id: "watch_feed",
    workspaceId: workspace.id,
    name: "Wiki Feed Watch",
    type: "topic",
    query: "AI Agent",
    outputLanguage: "zh-CN",
    includeTerms: ["AI Agent"],
    excludeTerms: [],
    expandedTerms: [],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 30,
    enabled: true
  });
  repos.upsertEpisode({
    id: "episode_feed",
    title: "Wiki Feed Episode",
    pageUrl: "https://example.invalid/wiki-feed",
    audioUrl: "https://example.invalid/wiki-feed.mp3",
    publishedAt: "2026-06-25T00:00:00.000Z"
  });
  repos.saveProcessingResult({
    episode: {
      id: "episode_feed",
      title: "Wiki Feed Episode",
      pageUrl: "https://example.invalid/wiki-feed",
      audioUrl: "https://example.invalid/wiki-feed.mp3",
      publishedAt: "2026-06-25T00:00:00.000Z"
    },
    summary: {
      oneLiner: "Wiki feed smoke.",
      overview: "Wiki feed smoke.",
      chapters: [],
      worthListening: { recommendation: "listen_segments", reason: "Smoke.", bestSegments: [] },
      entities: []
    },
    segments: [{
      index: 0,
      startSec: 0,
      endSec: 60,
      text: "新证据挑战旧观点。",
      textExcerpt: "新证据挑战旧观点。",
      title: "Conflict",
      summary: "Conflict."
    }],
    insights: [{
      id: "insight_feed",
      workspaceId: workspace.id,
      watchId: "watch_feed",
      episodeId: "episode_feed",
      segmentIndex: 0,
      claim: "新证据挑战旧观点",
      evidenceExcerpt: "新证据挑战旧观点。",
      reasoning: "Smoke.",
      implication: "旧观点需要复查。",
      timestampStartSec: 0,
      timestampEndSec: 60,
      entities: [],
      relevanceScore: 0.9,
      confidence: 0.88,
      groundednessScore: 0.86,
      outputLanguage: "zh-CN",
      status: "published",
      promptVersion: "watch-insight-v1",
      model: "check"
    }]
  }, {
    id: "watch_feed",
    workspaceId: workspace.id,
    name: "Wiki Feed Watch",
    type: "topic",
    query: "AI Agent",
    outputLanguage: "zh-CN",
    includeTerms: ["AI Agent"],
    excludeTerms: [],
    expandedTerms: [],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 30,
    enabled: true
  }, "check");

  repos.upsertWikiPage({
    workspaceId: workspace.id,
    vaultRoot,
    path: "40 Claims/Agent 产品竞争转向工作流.md",
    pageType: "claim",
    title: "Agent 产品竞争转向工作流",
    status: "active",
    sourceCount: 2,
    confidenceScore: 0.88,
    freshnessScore: 0.92,
    contradictionCount: 0,
    lastSupportedAt: "2026-06-25T10:00:00.000Z",
    lastReviewedAt: "2026-06-25T10:00:00.000Z",
    contentHash: "hash_claim"
  });
  repos.upsertWikiPage({
    workspaceId: workspace.id,
    vaultRoot,
    path: "40 Claims/旧 Agent 结论.md",
    pageType: "claim",
    title: "旧 Agent 结论",
    status: "stale",
    sourceCount: 1,
    confidenceScore: 0.42,
    freshnessScore: 0.28,
    contradictionCount: 1,
    lastSupportedAt: "2026-01-01T00:00:00.000Z",
    lastContradictedAt: "2026-06-24T00:00:00.000Z",
    lastReviewedAt: "2026-06-25T10:00:00.000Z",
    contentHash: "hash_stale"
  });
  repos.recordWikiExport({
    workspaceId: workspace.id,
    vaultRoot,
    episodeId: "episode_feed",
    watchId: "watch_feed",
    exportType: "wiki_page",
    filePath: "40 Claims/Agent 产品竞争转向工作流.md",
    contentHash: "hash_claim",
    status: "written"
  });
  repos.upsertWikiUpdateProposal({
    id: "wiki_prop_feed_conflict",
    workspaceId: workspace.id,
    episodeId: "episode_feed",
    insightId: "insight_feed",
    targetPath: "40 Claims/旧 Agent 结论.md",
    proposalType: "flag_conflict",
    title: "发现旧 Agent 结论冲突",
    rationale: "新证据挑战旧观点。",
    patch: {
      section: "冲突与反证",
      operation: "append",
      markdown: "- 新证据挑战旧观点。",
      citations: [{ episodeId: "episode_feed", insightId: "insight_feed" }]
    },
    status: "pending"
  });

  const output = await $`bun apps/worker/src/cli.ts wiki:feed --db ${dbPath} --workspace-id ${workspace.id} --vault ${vaultRoot} --since-days 30 --format json`.text();
  const parsed = JSON.parse(output) as {
    ok: boolean;
    counts: Record<string, number>;
    feed: Array<{ type: string; title: string; targetPath?: string; status?: string }>;
  };
  if (!parsed.ok) throw new Error(`Expected ok feed output, got ${output}`);
  if (parsed.counts.pendingProposals !== 1 || parsed.counts.conflicts !== 1 || parsed.counts.stalePages !== 1) {
    throw new Error(`Unexpected feed counts: ${JSON.stringify(parsed.counts)}`);
  }
  if (!parsed.feed.some((item) => item.type === "conflict_detected" && item.targetPath === "40 Claims/旧 Agent 结论.md")) {
    throw new Error(`Expected conflict feed item, got ${JSON.stringify(parsed.feed)}`);
  }
  if (!parsed.feed.some((item) => item.type === "marked_stale" && item.status === "stale")) {
    throw new Error(`Expected stale feed item, got ${JSON.stringify(parsed.feed)}`);
  }
  if (!parsed.feed.some((item) => item.type === "new_claim")) {
    throw new Error(`Expected updated page feed item, got ${JSON.stringify(parsed.feed)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    counts: parsed.counts,
    feedTypes: parsed.feed.map((item) => item.type)
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
