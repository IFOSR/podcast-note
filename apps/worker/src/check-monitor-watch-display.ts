import { readFile } from "node:fs/promises";

const source = await readFile("apps/web/src/server/preview.ts", "utf8");

const required = [
  "watchDisplayInfo",
  "latestEpisodeSourceTitle",
  "频道链接：",
  "platformLabel",
  "looksLikeHostname",
  "sourceForUrl",
  "小宇宙"
];

for (const text of required) {
  if (!source.includes(text)) {
    throw new Error(`Monitor watch display check missed required text: ${text}`);
  }
}

console.log("Monitor watch display check passed.");
