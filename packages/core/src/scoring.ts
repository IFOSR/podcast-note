import type { Episode, Watch } from "./types.ts";

export type RelevanceDecision = {
  decision: "skip" | "sample" | "process";
  metadataScore: number;
  matchedTerms: string[];
  excludedTerms: string[];
  reason: string;
};

export function scoreEpisodeMetadata(watch: Watch, episode: Episode): RelevanceDecision {
  const haystack = [
    episode.title,
    episode.description ?? "",
    episode.language ?? "",
    String(episode.metadata?.["author"] ?? ""),
    String(episode.metadata?.["guests"] ?? "")
  ]
    .join("\n")
    .toLowerCase();

  const includeTerms = uniqueTerms([watch.query, ...watch.includeTerms, ...watch.expandedTerms]);
  const excludeTerms = uniqueTerms(watch.excludeTerms);
  const matchedTerms = includeTerms.filter((term) => haystack.includes(term.toLowerCase()));
  const excludedTerms = excludeTerms.filter((term) => haystack.includes(term.toLowerCase()));

  if (excludedTerms.length > 0) {
    return {
      decision: "skip",
      metadataScore: 0,
      matchedTerms,
      excludedTerms,
      reason: `Excluded by terms: ${excludedTerms.join(", ")}`
    };
  }

  const exactTitleBoost = matchedTerms.some((term) => episode.title.toLowerCase().includes(term.toLowerCase())) ? 0.2 : 0;
  const score = Math.min(1, matchedTerms.length / Math.max(3, includeTerms.length) + exactTitleBoost);
  const decision = score >= watch.minRelevanceScore ? "process" : score >= 0.25 ? "sample" : "skip";

  return {
    decision,
    metadataScore: roundScore(score),
    matchedTerms,
    excludedTerms,
    reason:
      matchedTerms.length > 0
        ? `Matched metadata terms: ${matchedTerms.slice(0, 8).join(", ")}`
        : "No strong metadata match."
  };
}

function uniqueTerms(terms: string[]): string[] {
  const normalized = terms
    .flatMap((term) => term.split(/[,\n]/))
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
  return [...new Set(normalized)];
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

