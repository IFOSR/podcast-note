import type { Insight, SemanticSegment } from "./types.ts";

export type GroundednessResult = {
  score: number;
  supportsClaim: boolean;
  issue: "none" | "missing_evidence" | "timestamp_out_of_range" | "evidence_not_found" | "vague_claim";
};

export function checkGroundedness(insight: Insight, segments: SemanticSegment[]): GroundednessResult {
  if (insight.evidenceExcerpt.trim().length < 8) {
    return { score: 0, supportsClaim: false, issue: "missing_evidence" };
  }

  const matchingSegments = segments.filter(
    (segment) =>
      insight.timestampStartSec >= segment.startSec - 3 &&
      insight.timestampEndSec <= segment.endSec + 3
  );

  if (matchingSegments.length === 0) {
    return { score: 0.2, supportsClaim: false, issue: "timestamp_out_of_range" };
  }

  const context = matchingSegments.map((segment) => segment.text).join(" ");
  const evidenceFound = fuzzyIncludes(context, insight.evidenceExcerpt);
  if (!evidenceFound) {
    return { score: 0.45, supportsClaim: false, issue: "evidence_not_found" };
  }

  if (isVagueClaim(insight.claim)) {
    return { score: 0.6, supportsClaim: false, issue: "vague_claim" };
  }

  return { score: 0.85, supportsClaim: true, issue: "none" };
}

export function publishableInsight(insight: Insight, segments: SemanticSegment[], minRelevanceScore: number): Insight {
  const groundedness = checkGroundedness(insight, segments);
  const status =
    groundedness.score >= 0.75 && insight.relevanceScore >= minRelevanceScore && insight.confidence >= 0.65
      ? "published"
      : groundedness.score >= 0.55
        ? "draft"
        : "suppressed";

  return {
    ...insight,
    groundednessScore: groundedness.score,
    status
  };
}

function fuzzyIncludes(context: string, excerpt: string): boolean {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "")
      .trim();
  const normalizedContext = normalize(context);
  const normalizedExcerpt = normalize(excerpt);
  return normalizedExcerpt.length > 0 && normalizedContext.includes(normalizedExcerpt.slice(0, 120));
}

function isVagueClaim(claim: string): boolean {
  return /interesting|有趣|很多内容|various topics|值得关注/i.test(claim) && claim.length < 40;
}

