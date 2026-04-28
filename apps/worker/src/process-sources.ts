import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { InsightProvider, TranscriptProvider } from "../../../packages/ai/src/index.ts";
import { connectorFor } from "../../../packages/connectors/src/index.ts";
import type { ResolvedEpisode } from "../../../packages/connectors/src/index.ts";
import { episodeDedupeKey, normalizeTitle } from "../../../packages/core/src/dedupe.ts";
import { stableId } from "../../../packages/core/src/format.ts";
import type { Episode, OutputLanguage, Watch } from "../../../packages/core/src/types.ts";
import { markdownReport, processTranscript } from "./pipeline.ts";

export type UserWatchInput = {
  name: string;
  topic: string;
  language?: OutputLanguage;
  mustInclude?: string[];
  avoid?: string[];
};

export type UserSourcesInput = {
  sources: string[];
};

export type ProcessSourcesOptions = {
  watchPath?: string;
  sourcesPath?: string;
  outputDir?: string;
  maxEpisodesPerSource?: number;
};

export type ProcessedSourceResult = {
  source: string;
  episodeTitle: string;
  outputDir: string;
  reportPath: string;
  transcriptPath: string;
  resultPath: string;
};

export async function processSources(input: {
  options?: ProcessSourcesOptions;
  transcriptProvider: TranscriptProvider;
  insightProvider: InsightProvider;
}): Promise<ProcessedSourceResult[]> {
  const options = input.options ?? {};
  const watchInput = await loadJson<UserWatchInput>(options.watchPath ?? "inputs/watch.json");
  const sourcesInput = await loadJson<UserSourcesInput>(options.sourcesPath ?? "inputs/sources.json");
  const watch = userWatchToSystemWatch(watchInput);
  const outputRoot = resolve(options.outputDir ?? "outputs");
  const maxEpisodesPerSource = options.maxEpisodesPerSource ?? 10;
  const results: ProcessedSourceResult[] = [];

  assertUserSourcesInput(sourcesInput);

  for (const source of sourcesInput.sources) {
    const episodes = await episodesFromSource(source, maxEpisodesPerSource);
    for (const episode of episodes) {
      if (!episode.audioUrl) {
        throw new Error(`No public audio URL could be resolved for ${episode.title} (${episode.pageUrl}).`);
      }

      const transcript = await input.transcriptProvider.transcribe({
        episode,
        audioUrl: episode.audioUrl
      });

      const processed = await processTranscript(
        {
          workspaceId: watch.workspaceId,
          watch,
          episode,
          transcriptSegments: transcript.segments
        },
        input.insightProvider
      );

      const episodeDir = join(outputRoot, slugForEpisode(episode));
      const transcriptPath = join(episodeDir, "transcript.json");
      const resultPath = join(episodeDir, "result.json");
      const reportPath = join(episodeDir, "report.md");

      await mkdir(episodeDir, { recursive: true });
      await writeJson(transcriptPath, transcript);
      await writeJson(resultPath, processed);
      await writeFile(reportPath, markdownReport(processed, watch), "utf8");

      results.push({
        source,
        episodeTitle: episode.title,
        outputDir: episodeDir,
        reportPath,
        transcriptPath,
        resultPath
      });
    }
  }

  return results;
}

export function userWatchToSystemWatch(input: UserWatchInput): Watch {
  assertUserWatchInput(input);
  const query = input.topic.trim();
  const includeTerms = normalizeTerms(input.mustInclude);
  const excludeTerms = normalizeTerms(input.avoid);
  const expandedTerms = [...new Set([query, ...includeTerms])];

  return {
    id: stableId("watch", `${input.name}:${query}`),
    workspaceId: "workspace_local",
    name: input.name.trim(),
    type: "topic",
    query,
    outputLanguage: input.language ?? "zh-CN",
    includeTerms,
    excludeTerms,
    expandedTerms,
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 30
  };
}

async function episodesFromSource(source: string, limit: number): Promise<Episode[]> {
  if (isDirectAudioUrl(source)) {
    return [{
      id: stableId("ep", source),
      title: basename(new URL(source).pathname) || "Manual audio",
      pageUrl: source,
      audioUrl: source
    }];
  }

  const connector = connectorFor(source);
  if (isRssLike(source)) {
    const resolvedSource = await connector.resolveSource(source);
    const episodes = await connector.listEpisodes(resolvedSource, { limit });
    return episodes.map((episode) => resolvedEpisodeToEpisode(episode));
  }

  return [resolvedEpisodeToEpisode(await connector.resolveEpisode(source))];
}

function resolvedEpisodeToEpisode(episode: ResolvedEpisode): Episode {
  const normalized: Episode = {
    id: stableId("ep", episodeDedupeKey({
      guid: episode.guid,
      audioUrl: episode.audioUrl,
      pageUrl: episode.pageUrl,
      title: episode.title
    })),
    guid: episode.guid,
    title: episode.title,
    description: episode.description,
    publishedAt: episode.publishedAt,
    durationSec: episode.durationSec,
    audioUrl: episode.audioUrl,
    pageUrl: episode.pageUrl,
    language: episode.language,
    metadata: episode.metadata
  };
  return normalized;
}

function slugForEpisode(episode: Episode): string {
  const base = normalizeTitle(episode.title).replace(/\s+/g, "-").slice(0, 72) || "episode";
  return `${base}-${episode.id.replace(/^ep_/, "")}`;
}

async function loadJson<T>(path: string): Promise<T> {
  const raw = await readFile(resolve(path), "utf8");
  return JSON.parse(raw) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertUserWatchInput(input: UserWatchInput): void {
  if (!input || typeof input !== "object") throw new Error("watch.json must be an object.");
  if (!input.name?.trim()) throw new Error("watch.json requires a non-empty name.");
  if (!input.topic?.trim()) throw new Error("watch.json requires a non-empty topic.");
  if (input.language && !["zh-CN", "en", "source"].includes(input.language)) {
    throw new Error("watch.json language must be zh-CN, en, or source.");
  }
  if (input.mustInclude && !Array.isArray(input.mustInclude)) throw new Error("watch.json mustInclude must be an array.");
  if (input.avoid && !Array.isArray(input.avoid)) throw new Error("watch.json avoid must be an array.");
}

function assertUserSourcesInput(input: UserSourcesInput): void {
  if (!input || typeof input !== "object") throw new Error("sources.json must be an object.");
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    throw new Error("sources.json requires a non-empty sources array.");
  }
  for (const source of input.sources) {
    if (typeof source !== "string" || !source.trim()) {
      throw new Error("sources.json sources must contain non-empty URL strings.");
    }
  }
}

function normalizeTerms(terms: string[] | undefined): string[] {
  return [...new Set((terms ?? []).map((term) => term.trim()).filter(Boolean))];
}

function isRssLike(input: string): boolean {
  return /\.(xml|rss)(\?|$)/i.test(input);
}

function isDirectAudioUrl(input: string): boolean {
  try {
    return /\.(mp3|wav|ogg|raw)$/i.test(new URL(input).pathname);
  } catch {
    return false;
  }
}
