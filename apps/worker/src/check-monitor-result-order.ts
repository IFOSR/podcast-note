import { readFile } from "node:fs/promises";

const source = await readFile("apps/web/src/server/preview.ts", "utf8");

if (!source.includes("order by datetime(coalesce(e.published_at")) {
  throw new Error("Monitor result ordering must prioritize episode published_at.");
}
if (!source.includes("结果排序：按节目发布时间倒序")) {
  throw new Error("Monitor page must explain that results are sorted by episode publish time.");
}
if (source.includes("结果排序：按处理完成时间倒序")) {
  throw new Error("Monitor page must not describe processing-time ordering.");
}

console.log("Monitor result order check passed.");
