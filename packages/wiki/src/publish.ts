import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { stableId } from "../../core/src/format.ts";
import type { LarkDocumentPublisher } from "./types.ts";

export async function publishMarkdownToLark(input: {
  publisher: LarkDocumentPublisher;
  markdownPath: string;
  title?: string;
  target?: string;
}): Promise<{
  id: string;
  providerDocumentId: string;
  url?: string;
}> {
  const markdown = await readFile(input.markdownPath, "utf8");
  const title = input.title ?? basename(input.markdownPath).replace(/\.md$/i, "");
  const published = await input.publisher.publishMarkdown({
    title,
    markdown,
    target: input.target
  });
  return {
    id: stableId("lark_doc", `${input.markdownPath}:${published.providerDocumentId}`),
    ...published
  };
}
