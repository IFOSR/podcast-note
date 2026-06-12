import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mockInsightProvider, mockTranscriptProvider } from "../../../packages/ai/src/mock-provider.ts";
import { stableId } from "../../../packages/core/src/format.ts";
import type { Episode } from "../../../packages/core/src/types.ts";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { runEpisodeProcessingQueue } from "./episode-processing-queue.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-episode-queue-"));
const dbPath = join(dir, "check.sqlite");

try {
  const db = openPodcastNoteDb(dbPath);
  const repos = createRepositories(db);
  const user = repos.upsertUser({ id: "user_queue", email: "queue@example.com", name: "Queue User" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const watch = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_queue_ai",
    name: "AI Agent Queue",
    type: "topic",
    query: "AI agent workflow",
    outputLanguage: "zh-CN",
    includeTerms: ["AI", "agent"],
    excludeTerms: [],
    minRelevanceScore: 0.65,
    frequency: "realtime",
    backfillDays: 30
  });

  const episode: Episode = {
    id: stableId("ep", "queue-ai-agent-episode"),
    sourceId: "src_queue",
    guid: "queue-guid-1",
    title: "AI agents now run podcast workflows",
    description: "AI agent workflow systems now coordinate podcast research, transcription, summary, and insight extraction.",
    publishedAt: "2026-05-07T02:15:00.000Z",
    durationSec: 180,
    audioUrl: "https://example.invalid/queue-ai-agent.mp3",
    pageUrl: "https://example.invalid/queue-ai-agent",
    language: "en"
  };
  repos.upsertSource({ id: "src_queue", type: "rss", url: "https://example.invalid/feed.xml", title: "Queue Feed" });
  repos.upsertEpisode(episode);

  const job = repos.enqueueEpisodeProcessingJob({
    workspaceId: workspace.id,
    watchId: watch.id,
    episodeId: episode.id,
    sourceUrl: episode.pageUrl,
    queuedAt: "2026-05-07T02:16:00.000Z",
    relevanceScore: 0.88,
    relevanceReason: { matchedTerms: ["AI", "agent", "workflow"], excludedTerms: [] }
  });
  const duplicate = repos.enqueueEpisodeProcessingJob({
    workspaceId: workspace.id,
    watchId: watch.id,
    episodeId: episode.id,
    sourceUrl: episode.pageUrl,
    queuedAt: "2026-05-07T02:17:00.000Z",
    relevanceScore: 0.88,
    relevanceReason: { matchedTerms: ["AI", "agent", "workflow"], excludedTerms: [] }
  });

  if (job.id !== duplicate.id) throw new Error("Expected queue enqueue to be idempotent by watch+episode.");
  if (repos.listQueuedEpisodeProcessingJobs({ workspaceId: workspace.id, limit: 10 }).length !== 1) {
    throw new Error("Expected one queued episode processing job before worker runs.");
  }

  const result = await runEpisodeProcessingQueue({
    repositories: repos,
    transcriptProvider: mockTranscriptProvider,
    insightProvider: mockInsightProvider,
    limit: 5
  });

  const completed = repos.getEpisodeProcessingJob(job.id);
  const insights = repos.listInsights({ watchId: watch.id, episodeId: episode.id, limit: 10 });
  const processed = repos.listProcessedEpisodes({ limit: 10 }).find((item) => item.id === episode.id);

  if (result.processedCount !== 1 || result.failedCount !== 0) {
    throw new Error(`Expected one processed job and zero failures, got ${JSON.stringify(result)}.`);
  }
  if (!completed || completed.status !== "completed" || completed.attempts !== 1 || !completed.processingRunId) {
    throw new Error(`Expected completed queue job with run id, got ${JSON.stringify(completed)}.`);
  }
  const run = repos.getProcessingRun(completed.processingRunId);
  if (!run || run.status !== "completed" || !run["finished_at"]) {
    throw new Error(`Expected processing run to be completed with finishedAt, got ${JSON.stringify(run)}.`);
  }
  if (!processed || processed.transcriptCount !== 1 || processed.insightCount < 1) {
    throw new Error("Expected queued episode to be transcribed, summarized, and saved with insights.");
  }
  if (!insights.some((insight) => insight.status === "published")) {
    throw new Error("Expected at least one published insight after queue processing.");
  }
  if (repos.listQueuedEpisodeProcessingJobs({ workspaceId: workspace.id, limit: 10 }).length !== 0) {
    throw new Error("Expected no queued jobs after successful processing.");
  }

  const retryEpisode: Episode = {
    ...episode,
    id: stableId("ep", "queue-retry-cleanup"),
    guid: "queue-guid-retry",
    audioUrl: "https://example.invalid/queue-retry.mp3",
    pageUrl: "https://example.invalid/queue-retry"
  };
  repos.upsertEpisode(retryEpisode);
  const failedJob = repos.enqueueEpisodeProcessingJob({
    workspaceId: workspace.id,
    watchId: watch.id,
    episodeId: retryEpisode.id,
    sourceUrl: retryEpisode.pageUrl,
    queuedAt: "2026-05-07T03:00:00.000Z"
  });
  const retryRunId = repos.startProcessingRun({ watchId: watch.id, sources: [retryEpisode.pageUrl] });
  repos.attachProcessingRunToJob(failedJob.id, retryRunId);
  repos.failEpisodeProcessingJob(failedJob.id, "Volcengine transcription timed out after 900000ms.");
  const requeued = repos.enqueueEpisodeProcessingJob({
    workspaceId: workspace.id,
    watchId: watch.id,
    episodeId: retryEpisode.id,
    sourceUrl: retryEpisode.pageUrl,
    queuedAt: "2026-05-07T03:10:00.000Z"
  });
  if (requeued.status !== "queued" || requeued.error || requeued.startedAt || requeued.finishedAt || requeued.processingRunId) {
    throw new Error(`Expected failed job re-enqueue to clear stale run fields, got ${JSON.stringify(requeued)}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    jobId: job.id,
    status: completed.status,
    attempts: completed.attempts,
    processedCount: result.processedCount,
    insightCount: insights.length,
    processingRunId: completed.processingRunId
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
