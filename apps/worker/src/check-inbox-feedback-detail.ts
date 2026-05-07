import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Episode, Watch } from "../../../packages/core/src/types.ts";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-inbox-"));
const dbPath = join(dir, "check.sqlite");

try {
  const db = openPodcastNoteDb(dbPath);
  const repos = createRepositories(db);
  const user = repos.upsertUser({ id: "user_inbox", email: "inbox@example.com", name: "Inbox User" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const watch: Watch = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_inbox_ai",
    name: "Inbox AI Watch",
    type: "topic",
    query: "AI agent workflow",
    outputLanguage: "zh-CN",
    includeTerms: ["AI", "agent"],
    excludeTerms: [],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 30
  });
  repos.upsertSource({ id: "src_inbox", type: "rss", url: "https://example.invalid/inbox.xml", title: "Inbox Feed" });
  const episode: Episode = {
    id: "episode_inbox_detail",
    sourceId: "src_inbox",
    title: "Inbox detail episode about AI agent workflow",
    description: "Episode detail should include summary, transcript and insight feedback state.",
    publishedAt: "2026-05-07T03:00:00.000Z",
    durationSec: 120,
    audioUrl: "https://example.invalid/inbox.mp3",
    pageUrl: "https://example.invalid/inbox",
    language: "en"
  };
  repos.upsertEpisode(episode);
  repos.saveTranscript({
    episodeId: episode.id,
    provider: "inbox-smoke",
    model: "inbox-transcript",
    transcript: {
      language: "en",
      durationSec: 120,
      segments: [
        { startSec: 0, endSec: 60, text: "AI agent workflow evidence appears here." },
        { startSec: 60, endSec: 120, text: "More details for the embedded player." }
      ]
    }
  });
  repos.saveProcessingResult({
    episode,
    summary: {
      oneLiner: "AI agent workflow inbox summary.",
      overview: "A deterministic summary for inbox and detail queries.",
      chapters: [{ title: "Workflow", startSec: 0, endSec: 60, summary: "AI agent workflow." }],
      worthListening: { recommendation: "listen_segments", reason: "Relevant to workflow.", bestSegments: [{ startSec: 0, endSec: 60, reason: "Core evidence." }] },
      entities: [{ name: "AI agent", type: "technology", mentions: 2 }]
    },
    segments: [],
    insights: [{
      id: "insight_inbox_primary",
      workspaceId: workspace.id,
      watchId: watch.id,
      episodeId: episode.id,
      segmentIndex: 0,
      claim: "AI agent workflow can be reviewed from the inbox.",
      evidenceExcerpt: "AI agent workflow evidence appears here.",
      reasoning: "Matches the watch query.",
      implication: "The user can triage this item without opening raw data.",
      timestampStartSec: 0,
      timestampEndSec: 60,
      entities: [{ name: "AI agent", type: "technology" }],
      relevanceScore: 0.94,
      confidence: 0.91,
      groundednessScore: 0.9,
      outputLanguage: "zh-CN",
      status: "published",
      promptVersion: "watch-insight-v1",
      model: "inbox-smoke"
    }]
  }, watch, "inbox-smoke");

  const initialInbox = repos.listInboxItems({ workspaceId: workspace.id, limit: 10 });
  const feedback = repos.recordInsightFeedback({
    workspaceId: workspace.id,
    userId: user.id,
    insightId: "insight_inbox_primary",
    action: "saved",
    note: "Keep for daily review",
    createdAt: "2026-05-07T04:00:00.000Z"
  });
  const savedInbox = repos.listInboxItems({ workspaceId: workspace.id, feedbackAction: "saved", limit: 10 });
  const detail = repos.getEpisodeDetailForWorkspace({ workspaceId: workspace.id, episodeId: episode.id, userId: user.id });

  if (initialInbox.length !== 1 || initialInbox[0]?.episodeId !== episode.id || initialInbox[0]?.feedbackAction !== undefined) {
    throw new Error(`Expected one initial unread inbox item, got ${JSON.stringify(initialInbox)}.`);
  }
  if (feedback.action !== "saved" || savedInbox.length !== 1 || savedInbox[0]?.feedbackAction !== "saved") {
    throw new Error(`Expected saved feedback to appear in inbox filters, got ${JSON.stringify({ feedback, savedInbox })}.`);
  }
  if (!detail || detail.episode.id !== episode.id || detail.insights.length !== 1 || detail.summary?.oneLiner !== "AI agent workflow inbox summary.") {
    throw new Error(`Expected episode detail with summary and insight, got ${JSON.stringify(detail)}.`);
  }
  if (detail.transcript?.segments.length !== 2 || detail.player.audioUrl !== episode.audioUrl || detail.insights[0]?.feedbackAction !== "saved") {
    throw new Error(`Expected detail transcript/player/feedback state, got ${JSON.stringify(detail)}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    inboxCount: initialInbox.length,
    savedInboxCount: savedInbox.length,
    feedbackAction: detail.insights[0]?.feedbackAction,
    transcriptSegments: detail.transcript?.segments.length,
    playerAudioUrl: detail.player.audioUrl
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
