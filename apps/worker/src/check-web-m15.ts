import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Episode, Watch } from "../../../packages/core/src/types.ts";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import {
  createLocalSession,
  createWatch,
  getEpisodeDetailView,
  getInboxView,
  getSessionContext,
  listWatchCards,
  recordEpisodePlayback,
  recordInsightFeedback,
  updateWatch
} from "../../web/src/server/m1-app.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-web-m15-"));
const dbPath = join(dir, "check.sqlite");

try {
  const db = openPodcastNoteDb(dbPath);
  const repos = createRepositories(db);

  const session = createLocalSession({
    repositories: repos,
    user: {
      id: "user_web_m15",
      email: "web@example.invalid",
      name: "Web User",
      timezone: "Asia/Shanghai"
    },
    token: "web-session-token",
    now: "2026-05-07T08:00:00.000Z",
    expiresAt: "2026-05-08T08:00:00.000Z"
  });
  const context = getSessionContext({ repositories: repos, token: "web-session-token", now: "2026-05-07T09:00:00.000Z" });
  if (!context || context.user.id !== "user_web_m15" || context.workspace.id !== session.workspace.id) {
    throw new Error(`Expected hydrated web session context, got ${JSON.stringify(context)}.`);
  }

  const createdWatch = createWatch({
    repositories: repos,
    context,
    input: {
      name: "AI Agent Watch",
      type: "topic",
      query: "AI agent workflow",
      outputLanguage: "zh-CN",
      includeTerms: "AI, agent, workflow",
      excludeTerms: "sports",
      minRelevanceScore: 0.62,
      frequency: "daily",
      backfillDays: 14
    }
  });
  const disabledWatch = updateWatch({
    repositories: repos,
    context,
    watchId: createdWatch.id,
    input: { enabled: false, minRelevanceScore: 0.7 }
  });
  const watchCards = listWatchCards({ repositories: repos, context });
  if (watchCards.length !== 1 || watchCards[0]?.enabled !== false || disabledWatch?.minRelevanceScore !== 0.7) {
    throw new Error(`Expected one disabled watch card after update, got ${JSON.stringify({ watchCards, disabledWatch })}.`);
  }

  const watch: Watch = disabledWatch;
  repos.upsertSource({ id: "src_web_m15", type: "rss", url: "https://example.invalid/web.xml", title: "Web Feed" });
  const episode: Episode = {
    id: "episode_web_m15",
    sourceId: "src_web_m15",
    title: "AI agent workflow for product teams",
    description: "M1.5 web should render inbox, detail and feedback.",
    publishedAt: "2026-05-07T06:00:00.000Z",
    durationSec: 300,
    audioUrl: "https://example.invalid/web.mp3",
    pageUrl: "https://example.invalid/web",
    language: "en"
  };
  repos.upsertEpisode(episode);
  repos.saveTranscript({
    episodeId: episode.id,
    provider: "web-check",
    model: "mock-transcript",
    transcript: {
      language: "en",
      durationSec: 300,
      segments: [{ startSec: 30, endSec: 90, text: "AI agent workflow evidence for M1.5 web." }]
    }
  });
  repos.saveProcessingResult({
    episode,
    summary: {
      oneLiner: "M1.5 web can show a grounded podcast insight.",
      overview: "This fixture verifies the web app service layer can hydrate inbox and episode detail.",
      chapters: [{ title: "Web", startSec: 30, endSec: 90, summary: "Web detail evidence." }],
      worthListening: { recommendation: "listen_segments", reason: "Strong match.", bestSegments: [{ startSec: 30, endSec: 90, reason: "Main evidence." }] },
      entities: [{ name: "AI agent", type: "technology", mentions: 1 }]
    },
    segments: [],
    insights: [{
      id: "insight_web_m15",
      workspaceId: context.workspace.id,
      watchId: watch.id,
      episodeId: episode.id,
      segmentIndex: 0,
      claim: "AI agent workflows are visible from the M1.5 inbox.",
      evidenceExcerpt: "AI agent workflow evidence for M1.5 web.",
      reasoning: "Matches the configured watch.",
      implication: "The user can triage and save the insight.",
      timestampStartSec: 30,
      timestampEndSec: 90,
      entities: [{ name: "AI agent", type: "technology" }],
      relevanceScore: 0.93,
      confidence: 0.9,
      groundednessScore: 0.91,
      outputLanguage: "zh-CN",
      status: "published",
      promptVersion: "web-check-v1",
      model: "web-check"
    }]
  }, watch, "web-check");

  const inbox = getInboxView({ repositories: repos, context, limit: 10 });
  const feedback = recordInsightFeedback({
    repositories: repos,
    context,
    insightId: "insight_web_m15",
    action: "saved",
    note: "Useful for M1.5"
  });
  const detail = getEpisodeDetailView({ repositories: repos, context, episodeId: episode.id });
  recordEpisodePlayback({ repositories: repos, context, episodeId: episode.id, positionSec: 45, occurredAt: "2026-05-07T09:04:00.000Z" });
  const usageEvents = repos.listUsageEvents({ workspaceId: context.workspace.id, userId: context.user.id, limit: 10 });

  if (inbox.items.length !== 1 || inbox.items[0]?.id !== "insight_web_m15" || inbox.items[0]?.episodeTitle !== episode.title) {
    throw new Error(`Expected hydrated inbox item, got ${JSON.stringify(inbox)}.`);
  }
  if (feedback.action !== "saved" || detail?.insights[0]?.feedbackAction !== "saved") {
    throw new Error(`Expected saved feedback in episode detail, got ${JSON.stringify({ feedback, detail })}.`);
  }
  if (detail?.player.audioUrl !== episode.audioUrl || detail.transcript?.segments.length !== 1) {
    throw new Error(`Expected episode player and transcript in detail, got ${JSON.stringify(detail)}.`);
  }
  if (!usageEvents.some((event) => event.eventType === "view" && event.entityType === "inbox")) {
    throw new Error(`Expected inbox view usage event, got ${JSON.stringify(usageEvents)}.`);
  }
  if (!usageEvents.some((event) => event.eventType === "playback" && event.entityId === episode.id && event.metadata["positionSec"] === 45)) {
    throw new Error(`Expected playback usage event, got ${JSON.stringify(usageEvents)}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    userId: context.user.id,
    workspaceId: context.workspace.id,
    watchCount: watchCards.length,
    inboxCount: inbox.items.length,
    feedbackAction: detail.insights[0]?.feedbackAction,
    usageEventCount: usageEvents.length
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
