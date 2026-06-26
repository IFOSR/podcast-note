import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { InsightProvider, TranscriptProvider, TranscriptionOutput } from "../../../packages/ai/src/index.ts";
import { connectorFor } from "../../../packages/connectors/src/index.ts";
import type { ResolvedEpisode, ResolvedSource } from "../../../packages/connectors/src/index.ts";
import { episodeDedupeKey, normalizeTitle } from "../../../packages/core/src/dedupe.ts";
import { stableId } from "../../../packages/core/src/format.ts";
import type { Episode, OutputLanguage, Source, Watch } from "../../../packages/core/src/types.ts";
import type { ObjectStorageAdapter } from "../../../packages/storage/src/index.ts";
import { putAudioCache, putTranscriptJson } from "../../../packages/storage/src/index.ts";
import { createLarkBotClient } from "../../../packages/lark/src/index.ts";
import { deliverEpisodeResultToAllLarkInstallations, deliverPendingWikiProposalSummaryToAllLarkInstallations } from "./lark-delivery.ts";
import { markdownReport, processTranscript } from "./pipeline.ts";
import { compileEpisodeToWiki, createDeepSeekTuiWikiProposalProvider } from "../../../packages/wiki/src/index.ts";
import { recordCompiledWikiRegistry } from "./wiki-registry.ts";

