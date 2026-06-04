import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockInsightProvider, mockTranscriptProvider } from "../../../packages/ai/src/index.ts";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { processSourceInputs } from "./process-sources.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-text-source-"));
const dbPath = join(dir, "text-source.sqlite");
const originalKey = process.env["LISTEN_NOTES_API_KEY"];

try {
  delete process.env["LISTEN_NOTES_API_KEY"];
  const repos = createRepositories(openPodcastNoteDb(dbPath));
  const user = repos.upsertUser({ id: "user_text_source", email: "text-source@example.invalid", name: "Text Source", timezone: "Asia/Shanghai" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);

  const results = await processSourceInputs({
    options: {
      watch: {
        workspaceId: workspace.id,
        name: "深思圈",
        topic: "小宇宙 / 深思圈 / AI",
        language: "zh-CN",
        mustInclude: ["AI"]
      },
      sources: { sources: ["小宇宙 深思圈 AI"] },
      outputDir: join(dir, "outputs"),
      maxEpisodesPerSource: 3
    },
    transcriptProvider: mockTranscriptProvider,
    insightProvider: mockInsightProvider,
    repositories: repos
  });

  if (results.length !== 0) {
    throw new Error(`Text source without Listen Notes API key should resolve as an empty search result, got ${JSON.stringify(results)}.`);
  }
  const runs = repos.listProcessingRuns({ limit: 5 });
  if (runs[0]?.status !== "completed") {
    throw new Error(`Expected text source run to complete without Listen Notes episode id error, got ${JSON.stringify(runs[0])}.`);
  }
  console.log(JSON.stringify({ ok: true, dbPath, runStatus: runs[0]?.status }, null, 2));
} finally {
  if (originalKey) process.env["LISTEN_NOTES_API_KEY"] = originalKey;
  rmSync(dir, { recursive: true, force: true });
}
