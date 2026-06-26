import { stableId } from "../../../packages/core/src/format.ts";
import type { Insight, Watch } from "../../../packages/core/src/types.ts";
import type { createRepositories } from "../../../packages/db/src/index.ts";
import type { WikiUpdateProposal } from "../../../packages/wiki/src/index.ts";

type Repositories = ReturnType<typeof createRepositories>;

export function synthesizeWikiProposals(input: {
  repositories: Repositories;
  workspaceId: string;
  vaultRoot: string;
  now?: string;
  minConfidence?: number;
  minGroundedness?: number;
  limit?: number;
}): WikiUpdateProposal[] {
  const watches = input.repositories.listWatchesForWorkspace(input.workspaceId);
  const proposals: WikiUpdateProposal[] = [];
  for (const watch of watches) {
    const insights = input.repositories.getLatestInsightsForWatch(watch.id, input.limit ?? 100)
      .filter((insight) =>
        insight.status === "published"
        && insight.confidence >= (input.minConfidence ?? 0.75)
        && (insight.groundednessScore ?? 0) >= (input.minGroundedness ?? 0.8)
      );
    if (insights.length < 2) continue;
    proposals.push(buildRefreshSynthesisProposal({ watch, insights, now: input.now }));
  }
  return proposals;
}

function buildRefreshSynthesisProposal(input: {
  watch: Watch;
  insights: Insight[];
  now?: string;
}): WikiUpdateProposal {
  const targetPath = `20 Concepts/${safeTitle(input.watch.query || input.watch.name)}.md`;
  const claims = input.insights.slice(0, 8);
  const markdown = [
    `截至 ${dateOnly(input.now)}，${input.watch.name} 相关播客证据显示：`,
    "",
    ...claims.map((insight) => `- ${insight.claim} (insight_id: ${insight.id})`)
  ].join("\n");
  return {
    id: stableId("wiki_prop", `${input.watch.id}:refresh_synthesis:${claims.map((insight) => insight.id).join(":")}`),
    workspaceId: input.watch.workspaceId,
    episodeId: claims[0].episodeId,
    insightId: claims[0].id,
    targetPath,
    proposalType: "refresh_synthesis",
    title: `更新主题综合判断：${input.watch.name}`,
    rationale: `最近 ${claims.length} 条高置信证据支持更新主题页综合判断。`,
    patch: {
      section: "当前综合判断",
      operation: "replace_managed_section",
      markdown,
      citations: claims.map((insight) => ({
        episodeId: insight.episodeId,
        insightId: insight.id,
        timestampStartSec: insight.timestampStartSec,
        timestampEndSec: insight.timestampEndSec
      }))
    },
    status: "pending"
  };
}

function safeTitle(input: string): string {
  return input.replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
}

function dateOnly(input?: string): string {
  return (input ?? new Date().toISOString()).slice(0, 10);
}
