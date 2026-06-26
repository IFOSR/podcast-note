import type { createRepositories } from "../../../packages/db/src/index.ts";
import type { WikiPageType, WikiUpdateProposalRecord } from "../../../packages/db/src/repositories.ts";
import type { EpisodeProcessingResult, Insight, Watch } from "../../../packages/core/src/types.ts";
import type { WikiCompileResult, WikiUpdateProposal } from "../../../packages/wiki/src/index.ts";

type Repositories = ReturnType<typeof createRepositories>;

export function recordCompiledWikiRegistry(input: {
  repositories: Repositories;
  vaultRoot: string;
  watch: Watch;
  result: EpisodeProcessingResult;
  compiled: WikiCompileResult;
  observedAt?: string;
}): void {
  const observedAt = input.observedAt ?? new Date().toISOString();
  input.repositories.upsertWikiPage({
    workspaceId: input.watch.workspaceId,
    vaultRoot: input.vaultRoot,
    path: input.compiled.sourceNotePath,
    pageType: "source",
    title: titleFromPath(input.compiled.sourceNotePath),
    status: "active",
    sourceCount: 1,
    confidenceScore: 1,
    freshnessScore: 1,
    contradictionCount: 0,
    lastSupportedAt: observedAt,
    lastReviewedAt: observedAt,
    contentHash: input.compiled.sourceNoteHash
  });

  for (const path of input.compiled.appliedPaths) {
    upsertAppliedPage({
      repositories: input.repositories,
      workspaceId: input.watch.workspaceId,
      vaultRoot: input.vaultRoot,
      path,
      contentHash: input.compiled.appliedHashes[path],
      observedAt,
      insight: bestInsightForPath(input.result.insights, input.compiled.proposals, path)
    });
  }

  for (const proposal of input.compiled.proposals) {
    if (proposal.status !== "applied" || !proposal.insightId) continue;
    const page = input.repositories.getWikiPageByPath({
      workspaceId: input.watch.workspaceId,
      vaultRoot: input.vaultRoot,
      path: proposal.targetPath
    });
    const insight = input.result.insights.find((item) => item.id === proposal.insightId);
    if (!page || !insight) continue;
    input.repositories.upsertWikiPageEvidence({
      workspaceId: input.watch.workspaceId,
      pageId: page.id,
      insightId: insight.id,
      episodeId: insight.episodeId,
      watchId: insight.watchId,
      supportType: supportTypeForProposal(proposal.proposalType),
      claim: insight.claim,
      evidenceExcerpt: insight.evidenceExcerpt,
      timestampStartSec: insight.timestampStartSec,
      timestampEndSec: insight.timestampEndSec,
      confidence: insight.confidence,
      groundednessScore: insight.groundednessScore ?? 0,
      observedAt
    });
  }
}

export function recordAppliedWikiProposalRegistry(input: {
  repositories: Repositories;
  workspaceId: string;
  vaultRoot: string;
  proposal: WikiUpdateProposalRecord;
  path: string;
  contentHash?: string;
  observedAt?: string;
}): void {
  if (input.proposal.status !== "applied") return;
  const observedAt = input.observedAt ?? new Date().toISOString();
  const insight = input.proposal.insightId
    ? input.repositories.listInsights({ episodeId: input.proposal.episodeId, limit: 100 })
      .find((item) => item.id === input.proposal.insightId)
    : undefined;
  const archivedFromPage = input.proposal.proposalType === "archive_page" && input.path !== input.proposal.targetPath
    ? input.repositories.getWikiPageByPath({
      workspaceId: input.workspaceId,
      vaultRoot: input.vaultRoot,
      path: input.proposal.targetPath
    })
    : undefined;
  const archivedEvidence = archivedFromPage
    ? input.repositories.listWikiPageEvidence({ pageId: archivedFromPage.id, limit: 1000 })
    : [];
  const page = upsertAppliedPage({
    repositories: input.repositories,
    workspaceId: input.workspaceId,
    vaultRoot: input.vaultRoot,
    path: input.path,
    contentHash: input.contentHash,
    observedAt,
    insight,
    proposal: input.proposal
  });
  for (const evidence of archivedEvidence) {
    input.repositories.upsertWikiPageEvidence({
      workspaceId: input.workspaceId,
      pageId: page.id,
      insightId: evidence.insightId,
      episodeId: evidence.episodeId,
      watchId: evidence.watchId,
      supportType: evidence.supportType,
      claim: evidence.claim,
      evidenceExcerpt: evidence.evidenceExcerpt,
      timestampStartSec: evidence.timestampStartSec,
      timestampEndSec: evidence.timestampEndSec,
      confidence: evidence.confidence,
      groundednessScore: evidence.groundednessScore,
      observedAt: evidence.observedAt
    });
  }
  if (archivedFromPage) {
    input.repositories.deleteWikiPageByPath({
      workspaceId: input.workspaceId,
      vaultRoot: input.vaultRoot,
      path: input.proposal.targetPath
    });
  }
  const citations = citationsFromPatch(input.proposal.patch);
  const evidenceRefs = citations.length > 0
    ? citations
    : input.proposal.insightId
      ? [{ insightId: input.proposal.insightId, episodeId: input.proposal.episodeId }]
      : [];
  for (const citation of evidenceRefs) {
    const insightId = stringOrUndefined(citation.insightId);
    if (!insightId) continue;
    const episodeId = stringOrUndefined(citation.episodeId) ?? input.proposal.episodeId;
    const citedInsight = input.repositories.listInsights({ episodeId, limit: 100 })
      .find((item) => item.id === insightId);
    input.repositories.upsertWikiPageEvidence({
      workspaceId: input.workspaceId,
      pageId: page.id,
      insightId,
      episodeId,
      watchId: citedInsight?.watchId,
      supportType: supportTypeForProposal(input.proposal.proposalType),
      claim: citedInsight?.claim ?? input.proposal.title,
      evidenceExcerpt: citedInsight?.evidenceExcerpt ?? markdownFromPatch(input.proposal.patch),
      timestampStartSec: numberOrUndefined(citation.timestampStartSec),
      timestampEndSec: numberOrUndefined(citation.timestampEndSec),
      confidence: citedInsight?.confidence ?? 0,
      groundednessScore: citedInsight?.groundednessScore ?? 0,
      observedAt
    });
  }
}

