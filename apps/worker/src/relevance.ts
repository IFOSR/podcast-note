import type { Episode, Watch } from "../../../packages/core/src/types.ts";
import type { createRepositories } from "../../../packages/db/src/repositories.ts";

type Repositories = ReturnType<typeof createRepositories>;

export type RelevanceDecision = {
  episode: Episode;
  accepted: boolean;
  score: number;
  reason: Record<string, unknown>;
};

export type EnqueueRelevantEpisodesInput = {
  repositories: Repositories;
  workspaceId: string;
  watch: Watch;
  episodes: Episode[];
  queuedAt?: string;
};

export type EnqueueRelevantEpisodesResult = {
  candidateCount: number;
  queuedCount: number;
  decisions: RelevanceDecision[];
};

export function enqueueRelevantEpisodes(input: EnqueueRelevantEpisodesInput): EnqueueRelevantEpisodesResult {
  let queuedCount = 0;
  const decisions = input.episodes.map((episode) => scoreEpisodeForWatch(episode, input.watch));
  for (const decision of decisions) {
    if (!decision.accepted) continue;
    input.repositories.enqueueEpisodeProcessingJob({
      workspaceId: input.workspaceId,
      watchId: input.watch.id,
      episodeId: decision.episode.id,
      sourceUrl: decision.episode.pageUrl,
      queuedAt: input.queuedAt,
      relevanceScore: decision.score,
      relevanceReason: decision.reason
    });
    queuedCount += 1;
  }

  return {
    candidateCount: input.episodes.length,
    queuedCount,
    decisions
  };
}

export function scoreEpisodeForWatch(episode: Episode, watch: Watch): RelevanceDecision {
  const haystack = normalizeText([
    episode.title,
    episode.description,
    episode.language,
    episode.pageUrl,
    ...Object.values(episode.metadata ?? {}).map((value) => typeof value === "string" ? value : JSON.stringify(value))
  ].filter(Boolean).join("\n"));
  const queryTokens = tokenize(watch.query);
  const sourceQuery = isHttpUrl(watch.query);
  const includeTerms = uniqueTerms([...watch.includeTerms, ...watch.expandedTerms]);
  const excludeTerms = uniqueTerms(watch.excludeTerms);

  const matchedQueryTokens = queryTokens.filter((term) => includesTerm(haystack, term));
  const matchedIncludeTerms = includeTerms.filter((term) => includesTerm(haystack, term));
  const matchedExcludeTerms = excludeTerms.filter((term) => includesTerm(haystack, term));

  let score = 0.1;
  if (sourceQuery) score += 0.55;
  if (!sourceQuery && queryTokens.length > 0) score += 0.35 * (matchedQueryTokens.length / queryTokens.length);
  if (includeTerms.length > 0) score += 0.5 * Math.min(1, matchedIncludeTerms.length / Math.min(includeTerms.length, 2));
  if (!sourceQuery && normalizeText(episode.title).includes(normalizeText(watch.query))) score += 0.2;
  if (matchedExcludeTerms.length > 0) score = Math.min(score, 0.05);
  score = clamp(score, 0, 1);

  const reason = {
    matchedQueryTokens,
    matchedTerms: matchedIncludeTerms,
    excludedTerms: matchedExcludeTerms,
    sourceQuery,
    minRelevanceScore: watch.minRelevanceScore
  };
  return {
    episode,
    accepted: matchedExcludeTerms.length === 0 && score >= watch.minRelevanceScore,
    score,
    reason
  };
}

function uniqueTerms(terms: string[]): string[] {
  return [...new Set(terms.map((term) => term.trim()).filter(Boolean))];
}

function tokenize(query: string): string[] {
  return uniqueTerms(normalizeText(query).split(/[^\p{L}\p{N}]+/u).filter((term) => term.length >= 2));
}

function includesTerm(haystack: string, term: string): boolean {
  return haystack.includes(normalizeText(term));
}

function isHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

function normalizeText(value: string): string {
  return value.toLowerCase().normalize("NFKC");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
