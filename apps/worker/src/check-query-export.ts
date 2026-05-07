import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openPodcastNoteDb, createRepositories } from "../../../packages/db/src/index.ts";
import type { Episode, Watch } from "../../../packages/core/src/types.ts";

const dir = await mkdtemp(join(tmpdir(), "podcast-note-query-smoke-"));
const db = openPodcastNoteDb(join(dir, "podcast-note.sqlite"));
const repos = createRepositories(db);
const user = repos.upsertUser({ id: "user_smoke", email: "smoke@example.com", name: "Smoke User" });
const workspace = repos.ensurePersonalWorkspaceForUser(user.id);

const watch: Watch = {
  id: "watch_query_smoke",
  workspaceId: workspace.id,
  name: "Query Smoke Watch",
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
  id: "episode_query_smoke",
  title: "Query smoke episode",
  pageUrl: "https://example.invalid/query-smoke",
  audioUrl: "https://example.invalid/query-smoke.mp3"
};

repos.upsertWatch(watch);
repos.upsertEpisode(episode);
const runId = repos.startProcessingRun({ watchId: watch.id, sources: [episode.pageUrl] });
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
    durationSec: 42,
    segments: [{ startSec: 0, endSec: 42, text: "Query export smoke transcript." }]
  }
});
repos.saveProcessingResult(
  {
    episode,
    summary: {
      oneLiner: "A query/export smoke summary.",
      overview: "This verifies query/export repository methods.",
      chapters: [{ title: "Query", startSec: 0, endSec: 42, summary: "Query smoke test chapter." }],
      worthListening: { recommendation: "listen_segments", reason: "Smoke test.", bestSegments: [] },
      entities: [{ name: "SQLite", type: "technology", mentions: 1 }]
    },
    segments: [],
    insights: [{
      id: "insight_query_smoke",
      workspaceId: watch.workspaceId,
      watchId: watch.id,
      episodeId: episode.id,
      segmentIndex: 0,
      claim: "SQLite query/export methods expose processed insights.",
      evidenceExcerpt: "Query export smoke transcript.",
      timestampStartSec: 0,
      timestampEndSec: 42,
      entities: [{ name: "SQLite", type: "technology" }],
      relevanceScore: 0.9,
      confidence: 0.9,
      groundednessScore: 0.85,
      outputLanguage: "zh-CN",
      status: "published",
      promptVersion: "watch-insight-v1",
      model: "smoke-insight"
    }]
  },
  watch,
  "smoke-insight"
);
repos.completeProcessingRun(runId);

const episodes = repos.listProcessedEpisodes({ limit: 5 });
const runs = repos.listProcessingRuns({ limit: 5 });
const insights = repos.listInsights({ watchId: watch.id, limit: 5 });
const transcript = repos.getLatestTranscriptForEpisode(episode.id);

if (episodes.length !== 1 || episodes[0]?.id !== episode.id) {
  throw new Error(`Expected processed episode ${episode.id}, got ${JSON.stringify(episodes)}`);
}
if (runs.length !== 1 || runs[0]?.id !== runId || runs[0]?.episodeCount !== 1) {
  throw new Error(`Expected completed run with one episode, got ${JSON.stringify(runs)}`);
}
if (insights.length !== 1 || insights[0]?.id !== "insight_query_smoke") {
  throw new Error(`Expected exported insight, got ${JSON.stringify(insights)}`);
}
if (!transcript || transcript.segments[0]?.text !== "Query export smoke transcript.") {
  throw new Error(`Expected latest transcript segments, got ${JSON.stringify(transcript)}`);
}

console.log("SQLite query/export check passed.");
