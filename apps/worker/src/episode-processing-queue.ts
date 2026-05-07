import type { InsightProvider, TranscriptProvider } from "../../../packages/ai/src/index.ts";
import { mockInsightProvider, mockTranscriptProvider } from "../../../packages/ai/src/index.ts";
import type { createRepositories } from "../../../packages/db/src/repositories.ts";
import { processTranscript } from "./pipeline.ts";

type Repositories = ReturnType<typeof createRepositories>;
type EpisodeProcessingJob = NonNullable<ReturnType<Repositories["getEpisodeProcessingJob"]>>;

export type EpisodeProcessingQueueInput = {
  repositories: Repositories;
  transcriptProvider?: TranscriptProvider;
  insightProvider?: InsightProvider;
  limit?: number;
};

export type EpisodeProcessingQueueResult = {
  processedCount: number;
  failedCount: number;
  jobIds: string[];
};

export async function runEpisodeProcessingQueue(input: EpisodeProcessingQueueInput): Promise<EpisodeProcessingQueueResult> {
  const transcriptProvider = input.transcriptProvider ?? mockTranscriptProvider;
  const insightProvider = input.insightProvider ?? mockInsightProvider;
  const jobs = input.repositories.listQueuedEpisodeProcessingJobs({ limit: input.limit ?? 10 });
  let processedCount = 0;
  let failedCount = 0;
  const jobIds: string[] = [];

  for (const job of jobs) {
    jobIds.push(job.id);
    try {
      await processEpisodeProcessingJob({ repositories: input.repositories, job, transcriptProvider, insightProvider });
      processedCount += 1;
    } catch (error) {
      failedCount += 1;
      input.repositories.failEpisodeProcessingJob(job.id, errorMessage(error));
    }
  }

  return { processedCount, failedCount, jobIds };
}

async function processEpisodeProcessingJob(input: {
  repositories: Repositories;
  job: EpisodeProcessingJob;
  transcriptProvider: TranscriptProvider;
  insightProvider: InsightProvider;
}): Promise<void> {
  const claimed = input.repositories.claimEpisodeProcessingJob(input.job.id);
  if (!claimed) return;

  const watch = input.repositories.getWatchForWorkspace(claimed.workspaceId, claimed.watchId);
  if (!watch) throw new Error(`Watch not found for queue job ${claimed.id}: ${claimed.watchId}`);
  const episode = input.repositories.getEpisode(claimed.episodeId);
  if (!episode) throw new Error(`Episode not found for queue job ${claimed.id}: ${claimed.episodeId}`);

  const runId = input.repositories.startProcessingRun({ watchId: watch.id, sources: [claimed.sourceUrl] });
  input.repositories.attachProcessingRunToJob(claimed.id, runId);
  input.repositories.updateEpisodeProcessingStatus({
    runId,
    episodeId: episode.id,
    sourceUrl: claimed.sourceUrl,
    stage: "resolved",
    status: "completed"
  });

  try {
    input.repositories.updateEpisodeProcessingStatus({
      runId,
      episodeId: episode.id,
      sourceUrl: claimed.sourceUrl,
      stage: "transcribing",
      status: "running"
    });
    const transcript = await input.transcriptProvider.transcribe({ episode, audioUrl: episode.audioUrl });
    input.repositories.saveTranscript({
      episodeId: episode.id,
      provider: input.transcriptProvider.name,
      model: input.transcriptProvider.model,
      transcript
    });
    input.repositories.updateEpisodeProcessingStatus({
      runId,
      episodeId: episode.id,
      sourceUrl: claimed.sourceUrl,
      stage: "transcribed",
      status: "completed"
    });
    input.repositories.updateEpisodeProcessingStatus({
      runId,
      episodeId: episode.id,
      sourceUrl: claimed.sourceUrl,
      stage: "analyzing",
      status: "running"
    });

    const result = await processTranscript({
      workspaceId: claimed.workspaceId,
      watch,
      episode,
      transcriptSegments: transcript.segments
    }, input.insightProvider);
    input.repositories.saveProcessingResult(result, watch, input.insightProvider.model);
    input.repositories.updateEpisodeProcessingStatus({
      runId,
      episodeId: episode.id,
      sourceUrl: claimed.sourceUrl,
      stage: "analyzed",
      status: "completed"
    });
    input.repositories.completeProcessingRun(runId);
    input.repositories.completeEpisodeProcessingJob(claimed.id);
  } catch (error) {
    input.repositories.updateEpisodeProcessingStatus({
      runId,
      episodeId: episode.id,
      sourceUrl: claimed.sourceUrl,
      stage: "failed",
      status: "failed",
      error: errorMessage(error)
    });
    input.repositories.failProcessingRun(runId, errorMessage(error));
    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
