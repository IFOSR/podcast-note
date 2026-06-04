import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SourceConnector } from "../../../packages/connectors/src/index.ts";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { runM1Once } from "./m1-run-once.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-url-watch-"));
const dbPath = join(dir, "check.sqlite");

try {
  const repos = createRepositories(openPodcastNoteDb(dbPath));
  const user = repos.upsertUser({ id: "user_url_watch", email: "url-watch@example.invalid", name: "URL Watch", timezone: "Asia/Shanghai" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const sourceUrl = "https://www.xiaoyuzhoufm.com/podcast/6830fbe029612ab92d299c9d";
  const watch = repos.createWatchForWorkspace(workspace.id, {
    id: "watch_url_source",
    name: "深思圈",
    type: "topic",
    query: sourceUrl,
    outputLanguage: "zh-CN",
    includeTerms: [],
    excludeTerms: [],
    expandedTerms: ["深思圈", sourceUrl],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 30,
    enabled: true
  });

  const connector: SourceConnector = {
    type: "xiaoyuzhou",
    canHandle: () => true,
    async resolveSource() {
      return {
        type: "xiaoyuzhou",
        url: sourceUrl,
        title: "深思圈"
      };
    },
    async listEpisodes() {
      return [{
        guid: "url-watch-a",
        title: "Notion CEO重新定义了一件事：什么样的人在AI时代真正值钱",
        description: "A new episode from the monitored source.",
        publishedAt: "2026-06-03T08:00:00.000Z",
        durationSec: 1800,
        audioUrl: "https://media.example.invalid/url-watch-a.mp3",
        pageUrl: "https://www.xiaoyuzhoufm.com/episode/url-watch-a",
        language: "zh-CN"
      }];
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
    now: "2026-06-04T08:00:00.000Z",
    connector,
    processingLimit: 1
  });
  const insights = repos.listInsights({ watchId: watch.id, limit: 10 });

  if (result.pollingJobs !== 1 || result.discoveredEpisodes !== 1 || result.queuedEpisodes !== 1 || result.processedJobs !== 1 || result.insights !== 1) {
    throw new Error(`Expected URL source watch to queue and process discovered episode, got ${JSON.stringify(result)}.`);
  }
  if (insights.length !== 1 || insights[0]?.watchId !== watch.id) {
    throw new Error(`Expected one insight for URL source watch, got ${JSON.stringify(insights)}.`);
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
