import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-wiki-decay-"));
const dbPath = join(dir, "check.sqlite");
const vaultRoot = join(dir, "vault");

try {
  const repos = createRepositories(openPodcastNoteDb(dbPath));
  const user = repos.upsertUser({ id: "user_wiki_decay", email: "wiki-decay@example.invalid", name: "Wiki Decay" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  repos.upsertWatch({
    id: "watch_wiki_decay",
    workspaceId: workspace.id,
    name: "Wiki Decay Watch",
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
    id: "episode_wiki_decay",
    title: "Wiki Decay Evidence",
    pageUrl: "https://example.invalid/wiki-decay",
    audioUrl: "https://example.invalid/wiki-decay.mp3",
    publishedAt: "2026-01-01T00:00:00.000Z"
  });
  repos.saveProcessingResult({
    episode: {
      id: "episode_wiki_decay",
      title: "Wiki Decay Evidence",
      pageUrl: "https://example.invalid/wiki-decay",
      audioUrl: "https://example.invalid/wiki-decay.mp3",
      publishedAt: "2026-01-01T00:00:00.000Z"
    },
    summary: {
      oneLiner: "Old evidence.",
      overview: "Old evidence.",
      chapters: [],
      worthListening: { recommendation: "listen_segments", reason: "Old.", bestSegments: [] },
      entities: []
    },
    segments: [{
      index: 0,
      startSec: 0,
      endSec: 60,
      text: "旧增长结论。",
      textExcerpt: "旧增长结论。",
      title: "Old",
      summary: "Old."
    }],
    insights: [{
      id: "insight_wiki_decay",
      workspaceId: workspace.id,
      watchId: "watch_wiki_decay",
      episodeId: "episode_wiki_decay",
      segmentIndex: 0,
      claim: "旧增长结论",
      evidenceExcerpt: "旧增长结论。",
      reasoning: "Old.",
      implication: "Needs decay.",
      timestampStartSec: 0,
      timestampEndSec: 60,
      entities: [],
      relevanceScore: 0.8,
      confidence: 0.7,
      groundednessScore: 0.8,
      outputLanguage: "zh-CN",
      status: "published",
      promptVersion: "watch-insight-v1",
      model: "check"
    }]
  }, {
    id: "watch_wiki_decay",
    workspaceId: workspace.id,
    name: "Wiki Decay Watch",
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
  const stalePage = repos.upsertWikiPage({
    workspaceId: workspace.id,
    vaultRoot,
    path: "40 Claims/旧增长结论.md",
    pageType: "claim",
    title: "旧增长结论",
    status: "active",
    sourceCount: 1,
    confidenceScore: 0.52,
    freshnessScore: 1,
    contradictionCount: 0,
    lastSupportedAt: "2026-01-01T00:00:00.000Z",
    lastReviewedAt: "2026-01-01T00:00:00.000Z",
    contentHash: "old_hash"
  });
  const archivePage = repos.upsertWikiPage({
    workspaceId: workspace.id,
    vaultRoot,
    path: "40 Claims/应归档旧结论.md",
    pageType: "claim",
    title: "应归档旧结论",
    status: "deprecated",
    sourceCount: 1,
    confidenceScore: 0.2,
    freshnessScore: 0.2,
    contradictionCount: 0,
    lastSupportedAt: "2025-01-01T00:00:00.000Z",
    lastReviewedAt: "2026-01-01T00:00:00.000Z",
    contentHash: "archive_hash"
  });
  for (const page of [stalePage, archivePage]) {
    repos.upsertWikiPageEvidence({
      workspaceId: workspace.id,
      pageId: page.id,
      insightId: "insight_wiki_decay",
      episodeId: "episode_wiki_decay",
      watchId: "watch_wiki_decay",
      supportType: "supporting",
      claim: "旧增长结论",
      evidenceExcerpt: "旧增长结论。",
      timestampStartSec: 0,
      timestampEndSec: 60,
      confidence: 0.7,
      groundednessScore: 0.8,
      observedAt: "2026-01-01T00:00:00.000Z"
    });
  }

  const output = await $`bun apps/worker/src/cli.ts wiki:decay --db ${dbPath} --workspace-id ${workspace.id} --vault ${vaultRoot} --now 2026-06-26T12:00:00.000Z --stale-days 90`.text();
  const parsed = JSON.parse(output) as { ok: boolean; proposalCount: number; proposals: Array<{ proposalType: string; targetPath: string }> };
  if (!parsed.ok || parsed.proposalCount < 2) throw new Error(`Expected decay proposals, got ${output}`);
  if (!parsed.proposals.some((proposal) => proposal.proposalType === "mark_stale" && proposal.targetPath === "40 Claims/旧增长结论.md")) {
    throw new Error(`Expected mark_stale proposal, got ${JSON.stringify(parsed.proposals)}`);
  }
  if (!parsed.proposals.some((proposal) => proposal.proposalType === "archive_page" && proposal.targetPath === "40 Claims/应归档旧结论.md")) {
    throw new Error(`Expected archive_page proposal, got ${JSON.stringify(parsed.proposals)}`);
  }
  const persisted = repos.listWikiUpdateProposals({ workspaceId: workspace.id, status: "pending" });
  if (!persisted.some((proposal) => proposal.proposalType === "archive_page" && proposal.patch.operation === "move")) {
    throw new Error(`Expected persisted move archive proposal, got ${JSON.stringify(persisted)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    proposalCount: parsed.proposalCount,
    proposalTypes: parsed.proposals.map((proposal) => proposal.proposalType)
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
