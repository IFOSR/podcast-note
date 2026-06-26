import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCommandLineInsightProvider } from "../../../packages/ai/src/index.ts";
import { mockTranscriptProvider } from "../../../packages/ai/src/mock-provider.ts";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { processSourceInputs } from "./process-sources.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-command-line-llm-e2e-"));
const dbPath = join(dir, "check.sqlite");
const outputDir = join(dir, "outputs");
const deepseek = join(dir, "fake-deepseek-tui");
const kimi = join(dir, "fake-kimi");
const logPath = join(dir, "calls.log");
let server: ReturnType<typeof createServer> | undefined;

try {
  writeFileSync(deepseek, fakeCli("deepseek"), { mode: 0o755 });
  writeFileSync(kimi, fakeCli("kimi"), { mode: 0o755 });

  server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
      <html lang="en">
      <head>
        <title>Local LLM E2E Episode</title>
        <meta property="og:title" content="Local LLM E2E Episode">
        <meta property="og:description" content="DeepSeek and Kimi local command line fallback supports podcast intelligence workflow integration.">
        <meta property="og:audio" content="https://example.invalid/e2e.mp3">
      </head>
      <body>DeepSeek and Kimi local command line fallback supports podcast intelligence workflow integration.</body>
      </html>`);
  });

  const sourceUrl = await listen(server);
  const db = openPodcastNoteDb(dbPath);
  const repos = createRepositories(db);
  const results = await processSourceInputs({
    options: {
      watch: {
        workspaceId: "workspace_command_line_llm_e2e",
        name: "Local LLM E2E",
        topic: "local command line fallback",
        language: "zh-CN",
        mustInclude: ["DeepSeek", "Kimi"],
        avoid: []
      },
      sources: { sources: [sourceUrl] },
      outputDir,
      maxEpisodesPerSource: 1
    },
    transcriptProvider: mockTranscriptProvider,
    insightProvider: createCommandLineInsightProvider({
      deepseekCommand: `${deepseek} --fail`,
      kimiCommand: kimi,
      model: "fake-model",
      timeoutMs: 5000
    }),
    repositories: repos
  });

  await new Promise<void>((resolve) => server.close(() => resolve()));

  const result = results[0];
  if (!result) throw new Error("Expected one processed source result.");
  const report = readFileSync(result.reportPath, "utf8");
  const persisted = repos.listInsights({ limit: 10 });
  const calls = readFileSync(logPath, "utf8");

  if (!report.includes("Kimi summary")) throw new Error(`Expected Kimi fallback summary in report, got: ${report}`);
  if (!persisted.some((insight) => insight.claim === "Kimi insight")) {
    throw new Error(`Expected persisted Kimi insight, got ${JSON.stringify(persisted)}.`);
  }
  if (!calls.includes("deepseek:exec --model fake-model") || !calls.includes("kimi:--quiet -m fake-model -p")) {
    throw new Error(`Expected DeepSeek attempt and Kimi fallback calls, got: ${calls}`);
  }

  console.log(JSON.stringify({
    ok: true,
    sourceUrl,
    reportPath: result.reportPath,
    persistedInsights: persisted.length,
    calls: calls.trim().split("\n")
  }, null, 2));
} finally {
  if (server?.listening) await new Promise<void>((resolve) => server?.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
}

function listen(server: ReturnType<typeof createServer>): Promise<string> {
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected TCP server address."));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}/episode`);
    });
  });
}

function fakeCli(name: "deepseek" | "kimi"): string {
  return `#!/usr/bin/env bash
set -euo pipefail
log=${JSON.stringify(logPath)}
if [[ "$*" == *"exec --model fake-model"* ]]; then
  printf '${name}:exec --model fake-model\\n' >> "$log"
elif [[ "$*" == *"--quiet -m fake-model -p"* ]]; then
  printf '${name}:--quiet -m fake-model -p\\n' >> "$log"
else
  printf '${name}:%s\\n' "$1" >> "$log"
fi
if [[ "$*" == *"--fail"* ]]; then
  echo "${name} forced failure" >&2
  exit 42
fi
prompt="$*"
if [[ "$prompt" == *"Summarize this podcast episode"* ]]; then
  cat <<'JSON'
{
  "oneLiner": "${name === "deepseek" ? "DeepSeek summary" : "Kimi summary"}",
  "overview": "Local command-line LLM fallback completed.",
  "chapters": [
    { "title": "Fallback", "startSec": 0, "endSec": 120, "summary": "DeepSeek falls back to Kimi." }
  ],
  "worthListening": {
    "recommendation": "listen_segments",
    "reason": "Relevant fallback behavior.",
    "bestSegments": [
      { "startSec": 0, "endSec": 120, "reason": "Core segment" }
    ]
  },
  "entities": [
    { "name": "DeepSeek", "type": "tool", "mentions": 1 },
    { "name": "Kimi", "type": "tool", "mentions": 1 }
  ]
}
JSON
else
  cat <<'JSON'
{
  "insights": [
    {
      "segmentIndex": 0,
      "claim": "${name === "deepseek" ? "DeepSeek insight" : "Kimi insight"}",
      "evidenceExcerpt": "DeepSeek and Kimi local command line fallback supports podcast intelligence workflow integration.",
      "reasoning": "The transcript states the fallback path directly.",
      "implication": "The worker can use local CLI fallback.",
      "timestampStartSec": 0,
      "timestampEndSec": 120,
      "entities": [
        { "name": "DeepSeek", "type": "tool" },
        { "name": "Kimi", "type": "tool" }
      ],
      "relevanceScore": 0.92,
      "confidence": 0.9
    }
  ]
}
JSON
fi
`;
}
