import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stableId } from "../../../packages/core/src/format.ts";
import type { Episode } from "../../../packages/core/src/types.ts";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-stale-jobs-"));
const dbPath = join(dir, "check.sqlite");

try {
  const db = openPodcastNoteDb(dbPath);
  const repos = createRepositories(db);
  const user = repos.upsertUser({ id: "user_stale_jobs", email: "stale@example.invalid", name: "Stale Jobs" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const watch = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_stale_jobs",
    name: "Stale Job Watch",
    type: "topic",
    query: "AI",
    outputLanguage: "zh-CN",
    includeTerms: [],
    excludeTerms: [],
    minRelevanceScore: 0.5,
    frequency: "daily",
    backfillDays: 7,
    enabled: true
  });
  const episode: Episode = {
    id: stableId("ep", "stale-job-episode"),
    title: "Stale job episode",
    pageUrl: "https://example.invalid/stale",
    audioUrl: "https://example.invalid/stale.mp3"
  };
  repos.upsertEpisode(episode);
  const job = repos.enqueueEpisodeProcessingJob({
    workspaceId: workspace.id,
    watchId: watch.id,
    episodeId: episode.id,
    sourceUrl: episode.pageUrl,
    queuedAt: "2026-06-08T00:00:00.000Z"
  });
  const claimed = repos.claimEpisodeProcessingJob(job.id);
  if (!claimed || claimed.status !== "running") {
    throw new Error(`Expected claimed running job, got ${JSON.stringify(claimed)}.`);
  }

  db.query(`
    update episode_processing_jobs
    set started_at = '2026-06-08 00:00:00', updated_at = '2026-06-08 00:00:00'
    where id = ?
  `).run(job.id);

  const requeued = repos.requeueStaleEpisodeProcessingJobs({
    workspaceId: workspace.id,
    staleBefore: "2026-06-08T01:00:00.000Z",
    error: "Timed out while processing."
  });
  const after = repos.getEpisodeProcessingJob(job.id);
  const queued = repos.listQueuedEpisodeProcessingJobs({ workspaceId: workspace.id, limit: 10 });

  if (requeued !== 1 || after?.status !== "queued" || after.error !== "Timed out while processing.") {
    throw new Error(`Expected stale running job to be requeued, got requeued=${requeued} job=${JSON.stringify(after)}.`);
  }
  if (queued.length !== 1 || queued[0]?.id !== job.id) {
    throw new Error(`Expected stale job to be visible to queue worker, got ${JSON.stringify(queued)}.`);
  }

  const cappedEpisode: Episode = {
    id: "ep_stale_capped",
    title: "Stale capped job episode",
    pageUrl: "https://example.invalid/stale-capped",
    audioUrl: "https://example.invalid/stale-capped.mp3"
  };
  repos.upsertEpisode(cappedEpisode);
  const cappedJob = repos.enqueueEpisodeProcessingJob({
    workspaceId: workspace.id,
    watchId: watch.id,
    episodeId: cappedEpisode.id,
    sourceUrl: cappedEpisode.pageUrl,
    queuedAt: "2026-06-08T00:02:00.000Z"
  });
  repos.claimEpisodeProcessingJob(cappedJob.id);
  db.query(`
    update episode_processing_jobs
    set attempts = 3, started_at = '2026-06-08 00:00:00', updated_at = '2026-06-08 00:00:00'
    where id = ?
  `).run(cappedJob.id);
  const cappedRequeued = repos.requeueStaleEpisodeProcessingJobs({
    workspaceId: workspace.id,
    staleBefore: "2026-06-08T01:00:00.000Z",
    error: "Timed out while processing.",
    maxAttempts: 3
  });
  const cappedAfter = repos.getEpisodeProcessingJob(cappedJob.id);
  if (cappedRequeued !== 0 || cappedAfter?.status !== "failed") {
    throw new Error(`Expected stale capped job to fail instead of requeue, got requeued=${cappedRequeued} job=${JSON.stringify(cappedAfter)}.`);
  }

  console.log("Stale episode processing jobs check passed.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
