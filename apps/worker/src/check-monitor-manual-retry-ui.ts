import { readFile } from "node:fs/promises";

const source = await readFile("apps/web/src/server/preview.ts", "utf8");

const required = [
  "retry-episode",
  "retry-failed",
  "重新处理本集",
  "重试失败项",
  "attempts = 0",
  "PODCAST_NOTE_MAX_AUTOMATIC_ATTEMPTS",
  "attempts < ?",
  "失败处理：系统会按阶段和音频时长判断是否卡死",
  "processingStageTimeoutMs",
  "durationMs * 2"
];

for (const text of required) {
  if (!source.includes(text)) {
    throw new Error(`Monitor manual retry UI check missed required text: ${text}`);
  }
}

console.log("Monitor manual retry UI check passed.");
