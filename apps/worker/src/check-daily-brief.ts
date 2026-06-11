import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mockInsightProvider, mockTranscriptProvider } from "../../../packages/ai/src/mock-provider.ts";
import { stableId } from "../../../packages/core/src/format.ts";
import type { Episode } from "../../../packages/core/src/types.ts";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { runEpisodeProcessingQueue } from "./episode-processing-queue.ts";
import { generateAndSendDailyBrief, type EmailAdapter } from "./daily-brief.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-daily-brief-"));
const dbPath = join(dir, "check.sqlite");
const sent: Array<{ to: string; subject: string; html: string; text: string }> = [];
const adapter: EmailAdapter = {
  async send(message) {
    sent.push(message);
    return { providerMessageId: `msg_${sent.length}` };
  }
};

try {
  const db = openPodcastNoteDb(dbPath);
  const repos = createRepositories(db);
  const user = repos.upsertUser({ id: "user_brief", email: "brief@example.com", name: "Brief User", timezone: "Asia/Shanghai" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const watch = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_brief_ai",
    name: "Daily AI Agent Brief",
    type: "topic",
    query: "AI agent workflow",
    outputLanguage: "zh-CN",
    includeTerms: ["AI", "agent", "workflow"],
    excludeTerms: [],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 30
  });
  repos.upsertSource({ id: "src_brief", type: "rss", url: "https://example.invalid/feed.xml", title: "Brief Feed" });
  const episode: Episode = {
    id: stableId("ep", "daily-brief-episode"),
    sourceId: "src_brief",
    title: "AI agent workflow daily brief episode",
    description: "AI agent workflow automation and podcast notes.",
    publishedAt: "2026-05-07T01:30:00.000Z",
    durationSec: 180,
    audioUrl: "https://example.invalid/brief.mp3",
    pageUrl: "https://example.invalid/brief",
    language: "en"
  };
  repos.upsertEpisode(episode);
  repos.enqueueEpisodeProcessingJob({
    workspaceId: workspace.id,
    watchId: watch.id,
    episodeId: episode.id,
    sourceUrl: episode.pageUrl,
    queuedAt: "2026-05-07T02:00:00.000Z",
    relevanceScore: 0.92,
    relevanceReason: { matchedTerms: ["AI", "agent", "workflow"] }
  });
  await runEpisodeProcessingQueue({ repositories: repos, transcriptProvider: mockTranscriptProvider, insightProvider: mockInsightProvider, limit: 5 });

  const first = await generateAndSendDailyBrief({
    repositories: repos,
    workspaceId: workspace.id,
    userId: user.id,
    date: "2026-05-07",
    timezone: "Asia/Shanghai",
    emailAdapter: adapter
  });
  const second = await generateAndSendDailyBrief({
    repositories: repos,
    workspaceId: workspace.id,
    userId: user.id,
    date: "2026-05-07",
    timezone: "Asia/Shanghai",
    emailAdapter: adapter
  });

  const briefs = repos.listDailyBriefs({ workspaceId: workspace.id, limit: 10 });
  if (first.status !== "sent" || first.insightCount < 1 || sent.length !== 1) {
    throw new Error(`Expected first daily brief to send one email with insights, got ${JSON.stringify({ first, sentCount: sent.length })}.`);
  }
  if (second.status !== "skipped" || second.reason !== "already_sent" || sent.length !== 1) {
    throw new Error(`Expected second daily brief to be deduped, got ${JSON.stringify({ second, sentCount: sent.length })}.`);
  }
  if (briefs.length !== 1 || briefs[0]?.status !== "sent" || !briefs[0]?.providerMessageId) {
    throw new Error(`Expected one sent brief record with provider message id, got ${JSON.stringify(briefs)}.`);
  }
  if (!sent[0]?.subject.includes("2026-05-07") || !sent[0]?.text.includes("AI agent") || !sent[0]?.html.includes(episode.pageUrl)) {
    throw new Error("Expected email subject/body to include date, insight content, and episode link.");
  }

  console.log(JSON.stringify({
    ok: true,
    status: first.status,
    insightCount: first.insightCount,
    sentCount: sent.length,
    providerMessageId: briefs[0]?.providerMessageId,
    dedupeStatus: second.status
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
