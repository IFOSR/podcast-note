import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { demoWatch, episodeFromFixture, markdownReport, processTranscriptFixture, type TranscriptFixture } from "./pipeline.ts";

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
  const result = await processTranscriptFixture({
    workspaceId: watch.workspaceId,
    watch,
    episode: episodeFromFixture(fixture),
    transcriptSegments: fixture.transcript
  });
  console.log(markdownReport(result, watch));
} else {
  console.log(
    [
      "Podcast Note worker CLI",
      "",
      "Commands:",
      "  demo",
      "  process-transcript <fixture.json>"
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

