import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { runPollingJob } from "./rss-polling.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-rss-polling-"));
const dbPath = join(dir, "check.sqlite");
const now = "2026-05-07T02:00:00.000Z";
const since = "2026-05-01T00:00:00.000Z";
const feedUrl = "https://example.com/m1-rss.xml";

const episodes = [
  {
    guid: "episode-old",
    title: "Old episode outside polling window",
    pageUrl: "https://example.com/old",
    audioUrl: "https://example.com/old.mp3",
    publishedAt: "2026-04-20T00:00:00.000Z"
  },
  {
    guid: "episode-a",
    title: "M1 RSS polling candidate A",
    pageUrl: "https://example.com/a",
    audioUrl: "https://example.com/a.mp3",
    publishedAt: "2026-05-06T01:00:00.000Z"
  },
  {
    guid: "episode-b",
    title: "M1 RSS polling candidate B",
    pageUrl: "https://example.com/b",
    audioUrl: "https://example.com/b.mp3",
    publishedAt: "2026-05-06T03:00:00.000Z"
  },
  {
    guid: "episode-a",
    title: "Duplicate candidate A",
    pageUrl: "https://example.com/a?utm_source=duplicate",
    audioUrl: "https://example.com/a.mp3?utm_source=duplicate",
    publishedAt: "2026-05-06T04:00:00.000Z"
  }
];

try {
  const db = openPodcastNoteDb(dbPath);
  const repos = createRepositories(db);

  const user = repos.upsertUser({
    id: "user_m1_rss_polling_smoke",
    email: "rss-polling@example.com",
    name: "M1 RSS Polling Smoke User",
    timezone: "Asia/Shanghai"
  });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const watch = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_rss_polling",
    name: "RSS Polling Watch",
    type: "podcast",
    query: feedUrl,
    outputLanguage: "zh-CN",
    includeTerms: [],
    excludeTerms: [],
    minRelevanceScore: 0.6,
    frequency: "daily",
    backfillDays: 30
  });

  repos.recordWatchPoll(watch.id, {
    checkedAt: "2026-05-01T00:00:00.000Z",
    status: "completed",
    candidateCount: 0,
    queuedCount: 0
  });

  const [job] = repos.planPollingJobs({ now, workspaceId: workspace.id });
  if (!job || job.watchId !== watch.id || job.since !== since) {
    throw new Error(`unexpected planned polling job: ${JSON.stringify(job)}`);
  }

  const first = await runPollingJob({
    job,
    repositories: repos,
    connector: {
      type: "rss",
      canHandle: (input) => input === feedUrl,
      async resolveSource(input) {
        return {
          type: "rss",
          url: input,
          canonicalUrl: input,
          title: "M1 RSS Fixture"
        };
      },
      async listEpisodes(_source, options = {}) {
        if (!options.since || options.since.toISOString() !== since) {
          throw new Error(`polling job should pass since to connector, got ${options.since?.toISOString()}`);
        }
        return episodes.filter((episode) => new Date(episode.publishedAt).getTime() >= options.since!.getTime());
      },
      async resolveEpisode() {
        throw new Error("RSS polling should list episodes, not resolve a single episode.");
      }
    }
  });

  if (first.candidateCount !== 3) throw new Error(`expected 3 candidates from connector, got ${first.candidateCount}`);
  if (first.queuedCount !== 2) throw new Error(`expected 2 newly queued unique episodes, got ${first.queuedCount}`);
  if (first.episodeIds.length !== 2) throw new Error(`expected 2 unique episode ids, got ${first.episodeIds.length}`);

  const storedA = repos.getEpisode(first.episodeIds[0]!);
  const storedB = repos.getEpisode(first.episodeIds[1]!);
  if (!storedA || !storedB) throw new Error("polling should upsert discovered episodes");
  if (storedA.sourceId !== storedB.sourceId) throw new Error("discovered episodes should share the resolved source id");

  const latestPoll = repos.getLatestWatchPoll(watch.id);
  if (!latestPoll || latestPoll.checkedAt !== now || latestPoll.candidateCount !== 3 || latestPoll.queuedCount !== 2) {
    throw new Error(`poll result was not recorded correctly: ${JSON.stringify(latestPoll)}`);
  }

  const repeat = await runPollingJob({
    job,
    repositories: repos,
    connector: {
      type: "rss",
      canHandle: () => true,
      resolveSource: async () => ({ type: "rss", url: feedUrl, title: "M1 RSS Fixture" }),
      listEpisodes: async () => episodes.slice(1),
      resolveEpisode: async () => episodes[1]!
    }
  });
  if (repeat.queuedCount !== 0) throw new Error(`repeat polling should not requeue duplicates, got ${repeat.queuedCount}`);

  console.log(JSON.stringify({
    ok: true,
    watchId: watch.id,
    sourceId: storedA.sourceId,
    candidateCount: first.candidateCount,
    queuedCount: first.queuedCount,
    episodeIds: first.episodeIds,
    repeatQueuedCount: repeat.queuedCount,
    latestPoll: {
      checkedAt: latestPoll.checkedAt,
      candidateCount: latestPoll.candidateCount,
      queuedCount: latestPoll.queuedCount
    }
  }, null, 2));

  db.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