export type UserWatchInput = {
  workspaceId?: string;
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
  obsidianVault?: string;
  wikiAutoApply?: boolean;
  wikiMinConfidence?: number;
  wikiMinGroundedness?: number;
  wikiProposalProvider?: "deepseek-tui";
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

type Repositories = NonNullable<Parameters<typeof processSources>[0]["repositories"]>;

export type ProcessSourceInputsOptions = {
  watch: UserWatchInput;
  sources: UserSourcesInput;
  outputDir?: string;
  obsidianVault?: string;
  wikiAutoApply?: boolean;
  wikiMinConfidence?: number;
  wikiMinGroundedness?: number;
  wikiProposalProvider?: "deepseek-tui";
  maxEpisodesPerSource?: number;
  runId?: string;
  now?: string;
};

type SourceEpisodes = {
  source?: Source;
  episodes: Episode[];
};

export async function processSources(input: {
  options?: ProcessSourcesOptions;
  transcriptProvider: TranscriptProvider;
  insightProvider: InsightProvider;
  repositories?: Repositories;
  objectStorage?: ObjectStorageAdapter;
}): Promise<ProcessedSourceResult[]> {
  const options = input.options ?? {};
  const watchInput = await loadJson<UserWatchInput>(options.watchPath ?? "inputs/watch.json");
  const sourcesInput = await loadJson<UserSourcesInput>(options.sourcesPath ?? "inputs/sources.json");
  return processSourceInputs({
    ...input,
    options: {
      watch: watchInput,
      sources: sourcesInput,
      outputDir: options.outputDir,
      obsidianVault: options.obsidianVault,
      wikiAutoApply: options.wikiAutoApply,
      wikiMinConfidence: options.wikiMinConfidence,
      wikiMinGroundedness: options.wikiMinGroundedness,
      wikiProposalProvider: options.wikiProposalProvider,
      maxEpisodesPerSource: options.maxEpisodesPerSource
    }
  });
}

export async function processSourceInputs(input: {
  options: ProcessSourceInputsOptions;
  transcriptProvider: TranscriptProvider;
  insightProvider: InsightProvider;
  repositories?: Repositories;
  objectStorage?: ObjectStorageAdapter;
}): Promise<ProcessedSourceResult[]> {
  const options = input.options;
  const watchInput = options.watch;
  const sourcesInput = options.sources;
  const watch = userWatchToSystemWatch(watchInput);
  if (input.repositories) ensureWorkspaceForWatch(input.repositories, watch);
  const outputRoot = resolve(options.outputDir ?? "outputs");
  const maxEpisodesPerSource = options.maxEpisodesPerSource ?? 10;
  const results: ProcessedSourceResult[] = [];

  assertUserSourcesInput(sourcesInput);
  input.repositories?.upsertWatch(watch);
  const runId = options.runId ?? input.repositories?.startProcessingRun({
    watchId: watch.id,
    sources: sourcesInput.sources
  });

  try {
    for (const source of sourcesInput.sources) {
      const resolved = await episodesFromSource(source, maxEpisodesPerSource);
      if (resolved.source) input.repositories?.upsertSource(resolved.source);
      for (const episode of resolved.episodes) {
        input.repositories?.upsertEpisode(episode);
        updateStage(input.repositories, runId, episode.id, source, "resolved", "completed");
      }
      for (const episode of resolved.episodes) {
        try {
          if (!episode.audioUrl) {
            throw new Error(`No public audio URL could be resolved for ${episode.title} (${episode.pageUrl}).`);
          }

          const transcript = await transcriptForEpisode({
            episode,
            source,
            repositories: input.repositories,
            runId,
            transcriptProvider: input.transcriptProvider,
            objectStorage: input.objectStorage
          });

          updateStage(input.repositories, runId, episode.id, source, "analyzing", "running");
          const processed = await processTranscript(
            {
              workspaceId: watch.workspaceId,
              watch,
              episode,
              transcriptSegments: transcript.segments
            },
            input.insightProvider
          );
          input.repositories?.saveProcessingResult(processed, watch, input.insightProvider.model);
          await maybeCompileWiki({
            repositories: input.repositories,
            watch,
            result: processed,
            options,
            summaryModel: input.insightProvider.model
          });
          await maybeDeliverToLark({
            repositories: input.repositories,
            watch,
            result: processed
          });
          updateStage(input.repositories, runId, episode.id, source, "analyzed", "completed");

          const episodeDir = join(outputRoot, slugForEpisode(episode));
          const transcriptPath = join(episodeDir, "transcript.json");
          const resultPath = join(episodeDir, "result.json");
          const reportPath = join(episodeDir, "report.md");

          await mkdir(episodeDir, { recursive: true });
          await writeJson(transcriptPath, transcript);
          await writeJson(resultPath, processed);
          await writeFile(reportPath, markdownReport(processed, watch), "utf8");
          updateStage(input.repositories, runId, episode.id, source, "exported", "completed");

          results.push({
            source,
            episodeTitle: episode.title,
            outputDir: episodeDir,
            reportPath,
            transcriptPath,
            resultPath
          });
        } catch (error) {
          updateStage(input.repositories, runId, episode.id, source, "failed", "failed", errorMessage(error));
          throw error;
        }
      }
    }
    if (runId) input.repositories?.completeProcessingRun(runId);
  } catch (error) {
    if (runId) input.repositories?.failProcessingRun(runId, errorMessage(error));
    throw error;
  }

  return results;
}

async function maybeCompileWiki(input: {
  repositories?: Repositories;
  watch: Watch;
  result: Awaited<ReturnType<typeof processTranscript>>;
  options: ProcessSourceInputsOptions;
  summaryModel?: string;
}): Promise<void> {
  const vaultRoot = input.options.obsidianVault ?? process.env["PODCAST_NOTE_OBSIDIAN_VAULT"];
  if (!vaultRoot) return;
  const compiled = await compileEpisodeToWiki({
    config: {
      vaultRoot,
      autoApply: input.options.wikiAutoApply ?? envBoolean("PODCAST_NOTE_WIKI_AUTO_APPLY"),
      minConfidence: input.options.wikiMinConfidence ?? envNumber("PODCAST_NOTE_WIKI_MIN_CONFIDENCE"),
      minGroundedness: input.options.wikiMinGroundedness ?? envNumber("PODCAST_NOTE_WIKI_MIN_GROUNDEDNESS"),
      proposalProvider: wikiProposalProvider(input.options.wikiProposalProvider)
    },
    result: input.result,
    watch: input.watch,
    summaryModel: input.summaryModel
  });
  input.repositories?.recordWikiExport({
    workspaceId: input.watch.workspaceId,
    vaultRoot,
    episodeId: input.result.episode.id,
    watchId: input.watch.id,
    exportType: "source_note",
    filePath: compiled.sourceNotePath,
    contentHash: compiled.sourceNoteHash,
    status: compiled.sourceNoteStatus
  });
  for (const proposal of compiled.proposals) {
    input.repositories?.upsertWikiUpdateProposal({
      id: proposal.id,
      workspaceId: proposal.workspaceId,
      episodeId: proposal.episodeId,
      insightId: proposal.insightId,
      targetPath: proposal.targetPath,
      proposalType: proposal.proposalType,
      title: proposal.title,
      rationale: proposal.rationale,
      patch: proposal.patch as unknown as Record<string, unknown>,
      status: proposal.status
    });
  }
  for (const path of compiled.appliedPaths) {
    input.repositories?.recordWikiExport({
      workspaceId: input.watch.workspaceId,
      vaultRoot,
      episodeId: input.result.episode.id,
      watchId: input.watch.id,
      exportType: "wiki_page",
      filePath: path,
      contentHash: compiled.appliedHashes[path] ?? `${input.result.episode.id}:${path}`,
      status: "written"
    });
  }
  if (input.repositories) {
    recordCompiledWikiRegistry({
      repositories: input.repositories,
      vaultRoot,
      watch: input.watch,
      result: input.result,
      compiled,
      observedAt: input.options.now
    });
  }
}

function wikiProposalProvider(option?: "deepseek-tui") {
  const provider = option ?? process.env["PODCAST_NOTE_WIKI_PROPOSAL_PROVIDER"];
  if (provider === "deepseek-tui") return createDeepSeekTuiWikiProposalProvider();
  if (!provider) return undefined;
  throw new Error(`Unsupported wiki proposal provider: ${provider}. Supported: deepseek-tui.`);
}

async function maybeDeliverToLark(input: {
  repositories?: Repositories;
  watch: Watch;
  result: Awaited<ReturnType<typeof processTranscript>>;
}): Promise<void> {
  if (!input.repositories) return;
  const appId = process.env["LARK_APP_ID"] ?? process.env["FEISHU_APP_ID"];
  const appSecret = process.env["LARK_APP_SECRET"] ?? process.env["FEISHU_APP_SECRET"];
  if (!appId || !appSecret) {
    console.warn("Lark delivery skipped: LARK_APP_ID/LARK_APP_SECRET is not configured.");
    return;
  }
  const installations = input.repositories.listActiveLarkBotInstallationsForWorkspace(input.watch.workspaceId, appId);
  if (installations.length === 0) {
    console.warn(`Lark delivery skipped: no active bot installation for workspace ${input.watch.workspaceId}.`);
    return;
  }
  try {
    const delivery = await deliverEpisodeResultToAllLarkInstallations({
      repositories: input.repositories,
      clientFactory: () => createLarkBotClient({ appId, appSecret }),
      workspaceId: input.watch.workspaceId,
      appId,
      watch: input.watch,
      result: input.result
    });
    const proposalSummary = await deliverPendingWikiProposalSummaryToAllLarkInstallations({
      repositories: input.repositories,
      clientFactory: () => createLarkBotClient({ appId, appSecret }),
      workspaceId: input.watch.workspaceId,
      appId
    });
    console.log(JSON.stringify({
      ok: true,
      message: "Delivered episode result to Lark installations",
      ...delivery,
      proposalSummary,
      episodeId: input.result.episode.id,
      watchId: input.watch.id
    }));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      message: "Lark delivery failed",
      episodeId: input.result.episode.id,
      watchId: input.watch.id,
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}

function ensureWorkspaceForWatch(repositories: Repositories, watch: Watch): void {
  if (repositories.getWorkspace(watch.workspaceId)) return;
  const user = repositories.upsertUser({
    id: "user_local_dev",
    email: "local-dev@example.com",
    name: "Local Dev User"
  });
  const workspace = repositories.ensurePersonalWorkspaceForUser(user.id);
  watch.workspaceId = workspace.id;
}

function envBoolean(name: string): boolean | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  return value === "1" || value.toLowerCase() === "true";
}

function envNumber(name: string): number | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function userWatchToSystemWatch(input: UserWatchInput): Watch {
  assertUserWatchInput(input);
  const query = input.topic.trim();
  const includeTerms = normalizeTerms(input.mustInclude);
  const excludeTerms = normalizeTerms(input.avoid);
  const expandedTerms = [...new Set([query, ...includeTerms])];

  return {
    id: stableId("watch", `${input.name}:${query}`),
    workspaceId: input.workspaceId ?? "workspace_local",
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

async function episodesFromSource(source: string, limit: number): Promise<SourceEpisodes> {
  if (isDirectAudioUrl(source)) {
    const storedSource = sourceFromUrl(source, "manual");
    return {
      source: storedSource,
      episodes: [{
        id: stableId("ep", source),
        sourceId: storedSource.id,
        title: basename(new URL(source).pathname) || "Manual audio",
        pageUrl: source,
        audioUrl: source
      }]
    };
  }

  const connector = connectorFor(source);
  if (isRssLike(source)) {
    const resolvedSource = await connector.resolveSource(source);
    const storedSource = resolvedSourceToSource(resolvedSource);
    const episodes = await connector.listEpisodes(resolvedSource, { limit });
    return {
      source: storedSource,
      episodes: episodes.map((episode) => resolvedEpisodeToEpisode(episode, storedSource.id))
    };
  }

  const resolvedSource = await connector.resolveSource(source);
  const storedSource = resolvedSourceToSource(resolvedSource);
  const episodes = await connector.listEpisodes(resolvedSource, { limit });
  return {
    source: storedSource,
    episodes: episodes.map((episode) => resolvedEpisodeToEpisode(episode, storedSource.id))
  };
}

async function transcriptForEpisode(input: {
  episode: Episode;
  source: string;
  repositories?: Repositories;
  runId?: string;
  transcriptProvider: TranscriptProvider;
  objectStorage?: ObjectStorageAdapter;
}): Promise<TranscriptionOutput> {
  const reusable = input.repositories?.getLatestTranscriptForEpisode(input.episode.id);
  if (reusable && reusable.segments.length > 0) {
    updateStage(input.repositories, input.runId, input.episode.id, input.source, "transcribing", "completed");
    updateStage(input.repositories, input.runId, input.episode.id, input.source, "transcribed", "completed");
    return {
      language: reusable.language,
      durationSec: reusable.durationSec,
      confidence: reusable.confidence,
      segments: reusable.segments
    };
  }

  updateStage(input.repositories, input.runId, input.episode.id, input.source, "transcribing", "running");
  const transcript = await input.transcriptProvider.transcribe({
    episode: input.episode,
    audioUrl: input.episode.audioUrl
  });
  if (input.objectStorage && input.episode.audioUrl) {
    await putAudioCache(input.objectStorage, {
      episodeId: input.episode.id,
      audioUrl: input.episode.audioUrl
    });
  }
  if (input.objectStorage) {
    await putTranscriptJson(input.objectStorage, {
      episodeId: input.episode.id,
      provider: input.transcriptProvider.name,
      model: input.transcriptProvider.model,
      transcript
    });
  }
  input.repositories?.saveTranscript({
    episodeId: input.episode.id,
    provider: input.transcriptProvider.name,
    model: input.transcriptProvider.model,
    transcript
  });
  updateStage(input.repositories, input.runId, input.episode.id, input.source, "transcribed", "completed");
  return transcript;
}

function resolvedEpisodeToEpisode(episode: ResolvedEpisode, sourceId?: string): Episode {
  const normalized: Episode = {
    id: stableId("ep", episodeDedupeKey({
      guid: episode.guid,
      audioUrl: episode.audioUrl,
      pageUrl: episode.pageUrl,
      title: episode.title
    })),
    sourceId,
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

function resolvedSourceToSource(source: ResolvedSource): Source {
  return {
    id: stableId("src", `${source.type}:${source.url}`),
    type: source.type,
    url: source.url,
    canonicalUrl: source.canonicalUrl,
    externalId: source.externalId,
    title: source.title,
    author: source.author,
    language: source.language
  };
}

function sourceFromUrl(url: string, type: Source["type"]): Source {
  return {
    id: stableId("src", `${type}:${url}`),
    type,
    url
  };
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

function updateStage(
  repositories: Repositories | undefined,
  runId: string | undefined,
  episodeId: string,
  sourceUrl: string,
  stage: Parameters<Repositories["updateEpisodeProcessingStatus"]>[0]["stage"],
  status: Parameters<Repositories["updateEpisodeProcessingStatus"]>[0]["status"],
  error?: string
): void {
  if (!repositories || !runId) return;
  repositories.updateEpisodeProcessingStatus({
    runId,
    episodeId,
    sourceUrl,
    stage,
    status,
    error
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
