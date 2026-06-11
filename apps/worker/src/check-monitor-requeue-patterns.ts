import { readFile } from "node:fs/promises";

const source = await readFile("apps/web/src/server/preview.ts", "utf8");

for (const pattern of ["%Unable to connect%", "%typo in the url or port%"]) {
  if (!source.includes(pattern)) {
    throw new Error(`Monitor scheduler transient retry patterns must include ${pattern}.`);
  }
}

console.log("Monitor requeue patterns check passed.");
