import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCodexInsightProvider, createVolcengineTranscriptProvider } from "../../../packages/ai/src/index.ts";
import { connectorFor } from "../../../packages/connectors/src/index.ts";
import type { Episode } from "../../../packages/core/src/types.ts";
import { demoWatch, episodeFromFixture, markdownReport, processTranscript, processTranscriptFixture, type TranscriptFixture } from "./pipeline.ts";
import { processSources } from "./process-sources.ts";

const command = process.argv[2] ?? "help";

if (command === "demo") {
  const fixturePath = resolve("evals/golden/ai-agent-sample-transcript.json");
  const fixture = await loadFixture(fixturePath);
  const watch = demoWatch();
  const result = await processTranscriptFixture({
    workspaceId: watch.workspaceId,
    watch,
    episode: episodeFromFixture(fixture),
    transcriptSegments: fixture.transcript
  });
  console.log(markdownReport(result, watch));
} else if (command === "process-transcript") {
  const fixturePath = process.argv[3];
  if (!fixturePath) {
    fail("Usage: bun apps/worker/src/cli.ts process-transcript <fixture.json>");
  }
  const fixture = await loadFixture(resolve(fixturePath));
  const watch = demoWatch();
  const result = await processTranscript(
    {
      workspaceId: watch.workspaceId,
      watch,
      episode: episodeFromFixture(fixture),
      transcriptSegments: fixture.transcript
    },
    codexInsightProviderOrFail()
  );
  console.log(markdownReport(result, watch));
} else if (command === "transcribe-url") {
  const inputUrl = process.argv[3];
  if (!inputUrl) {
    fail("Usage: bun apps/worker/src/cli.ts transcribe-url <public-audio-or-episode-url>");
  }
  const provider = volcengineTranscriptProviderOrFail();
  try {
    const episode = await episodeFromUrl(inputUrl);
    if (!episode.audioUrl) {
      fail(`No public audio URL could be resolved from ${inputUrl}. Provide a direct .mp3/.wav/.ogg/.raw URL.`);
    }
    const result = await provider.transcribe({
      episode,
      audioUrl: episode.audioUrl
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "resolve-audio-url") {
  const inputUrl = process.argv[3];
  if (!inputUrl) {
    fail("Usage: bun apps/worker/src/cli.ts resolve-audio-url <public-audio-or-episode-url>");
  }
  try {
    const episode = await episodeFromUrl(inputUrl);
    console.log(JSON.stringify(episode, null, 2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "process-sources") {
  try {
    const results = await processSources({
      options: readProcessSourcesOptions(),
      transcriptProvider: volcengineTranscriptProviderOrFail(),
      insightProvider: codexInsightProviderOrFail()
    });
    console.log(
      [
        `Processed ${results.length} episode${results.length === 1 ? "" : "s"}.`,
        ...results.map((result) => `- ${result.episodeTitle}: ${result.outputDir}`)
      ].join("\n")
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else {
  console.log(
    [
      "Podcast Note worker CLI",
      "",
      "Commands:",
      "  demo",
      "  process-transcript <fixture.json>",
      "  resolve-audio-url <public-audio-or-episode-url>",
      "  transcribe-url <public-audio-or-episode-url>",
      "  process-sources [--watch inputs/watch.json] [--sources inputs/sources.json] [--output outputs]"
    ].join("\n")
  );
}

async function loadFixture(path: string): Promise<TranscriptFixture> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as TranscriptFixture;
  if (!parsed.episode?.title || !parsed.episode?.pageUrl || !Array.isArray(parsed.transcript)) {
    throw new Error(`Invalid transcript fixture: ${path}`);
  }
  return parsed;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function codexInsightProviderOrFail() {
  try {
    return createCodexInsightProvider();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function volcengineTranscriptProviderOrFail() {
  try {
    return createVolcengineTranscriptProvider();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

async function episodeFromUrl(inputUrl: string): Promise<Episode> {
  if (isDirectAudioUrl(inputUrl)) {
    return {
      id: "manual_transcription",
      title: "Manual transcription",
      pageUrl: inputUrl,
      audioUrl: inputUrl
    };
  }

  const resolved = await connectorFor(inputUrl).resolveEpisode(inputUrl);
  return {
    id: "manual_transcription",
    title: resolved.title,
    description: resolved.description,
    publishedAt: resolved.publishedAt,
    durationSec: resolved.durationSec,
    pageUrl: resolved.pageUrl,
    audioUrl: resolved.audioUrl,
    language: resolved.language,
    metadata: resolved.metadata
  };
}

function isDirectAudioUrl(inputUrl: string): boolean {
  try {
    return /\.(mp3|wav|ogg|raw)$/i.test(new URL(inputUrl).pathname);
  } catch {
    return false;
  }
}

function readProcessSourcesOptions() {
  return {
    watchPath: flagValue("--watch") ?? "inputs/watch.json",
    sourcesPath: flagValue("--sources") ?? "inputs/sources.json",
    outputDir: flagValue("--output") ?? "outputs",
    maxEpisodesPerSource: numberFlagValue("--max-episodes") ?? 10
  };
}

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) fail(`Missing value for ${name}.`);
  return value;
}

function numberFlagValue(name: string): number | undefined {
  const value = flagValue(name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) fail(`${name} must be a positive integer.`);
  return parsed;
}
