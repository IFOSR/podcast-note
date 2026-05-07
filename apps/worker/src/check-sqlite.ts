import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openPodcastNoteDb, createRepositories } from "../../../packages/db/src/index.ts";
import type { Episode, Watch } from "../../../packages/core/src/types.ts";

const dir = await mkdtemp(join(tmpdir(), "podcast-note-sqlite-"));
const db = openPodcastNoteDb(join(dir, "podcast-note.sqlite"));
const repos = createRepositories(db);
const user = repos.upsertUser({ id: "user_smoke", email: "smoke@example.com", name: "Smoke User" });
const workspace = repos.ensurePersonalWorkspaceForUser(user.id);

const watch: Watch = {
  id: "watch_sqlite_smoke",
  workspaceId: workspace.id,
  name: "SQLite Smoke Watch",
  type: "topic",
  query: "AI podcast workflow",
  outputLanguage: "zh-CN",
  includeTerms: ["AI", "podcast"],
  excludeTerms: [],
  expandedTerms: ["AI podcast workflow", "AI", "podcast"],
  minRelevanceScore: 0.65,
  frequency: "daily",
  backfillDays: 30
};

const episode: Episode = {
  id: "episode_sqlite_smoke",
  title: "SQLite smoke episode",
  pageUrl: "https://example.invalid/sqlite-smoke",
  audioUrl: "https://example.invalid/sqlite-smoke.mp3",
  metadata: {
    source: "sqlite-smoke"
  }
};

repos.upsertWatch(watch);
repos.upsertEpisode(episode);
const runId = repos.startProcessingRun({
  watchId: watch.id,
  sources: [episode.pageUrl]
});
repos.updateEpisodeProcessingStatus({
  runId,
  episodeId: episode.id,
  sourceUrl: episode.pageUrl,
  stage: "resolved",
  status: "completed"
});
repos.saveTranscript({
  episodeId: episode.id,
  provider: "smoke",
  model: "smoke-transcript",
  transcript: {
    language: "zh-CN",
    durationSec: 12,
    segments: [
      {
        startSec: 0,
        endSec: 12,
        text: "AI podcast workflow smoke transcript.",
        speaker: "speaker_1"
      }
    ]
  }
});
repos.saveProcessingResult(
  {
    episode,
    summary: {
      oneLiner: "A SQLite smoke summary.",
      overview: "This verifies real SQLite writes for summaries and insights.",
      chapters: [
        {
          title: "Smoke",
          startSec: 0,
          endSec: 12,
          summary: "SQLite smoke test chapter."
        }
      ],
      worthListening: {
        recommendation: "listen_segments",
        reason: "Smoke test.",
        bestSegments: [{ startSec: 0, endSec: 12, reason: "Only segment." }]
      },
      entities: [{ name: "SQLite", type: "technology", mentions: 1 }]
    },
    segments: [],
    insights: [
      {
        id: "insight_sqlite_smoke",
        workspaceId: watch.workspaceId,
        watchId: watch.id,
        episodeId: episode.id,
        segmentIndex: 0,
        claim: "SQLite persistence writes real insights.",
        evidenceExcerpt: "AI podcast workflow smoke transcript.",
        timestampStartSec: 0,
        timestampEndSec: 12,
        entities: [{ name: "SQLite", type: "technology" }],
        relevanceScore: 0.9,
        confidence: 0.9,
        groundednessScore: 0.85,
        outputLanguage: "zh-CN",
        status: "published",
        promptVersion: "watch-insight-v1",
        model: "smoke-insight"
      }
    ]
  },
  watch,
  "smoke-insight"
);
repos.updateEpisodeProcessingStatus({
  runId,
  episodeId: episode.id,
  sourceUrl: episode.pageUrl,
  stage: "exported",
  status: "completed"
});
repos.completeProcessingRun(runId);

const storedEpisode = repos.getEpisode(episode.id);
const insights = repos.getLatestInsightsForWatch(watch.id);
const run = repos.getProcessingRun(runId);
if (!storedEpisode) throw new Error("SQLite smoke failed to read stored episode.");
if (insights.length !== 1) throw new Error(`SQLite smoke expected 1 insight, got ${insights.length}.`);
if (!run || run["status"] !== "completed") throw new Error("SQLite smoke failed to complete processing run.");

console.log("SQLite smoke check passed.");
