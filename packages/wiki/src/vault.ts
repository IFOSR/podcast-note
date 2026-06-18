import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { EpisodeProcessingResult, Watch } from "../../core/src/types.ts";
import type { WikiExportStatus, WikiVaultConfig } from "./types.ts";
import { contentHash, isoDate, slugifyPathPart } from "./format.ts";
import { renderEpisodeSourceNote } from "./render-episode-note.ts";

export type VaultWriteResult = {
  absolutePath: string;
  relativePath: string;
  contentHash: string;
  status: WikiExportStatus;
  conflictPath?: string;
};

export function sourceNoteRelativePath(input: {
  episodeTitle: string;
  publishedAt?: string;
  processedAt: string;
}): string {
  const date = isoDate(input.publishedAt, input.processedAt);
  return join("10 Sources", "Podcasts", date.slice(0, 4), `${date} - ${slugifyPathPart(input.episodeTitle)}.md`);
}

export async function ensureVaultSkeleton(vaultRoot: string): Promise<void> {
  const dirs = [
    "00 Inbox",
    "10 Sources/Podcasts",
    "20 Concepts",
    "30 Entities/People",
    "30 Entities/Companies",
    "30 Entities/Products",
    "30 Entities/Podcasts",
    "40 Claims",
    "50 Briefs/Daily",
    "50 Briefs/Weekly",
    "50 Briefs/Topic",
    "90 System",
    "assets/audio-clips",
    "assets/images"
  ];
  await mkdir(vaultRoot, { recursive: true });
  await Promise.all(dirs.map((dir) => mkdir(join(vaultRoot, dir), { recursive: true })));
  await writeIfMissing(join(vaultRoot, "AGENTS.md"), defaultAgentsMd());
  await writeIfMissing(join(vaultRoot, "index.md"), "# PodcastNote Wiki\n\n<!-- podcast-note:index:start -->\n\n<!-- podcast-note:index:end -->\n");
  await writeIfMissing(join(vaultRoot, "log.md"), "# Knowledge Log\n\n<!-- podcast-note:log:start -->\n\n<!-- podcast-note:log:end -->\n");
  await writeIfMissing(join(vaultRoot, "health.md"), "# Wiki Health\n\n<!-- podcast-note:health:start -->\n\nNo checks have run yet.\n\n<!-- podcast-note:health:end -->\n");
  await writeIfMissing(join(vaultRoot, "90 System", "schema.md"), defaultSchemaMd());
  await writeIfMissing(join(vaultRoot, "90 System", "aliases.md"), "# Aliases\n\n");
  await writeIfMissing(join(vaultRoot, "90 System", "export-state.json"), "{\n  \"version\": 1,\n  \"exports\": []\n}\n");
  await writeIfMissing(join(vaultRoot, "90 System", "prompt-versions.md"), "# Prompt Versions\n\n- wiki-proposal-v1\n- wiki-apply-v1\n- wiki-lint-v1\n");
}

export async function writeEpisodeSourceNote(input: {
  config: WikiVaultConfig;
  result: EpisodeProcessingResult;
  watch: Watch;
  transcriptProvider?: string;
  summaryModel?: string;
}): Promise<VaultWriteResult> {
  const processedAt = input.config.now ?? new Date().toISOString();
  await ensureVaultSkeleton(input.config.vaultRoot);
  const relativePath = sourceNoteRelativePath({
    episodeTitle: input.result.episode.title,
    publishedAt: input.result.episode.publishedAt,
    processedAt
  });
  const absolutePath = join(input.config.vaultRoot, relativePath);
  const rendered = renderEpisodeSourceNote({
    result: input.result,
    watch: input.watch,
    transcriptProvider: input.transcriptProvider,
    summaryModel: input.summaryModel,
    processedAt
  });
  return writeManagedMarkdown({
    vaultRoot: input.config.vaultRoot,
    absolutePath,
    content: rendered,
    replaceManagedBlock: false
  });
}

