import { readFileSync } from "node:fs";

const source = readFileSync("apps/web/src/server/preview.ts", "utf8");

if (!source.includes('parseStoredDate(String(row["started_at"]))')) {
  throw new Error("Monitor stale-job detection must parse SQLite timestamps through parseStoredDate.");
}

if (source.includes('String(row["started_at"]).replace(" ", "T")')) {
  throw new Error("Monitor stale-job detection must not parse SQLite timestamps as local time.");
}

console.log("Monitor stale time parsing check passed.");
