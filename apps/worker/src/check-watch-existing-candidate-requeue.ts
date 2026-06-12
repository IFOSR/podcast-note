import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mockInsightProvider, mockTranscriptProvider } from "../../../packages/ai/src/mock-provider.ts";
import type { SourceConnector } from "../../../packages/connectors/src/index.ts";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { runM1Once } from "./m1-run-once.ts";
import { runPollingJob } from "./rss-polling.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-existing-candidate-"));
const dbPath = join(dir, "check.sqlite");

try {
  const repos = createRepositories(openPodcastNoteDb(dbPath));
  const user = repos.upsertUser({ id: "user_existing_candidate", email: "existing-candidate@example.invalid", name: "Existing Candidate" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const sourceUrl = "https://www.xiaoyuzhoufm.com/podcast/existing-candidate";
  const watch = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_existing_candidate",
    name: "硅谷101",
    type: "topic",
    query: sourceUrl,
    outputLanguage: "zh-CN",
    includeTerms: [],
    excludeTerms: [],
    expandedTerms: ["硅谷101", sourceUrl],
    minRelevanceScore: 0.65,
    frequency: "realtime",
    backfillDays: 30,
    enabled: true
  });

  const connector: SourceConnector = {
    type: "xiaoyuzhou",
    canHandle: () => true,
    async resolveSource() {
      return { type: "xiaoyuzhou", url: sourceUrl, title: "硅谷101" };
    },
    async listEpisodes() {
      return [{
        guid: "sg101-238",
        title: "E238｜聊聊Harness时代AI-First的组织架构",
        description: "A new episode from the monitored podcast channel.",
        publishedAt: "2026-05-25T00:00:00.000Z",
        durationSec: 2400,
        audioUrl: "https://media.example.invalid/sg101-238.mp3",
        pageUrl: "https://www.xiaoyuzhoufm.com/episode/sg101-238",
        language: "zh-CN"
      }];
    },
    async resolveEpisode(url: string) {
      return { title: "Resolved", pageUrl: url, audioUrl: url };
    }
  };

  const firstJob = repos.planPollingJobs({ workspaceId: workspace.id, now: "2026-06-10T00:00:00.000Z" })[0];
  if (!firstJob) throw new Error("Expected initial polling job.");
  const firstPoll = await runPollingJob({ job: firstJob, repositories: repos, connector });
  if (firstPoll.queuedCount !== 1 || firstPoll.episodeIds.length !== 1) {
    throw new Error(`Expected first poll to discover one episode, got ${JSON.stringify(firstPoll)}.`);
  }
  if (repos.listQueuedEpisodeProcessingJobs({ workspaceId: workspace.id, limit: 10 }).length !== 0) {
    throw new Error("Polling alone should not enqueue processing jobs.");
  }

  const result = await runM1Once({
    repositories: repos,
    workspaceId: workspace.id,
    now: "2026-06-10T01:01:00.000Z",
    connector,
    transcriptProvider: mockTranscriptProvider,
    insightProvider: mockInsightProvider,
    processingLimit: 1
  });
  const jobs = repos.listQueuedEpisodeProcessingJobs({ workspaceId: workspace.id, limit: 10 });
  const insights = repos.listInsights({ watchId: watch.id, limit: 10 });

  if (result.queuedEpisodes !== 1 || result.processedJobs !== 1 || insights.length < 1) {
    throw new Error(`Expected existing but unprocessed poll candidate to be queued and processed, got result=${JSON.stringify(result)} jobs=${JSON.stringify(jobs)} insights=${JSON.stringify(insights)}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    watchId: watch.id,
    queuedEpisodes: result.queuedEpisodes,
    processedJobs: result.processedJobs,
    insightCount: insights.length
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