export async function writeManagedMarkdown(input: {
  vaultRoot: string;
  absolutePath: string;
  content: string;
  replaceManagedBlock?: boolean;
}): Promise<VaultWriteResult> {
  const absolutePath = resolve(input.absolutePath);
  const relativePath = relative(resolve(input.vaultRoot), absolutePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  const hash = contentHash(input.content);
  const existing = await readOptional(absolutePath);
  if (!existing) {
    await writeFile(absolutePath, input.content, "utf8");
    return { absolutePath, relativePath, contentHash: hash, status: "written" };
  }
  if (existing === input.content) {
    return { absolutePath, relativePath, contentHash: hash, status: "skipped" };
  }
  if (input.replaceManagedBlock !== false && hasManagedBlock(existing) && hasManagedBlock(input.content)) {
    const merged = replaceManagedBlock(existing, input.content);
    await writeFile(absolutePath, merged, "utf8");
    return { absolutePath, relativePath, contentHash: contentHash(merged), status: "written" };
  }
  const conflictPath = absolutePath.replace(/\.md$/i, `.conflict-${Date.now()}.md`);
  await writeFile(conflictPath, input.content, "utf8");
  return {
    absolutePath,
    relativePath,
    contentHash: hash,
    status: "failed",
    conflictPath
  };
}

export async function updateManagedFile(input: {
  vaultRoot: string;
  relativePath: string;
  title: string;
  marker: string;
  body: string;
}): Promise<VaultWriteResult> {
  const absolutePath = join(input.vaultRoot, input.relativePath);
  const start = `<!-- podcast-note:${input.marker}:start -->`;
  const end = `<!-- podcast-note:${input.marker}:end -->`;
  const fallback = `# ${input.title}\n\n${start}\n\n${input.body.trim()}\n\n${end}\n`;
  const existing = await readOptional(absolutePath);
  const next = existing && existing.includes(start) && existing.includes(end)
    ? `${existing.slice(0, existing.indexOf(start) + start.length)}\n\n${input.body.trim()}\n\n${existing.slice(existing.indexOf(end))}`
    : fallback;
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, next, "utf8");
  return {
    absolutePath,
    relativePath: relative(resolve(input.vaultRoot), absolutePath),
    contentHash: contentHash(next),
    status: existing === next ? "skipped" : "written"
  };
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  if (await readOptional(path)) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function hasManagedBlock(content: string): boolean {
  return content.includes("<!-- podcast-note:start -->") && content.includes("<!-- podcast-note:end -->");
}

function replaceManagedBlock(existing: string, next: string): string {
  const start = "<!-- podcast-note:start -->";
  const end = "<!-- podcast-note:end -->";
  const existingStart = existing.indexOf(start);
  const existingEnd = existing.indexOf(end, existingStart);
  const nextStart = next.indexOf(start);
  const nextEnd = next.indexOf(end, nextStart);
  return [
    existing.slice(0, existingStart),
    next.slice(nextStart, nextEnd + end.length),
    existing.slice(existingEnd + end.length)
  ].join("");
}

function defaultAgentsMd(): string {
  return [
    "# PodcastNote Vault Rules",
    "",
    "- `10 Sources/` contains deterministic source notes. Preserve provenance and timestamps.",
    "- `20 Concepts/`, `30 Entities/`, and `40 Claims/` are synthesis pages. Every claim needs source evidence.",
    "- Do not remove user-written material outside `podcast-note` managed blocks.",
    "- Use wikilinks for concepts, entities, claims, and source notes.",
    ""
  ].join("\n");
}

function defaultSchemaMd(): string {
  return [
    "# Wiki Schema",
    "",
    "Required frontmatter:",
    "",
    "- `type`: one of `podcast_episode`, `concept`, `entity`, `claim`, `brief`.",
    "- `last_updated`: ISO date for synthesis pages.",
    "- `confidence`: `low`, `medium`, or `high` when applicable.",
    "",
    "Citation format:",
    "",
    "- Use source note wikilink plus timestamp and `insight_id` when available.",
    ""
  ].join("\n");
}
