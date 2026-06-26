import { stableId } from "../../../packages/core/src/format.ts";
import type { Insight } from "../../../packages/core/src/types.ts";
import type { createRepositories } from "../../../packages/db/src/index.ts";
import type { WikiPageEvidenceRecord, WikiPageRecord } from "../../../packages/db/src/repositories.ts";
import type { WikiUpdateProposal } from "../../../packages/wiki/src/index.ts";

type Repositories = ReturnType<typeof createRepositories>;

export function scanWikiConflictProposals(input: {
  repositories: Repositories;
  workspaceId: string;
  vaultRoot: string;
  now?: string;
  minConfidence?: number;
  minGroundedness?: number;
  limit?: number;
}): WikiUpdateProposal[] {
  const pages = input.repositories.listWikiPages({
    workspaceId: input.workspaceId,
    vaultRoot: input.vaultRoot,
    pageType: "claim",
    limit: input.limit ?? 200
  }).filter((page) => page.status === "active" || page.status === "stale" || page.status === "contested");
  const allEvidence = input.repositories.listWikiPageEvidence({
    workspaceId: input.workspaceId,
    limit: (input.limit ?? 200) * 10
  });
  const insights = uniqueInsights(input.repositories.listWatchesForWorkspace(input.workspaceId)
    .flatMap((watch) => input.repositories.getLatestInsightsForWatch(watch.id, input.limit ?? 200)))
    .filter((insight) =>
      insight.status === "published"
      && insight.confidence >= (input.minConfidence ?? 0.75)
      && (insight.groundednessScore ?? 0) >= (input.minGroundedness ?? 0.8)
      && hasConflictSignal(insight)
    );

  const proposals: WikiUpdateProposal[] = [];
  for (const page of pages) {
    const supporting = allEvidence.find((evidence) => evidence.pageId === page.id && evidence.supportType === "supporting");
    if (!supporting) continue;
    const candidate = insights.find((insight) => insight.id !== supporting.insightId && isPotentialConflict(page, supporting, insight));
    if (!candidate) continue;
    proposals.push(buildConflictProposal({
      page,
      supporting,
      contradicting: candidate,
      now: input.now
    }));
  }
  return dedupeById(proposals);
}

function buildConflictProposal(input: {
  page: WikiPageRecord;
  supporting: WikiPageEvidenceRecord;
  contradicting: Insight;
  now?: string;
}): WikiUpdateProposal {
  return {
    id: stableId("wiki_prop", `${input.page.id}:conflict:${input.supporting.insightId}:${input.contradicting.id}`),
    workspaceId: input.page.workspaceId,
    episodeId: input.contradicting.episodeId,
    insightId: input.contradicting.id,
    targetPath: input.page.path,
    proposalType: "flag_conflict",
    title: `发现冲突：${input.page.title}`,
    rationale: `新 insight 挑战已有 claim，且同时具备旧支持证据 ${input.supporting.insightId} 和新反证 ${input.contradicting.id}。`,
    patch: {
      section: "冲突与反证",
      operation: "append",
      markdown: [
        `- 旧支持：${input.supporting.claim} (insight_id: ${input.supporting.insightId})`,
        `- 新反证：${input.contradicting.claim} (insight_id: ${input.contradicting.id})`
      ].join("\n"),
      citations: [
        {
          episodeId: input.supporting.episodeId,
          insightId: input.supporting.insightId,
          timestampStartSec: input.supporting.timestampStartSec,
          timestampEndSec: input.supporting.timestampEndSec
        },
        {
          episodeId: input.contradicting.episodeId,
          insightId: input.contradicting.id,
          timestampStartSec: input.contradicting.timestampStartSec,
          timestampEndSec: input.contradicting.timestampEndSec
        }
      ]
    },
    status: "pending",
    createdAt: input.now,
    updatedAt: input.now
  };
}

function isPotentialConflict(page: WikiPageRecord, evidence: WikiPageEvidenceRecord, insight: Insight): boolean {
  const oldTokens = keywords(`${page.title} ${evidence.claim}`);
  const newTokens = new Set(keywords(`${insight.claim} ${insight.evidenceExcerpt}`));
  return oldTokens.some((token) => newTokens.has(token));
}

function hasConflictSignal(insight: Insight): boolean {
  return /反驳|挑战|相反|不再|并非|不是|下降|失效|过时|contradict|challenge|opposite|decline|obsolete/i.test(
    `${insight.claim} ${insight.evidenceExcerpt} ${insight.reasoning ?? ""}`
  );
}

function keywords(input: string): string[] {
  return Array.from(new Set(input
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !/^(新证据|旧观点|反驳|挑战|不再|相反|并非|不是)$/.test(token))));
}

function uniqueInsights(insights: Insight[]): Insight[] {
  const seen = new Set<string>();
  return insights.filter((insight) => {
    if (seen.has(insight.id)) return false;
    seen.add(insight.id);
    return true;
  });
}

function dedupeById(proposals: WikiUpdateProposal[]): WikiUpdateProposal[] {
  const seen = new Set<string>();
  return proposals.filter((proposal) => {
    if (seen.has(proposal.id)) return false;
    seen.add(proposal.id);
    return true;
  });
}
