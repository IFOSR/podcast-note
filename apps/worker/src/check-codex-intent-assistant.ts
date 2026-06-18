import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCodexIntentAssistantProvider } from "../../../packages/ai/src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-codex-intent-"));
const fakeCodex = join(dir, "fake-codex.sh");

try {
  writeFileSync(fakeCodex, `#!/usr/bin/env bash
set -euo pipefail
output=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-last-message)
      output="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
cat > /dev/null
cat > "$output" <<'JSON'
{
  "intent": "create_monitor",
  "confidence": 0.91,
  "reasoning": "用户说帮我监控并给出了平台、节目和关键词。",
  "answer": "我理解你想创建一个每日监控任务。",
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
`, { mode: 0o755 });

  const provider = createCodexIntentAssistantProvider({
    command: fakeCodex,
    model: "fake-intent-model",
    cwd: process.cwd(),
    timeoutMs: 5000
  });
  const result = await provider.analyze({
    message: "帮我监控小宇宙的硅谷101，每天检查 AI Agent",
    outputLanguage: "zh-CN",
    context: {
      workspaceName: "Check Workspace",
      activeWatches: [],
      recentEpisodes: []
    }
  });

  if (result.intent !== "create_monitor" || result.suggestedAction.type !== "submit_monitor_target") {
    throw new Error(`Expected create_monitor with submit_monitor_target action, got ${JSON.stringify(result)}.`);
  }
  if (result.suggestedAction.payload["target"] !== "小宇宙" || result.suggestedAction.payload["channel"] !== "硅谷101") {
    throw new Error(`Expected extracted monitor payload, got ${JSON.stringify(result.suggestedAction.payload)}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    provider: provider.name,
    model: provider.model,
    intent: result.intent,
    action: result.suggestedAction.type,
    payload: result.suggestedAction.payload
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
