import { connectorFor } from "../../../packages/connectors/src/index.ts";
import type { ResolvedEpisode, ResolvedSource, SourceConnector } from "../../../packages/connectors/src/index.ts";
import { episodeDedupeKey } from "../../../packages/core/src/dedupe.ts";
import { stableId } from "../../../packages/core/src/format.ts";
import type { Episode, Source } from "../../../packages/core/src/types.ts";
import type { createRepositories, PollingJobInput } from "../../../packages/db/src/repositories.ts";

type Repositories = ReturnType<typeof createRepositories>;

export type PollingJobResult = {
  jobId: string;
  watchId: string;
  sourceId: string;
  candidateCount: number;
  queuedCount: number;
  candidateEpisodeIds: string[];
  episodeIds: string[];
};

export async function runPollingJob(input: {
  job: PollingJobInput;
  repositories: Repositories;
  connector?: SourceConnector;
  episodeLimit?: number;
}): Promise<PollingJobResult> {
  const connector = input.connector ?? connectorFor(input.job.query);
  const checkedAt = input.job.now;

  try {
    const resolvedSource = await connector.resolveSource(input.job.query);
    const source = resolvedSourceToSource(resolvedSource);
    input.repositories.upsertSource(source);

    const candidates = await connector.listEpisodes(resolvedSource, {
      since: new Date(input.job.since),
      limit: input.episodeLimit ?? 100
    });
    const upsertResult = upsertUniqueEpisodes(input.repositories, source.id, candidates);

    input.repositories.recordWatchPoll(input.job.watchId, {
      checkedAt,
      status: "completed",
      candidateCount: candidates.length,
      queuedCount: upsertResult.newEpisodeIds.length
    });

    return {
      jobId: input.job.id,
      watchId: input.job.watchId,
      sourceId: source.id,
      candidateCount: candidates.length,
      queuedCount: upsertResult.newEpisodeIds.length,
      candidateEpisodeIds: upsertResult.candidateEpisodeIds,
      episodeIds: upsertResult.newEpisodeIds
    };
  } catch (error) {
    input.repositories.recordWatchPoll(input.job.watchId, {
      checkedAt,
      status: "failed",
      candidateCount: 0,
      queuedCount: 0,
      error: errorMessage(error)
    });
    throw error;
  }
}

function upsertUniqueEpisodes(repositories: Repositories, sourceId: string, candidates: ResolvedEpisode[]): { candidateEpisodeIds: string[]; newEpisodeIds: string[] } {
  const seenInBatch = new Set<string>();
  const candidateEpisodeIds: string[] = [];
  const newEpisodeIds: string[] = [];

  for (const candidate of candidates) {
    const episode = resolvedEpisodeToEpisode(candidate, sourceId);
    const dedupeKey = episodeDedupeKey({
      guid: episode.guid,
      audioUrl: episode.audioUrl,
      pageUrl: episode.pageUrl,
      title: episode.title
    });
    if (seenInBatch.has(dedupeKey)) continue;
    seenInBatch.add(dedupeKey);

    const existing = repositories.getEpisode(episode.id);
    repositories.upsertEpisode(episode);
    candidateEpisodeIds.push(episode.id);
    if (!existing) newEpisodeIds.push(episode.id);
  }

  return { candidateEpisodeIds, newEpisodeIds };
}

function resolvedEpisodeToEpisode(episode: ResolvedEpisode, sourceId: string): Episode {
  return {
    id: stableId("ep", episodeDedupeKey({
      guid: episode.guid,
      audioUrl: episode.audioUrl,
      pageUrl: episode.pageUrl,
      title: episode.title
    })),
    sourceId,
    guid: episode.guid,
    title: episode.title,
    description: episode.description,
    publishedAt: episode.publishedAt,
    durationSec: episode.durationSec,
    audioUrl: episode.audioUrl,
    pageUrl: episode.pageUrl,
    language: episode.language,
    metadata: episode.metadata
  };
}

function resolvedSourceToSource(source: ResolvedSource): Source {
  return {
    id: stableId("src", `${source.type}:${source.url}`),
    type: source.type,
    url: source.url,
    canonicalUrl: source.canonicalUrl,
    externalId: source.externalId,
    title: source.title,
    author: source.author,
    language: source.language
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
