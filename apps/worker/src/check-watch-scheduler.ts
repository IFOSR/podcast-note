import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openPodcastNoteDb, createRepositories } from "../../../packages/db/src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-watch-scheduler-"));
const dbPath = join(dir, "check.sqlite");
const now = "2026-05-07T02:00:00.000Z";

try {
  const db = openPodcastNoteDb(dbPath);
  const repos = createRepositories(db);

  const user = repos.upsertUser({
    id: "user_m1_watch_scheduler_smoke",
    email: "watch-scheduler@example.com",
    name: "M1 Watch Scheduler Smoke User",
    timezone: "Asia/Shanghai"
  });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);

  const dueDaily = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_due_daily",
    name: "Due Daily Watch",
    type: "topic",
    query: "AI agents daily",
    outputLanguage: "zh-CN",
    includeTerms: ["agent"],
    excludeTerms: [],
    minRelevanceScore: 0.7,
    frequency: "daily",
    backfillDays: 30
  });
  const dueRealtime = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_due_realtime",
    name: "Due Realtime Watch",
    type: "topic",
    query: "AI agents realtime",
    outputLanguage: "zh-CN",
    includeTerms: ["agent"],
    excludeTerms: [],
    minRelevanceScore: 0.7,
    frequency: "realtime",
    backfillDays: 7
  });
  const notDueDaily = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_not_due_daily",
    name: "Not Due Daily Watch",
    type: "topic",
    query: "AI agents not due",
    outputLanguage: "zh-CN",
    includeTerms: ["agent"],
    excludeTerms: [],
    minRelevanceScore: 0.7,
    frequency: "daily",
    backfillDays: 14
  });
  const disabled = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_disabled",
    name: "Disabled Watch",
    type: "topic",
    query: "AI agents disabled",
    outputLanguage: "zh-CN",
    includeTerms: ["agent"],
    excludeTerms: [],
    minRelevanceScore: 0.7,
    frequency: "realtime",
    backfillDays: 30,
    enabled: false
  });
  const neverPolled = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_never_polled",
    name: "Never Polled Watch",
    type: "podcast",
    query: "https://example.com/rss.xml",
    outputLanguage: "zh-CN",
    includeTerms: [],
    excludeTerms: [],
    minRelevanceScore: 0.6,
    frequency: "weekly",
    backfillDays: 45
  });

  repos.recordWatchPoll(dueDaily.id, {
    checkedAt: "2026-05-05T01:00:00.000Z",
    status: "completed",
    candidateCount: 3,
    queuedCount: 2
  });
  repos.recordWatchPoll(dueRealtime.id, {
    checkedAt: "2026-05-07T01:00:00.000Z",
    status: "completed",
    candidateCount: 1,
    queuedCount: 1
  });
  repos.recordWatchPoll(notDueDaily.id, {
    checkedAt: "2026-05-07T00:30:00.000Z",
    status: "completed",
    candidateCount: 0,
    queuedCount: 0
  });
  repos.recordWatchPoll(disabled.id, {
    checkedAt: "2026-05-01T00:00:00.000Z",
    status: "completed",
    candidateCount: 9,
    queuedCount: 9
  });

  const enabled = repos.listEnabledWatchesForWorkspace(workspace.id);
  if (enabled.some((watch) => watch.id === disabled.id)) {
    throw new Error("disabled watches should not be listed as enabled");
  }
  if (!enabled.some((watch) => watch.id === dueDaily.id) || !enabled.some((watch) => watch.id === neverPolled.id)) {
    throw new Error("enabled watches list missed active watches");
  }

  const due = repos.listDueWatches({ now, workspaceId: workspace.id });
  const dueIds = due.map((item) => item.watch.id).sort();
  const expectedDueIds = [dueDaily.id, dueRealtime.id, neverPolled.id].sort();
  if (JSON.stringify(dueIds) !== JSON.stringify(expectedDueIds)) {
    throw new Error(`unexpected due watches: ${JSON.stringify(dueIds)} !== ${JSON.stringify(expectedDueIds)}`);
  }

  const dailyJob = due.find((item) => item.watch.id === dueDaily.id);
  if (!dailyJob) throw new Error("missing due daily polling job");
  if (dailyJob.reason !== "frequency_elapsed") {
    throw new Error(`expected frequency_elapsed reason, got ${dailyJob.reason}`);
  }
  if (dailyJob.since !== "2026-05-05T01:00:00.000Z") {
    throw new Error(`expected previous poll as since, got ${dailyJob.since}`);
  }

  const neverPolledJob = due.find((item) => item.watch.id === neverPolled.id);
  if (!neverPolledJob) throw new Error("missing never-polled backfill job");
  if (neverPolledJob.reason !== "never_polled") {
    throw new Error(`expected never_polled reason, got ${neverPolledJob.reason}`);
  }
  if (neverPolledJob.since !== "2026-03-23T02:00:00.000Z") {
    throw new Error(`expected 45-day backfill since, got ${neverPolledJob.since}`);
  }

  const planned = repos.planPollingJobs({ now, workspaceId: workspace.id });
  if (planned.length !== due.length) {
    throw new Error("planned job count should match due watch count");
  }
  const plannedDaily = planned.find((job) => job.watchId === dueDaily.id);
  if (!plannedDaily || plannedDaily.workspaceId !== workspace.id || plannedDaily.frequency !== "daily") {
    throw new Error("planned polling job should include watch/workspace/frequency metadata");
  }

  repos.recordWatchPoll(dueDaily.id, {
    checkedAt: now,
    status: "completed",
    candidateCount: 6,
    queuedCount: 4
  });
  const latestPoll = repos.getLatestWatchPoll(dueDaily.id);
  if (!latestPoll || latestPoll.checkedAt !== now || latestPoll.queuedCount !== 4) {
    throw new Error("latest watch poll was not recorded");
  }

  console.log(JSON.stringify({
    ok: true,
    workspaceId: workspace.id,
    dueIds,
    planned: planned.map((job) => ({
      watchId: job.watchId,
      workspaceId: job.workspaceId,
      since: job.since,
      reason: job.reason,
      frequency: job.frequency
    }))
  }, null, 2));

  db.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
