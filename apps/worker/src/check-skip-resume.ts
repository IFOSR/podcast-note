import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mockInsightProvider, type TranscriptProvider } from "../../../packages/ai/src/index.ts";
import { stableId } from "../../../packages/core/src/format.ts";
import type { Episode, Watch } from "../../../packages/core/src/types.ts";
import { openPodcastNoteDb, createRepositories } from "../../../packages/db/src/index.ts";
import { processSources } from "./process-sources.ts";

const dir = await mkdtemp(join(tmpdir(), "podcast-note-skip-resume-"));
const watchPath = join(dir, "watch.json");
const sourcesPath = join(dir, "sources.json");
const outputDir = join(dir, "outputs");
const db = openPodcastNoteDb(join(dir, "podcast-note.sqlite"));
const repos = createRepositories(db);
const user = repos.upsertUser({ id: "user_smoke", email: "smoke@example.com", name: "Smoke User" });
const workspace = repos.ensurePersonalWorkspaceForUser(user.id);

const sourceUrl = "https://example.invalid/reusable-audio.mp3";
const watch: Watch = {
  id: stableId("watch", "Skip Resume Watch:AI podcast workflow"),
  workspaceId: workspace.id,
  name: "Skip Resume Watch",
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
  id: stableId("ep", sourceUrl),
  title: "reusable-audio.mp3",
  pageUrl: sourceUrl,
  audioUrl: sourceUrl
};

repos.upsertWatch(watch);
repos.upsertEpisode(episode);
repos.saveTranscript({
  episodeId: episode.id,
  provider: "preseed",
  model: "preseed-transcript-v1",
  transcript: {
    language: "en",
    durationSec: 30,
    confidence: 0.99,
    segments: [
      {
        startSec: 0,
        endSec: 30,
        speaker: "speaker_1",
        text: "AI podcast workflow should reuse a stored transcript instead of calling ASR again."
      }
    ]
  }
});

await writeFile(watchPath, `${JSON.stringify({
  name: "Skip Resume Watch",
  topic: "AI podcast workflow",
  language: "zh-CN",
  mustInclude: ["AI", "podcast"],
  avoid: []
}, null, 2)}\n`, "utf8");
await writeFile(sourcesPath, `${JSON.stringify({ sources: [sourceUrl] }, null, 2)}\n`, "utf8");

let transcribeCalls = 0;
const failingTranscriptProvider: TranscriptProvider = {
  name: "should-not-run",
  model: "should-not-run-v1",
  async transcribe() {
    transcribeCalls += 1;
    throw new Error("skip/resume failed: transcript provider was called despite stored transcript.");
  }
};

const results = await processSources({
  options: {
    watchPath,
    sourcesPath,
    outputDir,
    maxEpisodesPerSource: 1
  },
  transcriptProvider: failingTranscriptProvider,
  insightProvider: mockInsightProvider,
  repositories: repos
});

if (transcribeCalls !== 0) {
  throw new Error(`Expected 0 transcript provider calls, got ${transcribeCalls}.`);
}
if (results.length !== 1) {
  throw new Error(`Expected 1 processed result, got ${results.length}.`);
}
const latestTranscript = repos.getLatestTranscriptForEpisode(episode.id);
if (!latestTranscript || latestTranscript.provider !== "preseed") {
  throw new Error("Expected latest stored transcript to remain reusable after processing.");
}
const processedEpisodes = repos.listProcessedEpisodes({ limit: 5 });
const processedEpisode = processedEpisodes.find((candidate) => candidate.id === episode.id);
if (!processedEpisode || processedEpisode.transcriptCount !== 1 || processedEpisode.insightCount < 1) {
  throw new Error("Expected reused transcript episode to have one transcript and saved insights.");
}

console.log("Skip/resume transcript reuse check passed.");
