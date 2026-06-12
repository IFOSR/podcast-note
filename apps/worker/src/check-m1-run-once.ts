import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mockInsightProvider, mockTranscriptProvider } from "../../../packages/ai/src/mock-provider.ts";
import type { SourceConnector } from "../../../packages/connectors/src/index.ts";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { runM1Once } from "./m1-run-once.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-m1-run-once-"));
const dbPath = join(dir, "check.sqlite");

try {
  const db = openPodcastNoteDb(dbPath);
  const repos = createRepositories(db);
  const user = repos.upsertUser({ id: "user_m1_run_once", email: "run@example.invalid", name: "Run Once", timezone: "Asia/Shanghai" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const watch = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_m1_run_once",
    name: "AI Agent Run Once",
    type: "topic",
    query: "AI agent workflow",
    outputLanguage: "zh-CN",
    includeTerms: ["AI agent", "workflow"],
    excludeTerms: ["sports"],
    minRelevanceScore: 0.5,
    frequency: "daily",
    backfillDays: 7,
    enabled: true
  });

  const connector: SourceConnector = {
    kind: "rss",
    canHandle: () => true,
    async resolveSource() {
      return {
        type: "rss",
        url: "https://example.invalid/m1.xml",
        title: "M1 Run Once Feed"
      };
    },
    async listEpisodes() {
      return [
        {
          guid: "m1-run-once-a",
          title: "AI agent workflow for operators",
          description: "A practical AI agent workflow episode for product teams.",
          publishedAt: "2026-05-07T07:00:00.000Z",
          durationSec: 240,
          audioUrl: "https://example.invalid/m1-a.mp3",
          pageUrl: "https://example.invalid/m1-a",
          language: "en"
        },
        {
          guid: "m1-run-once-b",
          title: "Sports transfer news",
          description: "This should be excluded by relevance filtering.",
          publishedAt: "2026-05-07T07:30:00.000Z",
          durationSec: 180,
          audioUrl: "https://example.invalid/m1-b.mp3",
          pageUrl: "https://example.invalid/m1-b",
          language: "en"
        }
      ];
    },
    async resolveEpisode(url: string) {
      return {
        title: "Resolved",
        pageUrl: url,
        audioUrl: url
      };
    }
  };

  const result = await runM1Once({
    repositories: repos,
    workspaceId: workspace.id,
    now: "2026-05-07T08:00:00.000Z",
    connector,
    transcriptProvider: mockTranscriptProvider,
    insightProvider: mockInsightProvider,
    processingLimit: 5
  });
  const inbox = repos.listInboxItems({ workspaceId: workspace.id, limit: 10 });
  const jobs = repos.listQueuedEpisodeProcessingJobs({ workspaceId: workspace.id, limit: 10 });

  if (result.pollingJobs !== 1 || result.discoveredEpisodes !== 2 || result.queuedEpisodes !== 1 || result.processedJobs !== 1 || result.insights !== 1) {
    throw new Error(`Expected one relevant processed insight, got ${JSON.stringify(result)}.`);
  }
  if (inbox.length !== 1 || inbox[0]?.watchId !== watch.id || !inbox[0]?.claim.includes("AI agent workflow")) {
    throw new Error(`Expected one inbox insight for the watch, got ${JSON.stringify(inbox)}.`);
  }
  if (jobs.some((job) => job.status !== "completed")) {
    throw new Error(`Expected all queued processing jobs completed, got ${JSON.stringify(jobs)}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    workspaceId: workspace.id,
    watchId: watch.id,
    pollingJobs: result.pollingJobs,
    discoveredEpisodes: result.discoveredEpisodes,
    queuedEpisodes: result.queuedEpisodes,
    processedJobs: result.processedJobs,
    insightCount: inbox.length
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
