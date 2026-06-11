import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { runEpisodeProcessingQueue } from "./episode-processing-queue.ts";

const dbPath = join(await mkdtemp(join(tmpdir(), "podcast-note-no-mock-")), "test.sqlite");
const repositories = createRepositories(openPodcastNoteDb(dbPath));

let failedWithoutTranscriptProvider = false;
try {
  await runEpisodeProcessingQueue({
    repositories,
    insightProvider: {
      name: "real-insight-fixture",
      model: "fixture",
      summarizeEpisode: async () => {
        throw new Error("should not run");
      },
      extractInsights: async () => []
    }
  });
} catch (error) {
  failedWithoutTranscriptProvider = error instanceof Error && error.message.includes("Mock fallback is disabled");
}

if (!failedWithoutTranscriptProvider) {
  throw new Error("Episode processing queue must fail when a real transcript provider is not supplied.");
}

let failedWithoutInsightProvider = false;
try {
  await runEpisodeProcessingQueue({
    repositories,
    transcriptProvider: {
      name: "real-transcript-fixture",
      model: "fixture",
      transcribe: async () => {
        throw new Error("should not run");
      }
    }
  });
} catch (error) {
  failedWithoutInsightProvider = error instanceof Error && error.message.includes("Mock fallback is disabled");
}

if (!failedWithoutInsightProvider) {
  throw new Error("Episode processing queue must fail when a real insight provider is not supplied.");
}

console.log("No runtime mock fallback check passed.");
