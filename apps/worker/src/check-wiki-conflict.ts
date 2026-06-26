import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-wiki-conflict-"));
const dbPath = join(dir, "check.sqlite");
const vaultRoot = join(dir, "vault");

try {
  const repos = createRepositories(openPodcastNoteDb(dbPath));
  const user = repos.upsertUser({ id: "user_wiki_conflict", email: "wiki-conflict@example.invalid", name: "Wiki Conflict" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const watch = {
    id: "watch_wiki_conflict",
    workspaceId: workspace.id,
    name: "Agent Conflict",
    type: "topic" as const,
    query: "Agent 工作流",
    outputLanguage: "zh-CN",
    includeTerms: ["Agent"],
    excludeTerms: [],
    expandedTerms: [],
    minRelevanceScore: 0.65,
    frequency: "daily" as const,
    backfillDays: 30,
    enabled: true
  };
  repos.upsertWatch(watch);
  repos.upsertEpisode({
    id: "episode_conflict_old",
    title: "Old Agent Evidence",
    pageUrl: "https://example.invalid/old",
    audioUrl: "https://example.invalid/old.mp3"
  });
  repos.upsertEpisode({
    id: "episode_conflict_new",
    title: "New Agent Evidence",
    pageUrl: "https://example.invalid/new",
    audioUrl: "https://example.invalid/new.mp3"
  });
  repos.saveProcessingResult({
    episode: { id: "episode_conflict_old", title: "Old Agent Evidence", pageUrl: "https://example.invalid/old", audioUrl: "https://example.invalid/old.mp3" },
    summary: { oneLiner: "Old.", overview: "Old.", chapters: [], worthListening: { recommendation: "listen_segments", reason: "Old.", bestSegments: [] }, entities: [] },
    segments: [{ index: 0, startSec: 10, endSec: 40, text: "Agent 产品竞争转向企业工作流。", textExcerpt: "Agent 产品竞争转向企业工作流。", title: "Old", summary: "Old." }],
    insights: [{
      id: "insight_conflict_old",
      workspaceId: workspace.id,
      watchId: watch.id,
      episodeId: "episode_conflict_old",
      segmentIndex: 0,
      claim: "Agent 产品竞争转向企业工作流",
      evidenceExcerpt: "Agent 产品竞争转向企业工作流。",
      timestampStartSec: 10,
      timestampEndSec: 40,
      entities: [],
      relevanceScore: 0.9,
      confidence: 0.88,
      groundednessScore: 0.86,
      outputLanguage: "zh-CN",
      status: "published",
      promptVersion: "watch-insight-v1",
      model: "check"
    }]
  }, watch, "check");
  repos.saveProcessingResult({
    episode: { id: "episode_conflict_new", title: "New Agent Evidence", pageUrl: "https://example.invalid/new", audioUrl: "https://example.invalid/new.mp3" },
    summary: { oneLiner: "New.", overview: "New.", chapters: [], worthListening: { recommendation: "listen_segments", reason: "New.", bestSegments: [] }, entities: [] },
    segments: [{ index: 0, startSec: 50, endSec: 90, text: "新证据挑战 Agent 产品竞争转向企业工作流，企业工作流并非唯一方向。", textExcerpt: "新证据挑战 Agent 产品竞争转向企业工作流。", title: "New", summary: "New." }],
    insights: [{
      id: "insight_conflict_new",
      workspaceId: workspace.id,
      watchId: watch.id,
      episodeId: "episode_conflict_new",
      segmentIndex: 0,
      claim: "新证据挑战 Agent 产品竞争转向企业工作流，企业工作流并非唯一方向",
      evidenceExcerpt: "新证据挑战 Agent 产品竞争转向企业工作流。",
      timestampStartSec: 50,
      timestampEndSec: 90,
      entities: [],
      relevanceScore: 0.92,
      confidence: 0.9,
      groundednessScore: 0.88,
      outputLanguage: "zh-CN",
      status: "published",
      promptVersion: "watch-insight-v1",
      model: "check"
    }]
  }, watch, "check");

  const page = repos.upsertWikiPage({
    workspaceId: workspace.id,
    vaultRoot,
    path: "40 Claims/Agent 产品竞争转向企业工作流.md",
    pageType: "claim",
    title: "Agent 产品竞争转向企业工作流",
    status: "active",
    sourceCount: 1,
    confidenceScore: 0.88,
    freshnessScore: 0.9,
    contradictionCount: 0,
    lastSupportedAt: "2026-06-20T00:00:00.000Z"
  });
  repos.upsertWikiPageEvidence({
    workspaceId: workspace.id,
    pageId: page.id,
    insightId: "insight_conflict_old",
    episodeId: "episode_conflict_old",
    watchId: watch.id,
    supportType: "supporting",
    claim: "Agent 产品竞争转向企业工作流",
    evidenceExcerpt: "Agent 产品竞争转向企业工作流。",
    timestampStartSec: 10,
    timestampEndSec: 40,
    confidence: 0.88,
    groundednessScore: 0.86,
    observedAt: "2026-06-20T00:00:00.000Z"
  });
  repos.upsertWikiPage({
    workspaceId: workspace.id,
    vaultRoot,
    path: "40 Claims/没有证据对的页面.md",
    pageType: "claim",
    title: "没有证据对的页面",
    status: "active",
    sourceCount: 0,
    confidenceScore: 0,
    freshnessScore: 1,
    contradictionCount: 0
  });

  const output = await $`bun apps/worker/src/cli.ts wiki:conflict --db ${dbPath} --workspace-id ${workspace.id} --vault ${vaultRoot} --now 2026-06-26T12:00:00.000Z`.text();
  const parsed = JSON.parse(output) as {
    ok: boolean;
    proposalCount: number;
    proposals: Array<{ proposalType: string; targetPath: string; patch: { citations: unknown[]; markdown: string } }>;
  };
  if (!parsed.ok || parsed.proposalCount !== 1) throw new Error(`Expected exactly one conflict proposal, got ${output}`);
  const proposal = parsed.proposals[0];
  if (proposal.proposalType !== "flag_conflict") throw new Error(`Expected flag_conflict, got ${proposal.proposalType}`);
  if (proposal.targetPath !== "40 Claims/Agent 产品竞争转向企业工作流.md") throw new Error(`Unexpected conflict target: ${proposal.targetPath}`);
  if (proposal.patch.citations.length !== 2) throw new Error(`Conflict proposal must include an evidence pair, got ${JSON.stringify(proposal.patch)}`);
  if (!proposal.patch.markdown.includes("insight_conflict_old") || !proposal.patch.markdown.includes("insight_conflict_new")) {
    throw new Error(`Conflict markdown must include old and new evidence ids: ${proposal.patch.markdown}`);
  }
  const persisted = repos.listWikiUpdateProposals({ workspaceId: workspace.id, status: "pending", limit: 10 });
  if (persisted.length !== 1 || persisted[0]?.proposalType !== "flag_conflict") {
    throw new Error(`Expected persisted conflict proposal, got ${JSON.stringify(persisted)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    proposalCount: parsed.proposalCount,
    targetPath: proposal.targetPath,
    citationCount: proposal.patch.citations.length
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