function upsertAppliedPage(input: {
  repositories: Repositories;
  workspaceId: string;
  vaultRoot: string;
  path: string;
  contentHash?: string;
  observedAt: string;
  insight?: Insight;
  proposal?: WikiUpdateProposalRecord | WikiUpdateProposal;
}) {
  const status = statusForAppliedPage(input.path, input.proposal);
  return input.repositories.upsertWikiPage({
    workspaceId: input.workspaceId,
    vaultRoot: input.vaultRoot,
    path: input.path,
    pageType: pageTypeFromPath(input.path),
    title: titleFromPath(input.path),
    status,
    sourceCount: 1,
    confidenceScore: input.insight?.confidence ?? 0,
    freshnessScore: freshnessForAppliedPage(status, input.proposal),
    contradictionCount: 0,
    lastSupportedAt: input.observedAt,
    lastReviewedAt: input.observedAt,
    contentHash: input.contentHash
  });
}

function statusForAppliedPage(path: string, proposal?: WikiUpdateProposalRecord | WikiUpdateProposal): "active" | "stale" | "contested" | "deprecated" | "archived" {
  const frontmatterStatus = proposal ? stringFromPatchFrontmatter(proposal.patch, "status") : undefined;
  if (frontmatterStatus === "stale" || frontmatterStatus === "contested" || frontmatterStatus === "deprecated" || frontmatterStatus === "archived") {
    return frontmatterStatus;
  }
  if (proposal?.proposalType === "flag_conflict") return "contested";
  if (path.startsWith("80 Archive/") || proposal?.proposalType === "archive_page") return "archived";
  return "active";
}

function freshnessForAppliedPage(status: string, proposal?: WikiUpdateProposalRecord | WikiUpdateProposal): number {
  const freshness = proposal ? numberFromPatchFrontmatter(proposal.patch, "freshness_score") : undefined;
  if (freshness !== undefined) return freshness;
  if (status === "archived" || status === "deprecated") return 0;
  if (status === "stale") return 0.4;
  return 1;
}

function stringFromPatchFrontmatter(patch: Record<string, unknown>, key: string): "active" | "stale" | "contested" | "deprecated" | "archived" | undefined {
  const frontmatter = typeof patch.frontmatter === "object" && patch.frontmatter !== null
    ? patch.frontmatter as Record<string, unknown>
    : undefined;
  const value = frontmatter?.[key];
  if (value === "active" || value === "stale" || value === "contested" || value === "deprecated" || value === "archived") return value;
  return undefined;
}

function numberFromPatchFrontmatter(patch: Record<string, unknown>, key: string): number | undefined {
  const frontmatter = typeof patch.frontmatter === "object" && patch.frontmatter !== null
    ? patch.frontmatter as Record<string, unknown>
    : undefined;
  const value = frontmatter?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bestInsightForPath(insights: Insight[], proposals: WikiUpdateProposal[], path: string): Insight | undefined {
  const proposal = proposals.find((item) => item.targetPath === path && item.insightId);
  return proposal?.insightId ? insights.find((item) => item.id === proposal.insightId) : undefined;
}

function pageTypeFromPath(path: string): WikiPageType {
  if (path.startsWith("10 Sources/")) return "source";
  if (path.startsWith("20 Concepts/")) return "concept";
  if (path.startsWith("30 Entities/")) return "entity";
  if (path.startsWith("40 Claims/")) return "claim";
  if (path.startsWith("50 Briefs/")) return "brief";
  if (path.startsWith("80 Archive/Concepts/")) return "concept";
  if (path.startsWith("80 Archive/Entities/")) return "entity";
  if (path.startsWith("80 Archive/Claims/")) return "claim";
  return "claim";
}

function titleFromPath(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/i, "") ?? path;
}

function supportTypeForProposal(type: string): "supporting" | "contradicting" | "context" {
  if (type === "flag_conflict") return "contradicting";
  if (type === "add_crosslink") return "context";
  return "supporting";
}

function citationsFromPatch(patch: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(patch.citations)
    ? patch.citations.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : [];
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function markdownFromPatch(patch: Record<string, unknown>): string {
  return typeof patch.markdown === "string" ? patch.markdown : "";
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
