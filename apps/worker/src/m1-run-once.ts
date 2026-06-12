import type { SourceConnector } from "../../../packages/connectors/src/index.ts";
import type { InsightProvider, TranscriptProvider } from "../../../packages/ai/src/index.ts";
import type { createRepositories } from "../../../packages/db/src/repositories.ts";
import { runEpisodeProcessingQueue } from "./episode-processing-queue.ts";
import { enqueueRelevantEpisodes } from "./relevance.ts";
import { runPollingJob } from "./rss-polling.ts";

type Repositories = ReturnType<typeof createRepositories>;

export type RunM1OnceInput = {
  repositories: Repositories;
  workspaceId?: string;
  now?: string;
  connector?: SourceConnector;
  transcriptProvider?: TranscriptProvider;
  insightProvider?: InsightProvider;
  pollingEpisodeLimit?: number;
  processingLimit?: number;
};

export type RunM1OnceResult = {
  pollingJobs: number;
  discoveredEpisodes: number;
  queuedEpisodes: number;
  processedJobs: number;
  failedJobs: number;
  insights: number;
};

export async function runM1Once(input: RunM1OnceInput): Promise<RunM1OnceResult> {
  const now = input.now ?? new Date().toISOString();
  const jobs = input.repositories.planPollingJobs({ workspaceId: input.workspaceId, now });
  let discoveredEpisodes = 0;
  let queuedEpisodes = 0;

  for (const job of jobs) {
    const pollingResult = await runPollingJob({
      job,
      repositories: input.repositories,
      connector: input.connector,
      episodeLimit: input.pollingEpisodeLimit
    });
    discoveredEpisodes += pollingResult.candidateCount;

    const watch = input.repositories.getWatchForWorkspace(job.workspaceId, job.watchId);
    if (!watch) continue;
    const episodes = pollingResult.candidateEpisodeIds
      .map((episodeId) => input.repositories.getEpisode(episodeId))
      .filter((episode) => episode !== undefined);
    const relevanceResult = enqueueRelevantEpisodes({
      repositories: input.repositories,
      workspaceId: job.workspaceId,
      watch,
      episodes,
      queuedAt: now
    });
    queuedEpisodes += relevanceResult.queuedCount;
  }

  const processingResult = await runEpisodeProcessingQueue({
    repositories: input.repositories,
    transcriptProvider: input.transcriptProvider,
    insightProvider: input.insightProvider,
    limit: input.processingLimit ?? 10
  });
  const insights = input.repositories.listInsights({ limit: 1000 })
    .filter((insight) => !input.workspaceId || insight.workspaceId === input.workspaceId).length;

  return {
    pollingJobs: jobs.length,
    discoveredEpisodes,
    queuedEpisodes,
    processedJobs: processingResult.processedCount,
    failedJobs: processingResult.failedCount,
    insights
  };
}
