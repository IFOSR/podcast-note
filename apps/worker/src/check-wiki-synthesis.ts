import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import type { EpisodeProcessingResult, Watch } from "../../../packages/core/src/types.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-wiki-synthesis-"));
const dbPath = join(dir, "check.sqlite");
const vaultRoot = join(dir, "vault");

try {
  const repos = createRepositories(openPodcastNoteDb(dbPath));
  const user = repos.upsertUser({ id: "user_wiki_synthesis", email: "wiki-synthesis@example.invalid", name: "Wiki Synthesis" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const watch: Watch = {
    id: "watch_wiki_synthesis",
    workspaceId: workspace.id,
    name: "AI Agent 商业化",
    type: "topic",
    query: "AI Agent 商业化",
    outputLanguage: "zh-CN",
    includeTerms: ["AI Agent"],
    excludeTerms: [],
    expandedTerms: ["enterprise workflow"],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 30,
    enabled: true
  };
  repos.upsertWatch(watch);
  seedResult("episode_synthesis_a", "AI Agent 开始进入企业工作流。", 0.9);
  seedResult("episode_synthesis_b", "企业客户要求审计和可控执行，推动 Agent 商业化。", 0.88);

  const output = await $`bun apps/worker/src/cli.ts wiki:synthesize --db ${dbPath} --workspace-id ${workspace.id} --vault ${vaultRoot} --since-days 30 --now 2026-06-26T12:00:00.000Z`.text();
  const parsed = JSON.parse(output) as { ok: boolean; proposalCount: number; proposals: Array<{ proposalType: string; targetPath: string; status: string }> };
  if (!parsed.ok || parsed.proposalCount < 1) throw new Error(`Expected synthesis proposals, got ${output}`);
  const proposal = parsed.proposals.find((item) => item.proposalType === "refresh_synthesis");
  if (!proposal) throw new Error(`Expected refresh_synthesis proposal, got ${JSON.stringify(parsed.proposals)}`);
  if (proposal.targetPath !== "20 Concepts/AI Agent 商业化.md" || proposal.status !== "pending") {
    throw new Error(`Unexpected synthesis proposal: ${JSON.stringify(proposal)}`);
  }
  const persisted = repos.listWikiUpdateProposals({ workspaceId: workspace.id, status: "pending" });
  if (!persisted.some((item) => item.proposalType === "refresh_synthesis" && item.patch.operation === "replace_managed_section")) {
    throw new Error(`Expected persisted managed-section synthesis proposal, got ${JSON.stringify(persisted)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    proposalCount: parsed.proposalCount,
    targetPath: proposal.targetPath
  }, null, 2));

  function seedResult(episodeId: string, evidence: string, confidence: number): void {
    const result: EpisodeProcessingResult = {
      episode: {
        id: episodeId,
        title: episodeId,
        pageUrl: `https://example.invalid/${episodeId}`,
        audioUrl: `https://example.invalid/${episodeId}.mp3`,
        publishedAt: "2026-06-25T00:00:00.000Z"
      },
      summary: {
        oneLiner: evidence,
        overview: evidence,
        chapters: [],
        worthListening: { recommendation: "listen_segments", reason: "Relevant.", bestSegments: [] },
        entities: []
      },
      segments: [{
        index: 0,
        startSec: 0,
        endSec: 60,
        text: evidence,
        textExcerpt: evidence,
        title: "Evidence",
        summary: evidence
      }],
      insights: [{
        id: `insight_${episodeId}`,
        workspaceId: workspace.id,
        watchId: watch.id,
        episodeId,
        segmentIndex: 0,
        claim: evidence.replace(/。$/, ""),
        evidenceExcerpt: evidence,
        reasoning: "Synthesis seed.",
        implication: "Supports concept synthesis.",
        timestampStartSec: 0,
        timestampEndSec: 60,
        entities: [],
        relevanceScore: 0.9,
        confidence,
        groundednessScore: 0.9,
        outputLanguage: "zh-CN",
        status: "published",
        promptVersion: "watch-insight-v1",
        model: "check"
      }]
    };
    repos.upsertEpisode(result.episode);
    repos.saveProcessingResult(result, watch, "check");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
