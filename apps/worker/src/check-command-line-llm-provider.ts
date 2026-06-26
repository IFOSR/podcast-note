import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCommandLineInsightProvider, createCommandLineIntentAssistantProvider, createCommandLineJsonProvider } from "../../../packages/ai/src/index.ts";
import type { Episode, SemanticSegment, Watch } from "../../../packages/core/src/types.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-command-line-llm-"));
const deepseek = join(dir, "fake-deepseek-tui");
const kimi = join(dir, "fake-kimi");
const logPath = join(dir, "calls.log");

try {
  writeFileSync(deepseek, fakeCli("deepseek"), { mode: 0o755 });
  writeFileSync(kimi, fakeCli("kimi"), { mode: 0o755 });

  const episode: Episode = {
    id: "episode_command_line_llm",
    title: "Agent Workflow",
    pageUrl: "https://example.invalid/agent-workflow",
    audioUrl: "https://example.invalid/agent-workflow.mp3",
    durationSec: 240
  };
  const watch: Watch = {
    id: "watch_command_line_llm",
    workspaceId: "workspace_command_line_llm",
    name: "AI Agent",
    type: "topic",
    query: "AI Agent workflow",
    outputLanguage: "zh-CN",
    includeTerms: ["AI Agent"],
    excludeTerms: [],
    expandedTerms: ["workflow"],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 30,
    enabled: true
  };
  const segments: SemanticSegment[] = [{
    index: 0,
    startSec: 0,
    endSec: 120,
    text: "AI Agent products are moving into enterprise workflow integration.",
    textExcerpt: "AI Agent products are moving into enterprise workflow integration.",
    title: "Workflow",
    summary: "Workflow integration."
  }];

  const provider = createCommandLineInsightProvider({
    deepseekCommand: deepseek,
    kimiCommand: kimi,
    model: "fake-model",
    timeoutMs: 5000
  });
  const summary = await provider.summarizeEpisode({
    episode,
    segments,
    outputLanguage: "zh-CN"
  });
  if (summary.oneLiner !== "DeepSeek summary") throw new Error(`Expected DeepSeek summary, got ${summary.oneLiner}.`);

  const fallbackProvider = createCommandLineInsightProvider({
    deepseekCommand: `${deepseek} --fail`,
    kimiCommand: kimi,
    model: "fake-model",
    timeoutMs: 5000
  });
  const insights = await fallbackProvider.extractWatchInsights({
    workspaceId: watch.workspaceId,
    episode,
    watch,
    segments,
    outputLanguage: "zh-CN"
  });
  if (insights[0]?.claim !== "Kimi insight") throw new Error(`Expected Kimi fallback insight, got ${insights[0]?.claim}.`);

  const intentProvider = createCommandLineIntentAssistantProvider({
    deepseekCommand: `${deepseek} --bad-json`,
    kimiCommand: kimi,
    model: "fake-model",
    timeoutMs: 5000
  });
  const intent = await intentProvider.analyze({
    message: "帮我监控小宇宙的硅谷101",
    outputLanguage: "zh-CN",
    context: { workspaceName: "Check", activeWatches: [], recentEpisodes: [] }
  });
  if (intent.intent !== "create_monitor" || intent.suggestedAction.type !== "submit_monitor_target") {
    throw new Error(`Expected Kimi fallback monitor intent, got ${JSON.stringify(intent)}.`);
  }

  const jsonProvider = createCommandLineJsonProvider({
    deepseekCommand: `${deepseek} --fail`,
    kimiCommand: kimi,
    model: "fake-model",
    timeoutMs: 5000
  }, "wiki");
  const wikiJson = await jsonProvider.completeJson<{ answer: string }>({
    schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
    prompt: "Answer a wiki question. Return JSON."
  });
  if (wikiJson.answer !== "Kimi wiki answer") throw new Error(`Expected Kimi wiki fallback JSON, got ${JSON.stringify(wikiJson)}.`);

  const calls = readFileSync(logPath, "utf8");
  if (!calls.includes("deepseek:exec --model fake-model")) throw new Error(`DeepSeek exec args not observed: ${calls}`);
  if (!calls.includes("kimi:--quiet -m fake-model -p")) throw new Error(`Kimi non-interactive args not observed: ${calls}`);

  console.log(JSON.stringify({
    ok: true,
    provider: provider.name,
    summary: summary.oneLiner,
    fallbackInsight: insights[0]?.claim,
    fallbackIntent: intent.intent,
    wikiAnswer: wikiJson.answer,
    calls: calls.trim().split("\n")
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
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
if [[ "$*" == *"--bad-json"* ]]; then
  echo "not json"
  exit 0
fi
prompt="$*"
if [[ "$prompt" == *"Summarize this podcast episode"* ]]; then
  cat <<'JSON'
{
  "oneLiner": "${name === "deepseek" ? "DeepSeek summary" : "Kimi summary"}",
  "overview": "Overview",
  "chapters": [
    { "title": "Workflow", "startSec": 0, "endSec": 120, "summary": "Workflow integration." }
  ],
  "worthListening": {
    "recommendation": "listen_segments",
    "reason": "Relevant",
    "bestSegments": [
      { "startSec": 0, "endSec": 120, "reason": "Core segment" }
    ]
  },
  "entities": [
    { "name": "AI Agent", "type": "concept", "mentions": 1 }
  ]
}
JSON
elif [[ "$prompt" == *"Extract only watch-specific insights"* ]]; then
  cat <<'JSON'
{
  "insights": [
    {
      "segmentIndex": 0,
      "claim": "${name === "deepseek" ? "DeepSeek insight" : "Kimi insight"}",
      "evidenceExcerpt": "AI Agent products are moving into enterprise workflow integration.",
      "reasoning": "The transcript states the shift directly.",
      "implication": "Enterprise workflow integration matters.",
      "timestampStartSec": 0,
      "timestampEndSec": 120,
      "entities": [{ "name": "AI Agent", "type": "concept" }],
      "relevanceScore": 0.91,
      "confidence": 0.88
    }
  ]
}
JSON
elif [[ "$prompt" == *"Answer a wiki question"* ]]; then
  cat <<'JSON'
{
  "answer": "${name === "deepseek" ? "DeepSeek wiki answer" : "Kimi wiki answer"}"
}
JSON
else
  cat <<'JSON'
{
  "intent": "create_monitor",
  "confidence": 0.9,
  "reasoning": "User wants monitoring.",
  "answer": "我理解你想创建监控任务。",
  "extracted": {
    "target": "小宇宙",
    "channel": "硅谷101",
    "keywords": ["AI Agent"],
    "frequency": "daily"
  },
  "suggestedAction": {
    "type": "none",
    "label": "无需操作",
    "payload": {}
  }
}
JSON
fi
`;
}
