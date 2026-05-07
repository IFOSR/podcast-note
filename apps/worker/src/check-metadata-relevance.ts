import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stableId } from "../../../packages/core/src/format.ts";
import type { Episode } from "../../../packages/core/src/types.ts";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { enqueueRelevantEpisodes } from "./relevance.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-relevance-"));
const dbPath = join(dir, "check.sqlite");

try {
  const db = openPodcastNoteDb(dbPath);
  const repos = createRepositories(db);
  const user = repos.upsertUser({ id: "user_relevance", email: "relevance@example.com", name: "Relevance User" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const watch = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_relevance_ai",
    name: "AI Workflow Relevance",
    type: "topic",
    query: "AI agent workflow",
    outputLanguage: "zh-CN",
    includeTerms: ["AI agent", "workflow"],
    excludeTerms: ["sports agent", "real estate"],
    minRelevanceScore: 0.65,
    frequency: "realtime",
    backfillDays: 30
  });

  repos.upsertSource({ id: "src_relevance", type: "rss", url: "https://example.invalid/feed.xml", title: "Relevance Feed" });
  const relevant = upsertEpisode(repos, {
    id: stableId("ep", "relevance-accepted"),
    sourceId: "src_relevance",
    title: "AI agent workflow lessons for podcast research",
    description: "A practical episode about AI agent workflow orchestration and automation.",
    publishedAt: "2026-05-07T01:00:00.000Z",
    audioUrl: "https://example.invalid/accepted.mp3",
    pageUrl: "https://example.invalid/accepted",
    language: "en"
  });
  const excluded = upsertEpisode(repos, {
    id: stableId("ep", "relevance-excluded"),
    sourceId: "src_relevance",
    title: "Sports agent contract workflow",
    description: "A sports agent discusses athlete contract workflows.",
    publishedAt: "2026-05-07T01:05:00.000Z",
    audioUrl: "https://example.invalid/excluded.mp3",
    pageUrl: "https://example.invalid/excluded",
    language: "en"
  });
  const weak = upsertEpisode(repos, {
    id: stableId("ep", "relevance-weak"),
    sourceId: "src_relevance",
    title: "General business productivity notes",
    description: "A broad conversation without AI or agent-specific details.",
    publishedAt: "2026-05-07T01:10:00.000Z",
    audioUrl: "https://example.invalid/weak.mp3",
    pageUrl: "https://example.invalid/weak",
    language: "en"
  });

  const result = enqueueRelevantEpisodes({
    repositories: repos,
    workspaceId: workspace.id,
    watch,
    episodes: [relevant, excluded, weak],
    queuedAt: "2026-05-07T02:00:00.000Z"
  });

  const queued = repos.listQueuedEpisodeProcessingJobs({ workspaceId: workspace.id, limit: 10 });
  const acceptedJob = queued.find((job) => job.episodeId === relevant.id);
  const decisions = result.decisions.reduce<Record<string, { accepted: boolean; score: number; reason: Record<string, unknown> }>>((acc, item) => {
    acc[item.episode.id] = { accepted: item.accepted, score: item.score, reason: item.reason };
    return acc;
  }, {});

  if (result.queuedCount !== 1 || queued.length !== 1 || !acceptedJob) {
    throw new Error(`Expected exactly one relevant episode to be queued, got ${JSON.stringify({ result, queued })}.`);
  }
  if (!decisions[relevant.id]?.accepted || decisions[relevant.id].score < watch.minRelevanceScore) {
    throw new Error("Expected relevant episode to pass min relevance score.");
  }
  if (decisions[excluded.id]?.accepted || !String(decisions[excluded.id]?.reason["excludedTerms"]).includes("sports agent")) {
    throw new Error("Expected excluded terms to suppress sports-agent episode.");
  }
  if (decisions[weak.id]?.accepted || decisions[weak.id].score >= watch.minRelevanceScore) {
    throw new Error("Expected weak metadata match to stay below min relevance score.");
  }
  if ((acceptedJob.relevanceScore ?? 0) < watch.minRelevanceScore || !String(acceptedJob.relevanceReason["matchedTerms"]).includes("AI agent")) {
    throw new Error("Expected queue job to persist relevance score and reason.");
  }

  console.log(JSON.stringify({
    ok: true,
    queuedCount: result.queuedCount,
    queuedEpisodeIds: queued.map((job) => job.episodeId),
    scores: Object.fromEntries(Object.entries(decisions).map(([id, item]) => [id, Number(item.score.toFixed(2))]))
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

function upsertEpisode(repos: ReturnType<typeof createRepositories>, episode: Episode): Episode {
  repos.upsertEpisode(episode);
  return episode;
}
