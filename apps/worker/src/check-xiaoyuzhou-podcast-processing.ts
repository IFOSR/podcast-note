import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockInsightProvider, mockTranscriptProvider } from "../../../packages/ai/src/mock-provider.ts";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { processSourceInputs } from "./process-sources.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-xiaoyuzhou-"));
const dbPath = join(dir, "xiaoyuzhou.sqlite");
const podcastUrl = "https://www.xiaoyuzhoufm.com/podcast/6830fbe029612ab92d299c9d";

try {
  const repos = createRepositories(openPodcastNoteDb(dbPath));
  const user = repos.upsertUser({ id: "user_xiaoyuzhou", email: "xiaoyuzhou@example.invalid", name: "Xiaoyuzhou", timezone: "Asia/Shanghai" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);

  const results = await processSourceInputs({
    options: {
      watch: {
        workspaceId: workspace.id,
        name: "深思圈",
        topic: "小宇宙 / 深思圈 / AI",
        language: "zh-CN",
        mustInclude: ["AI"]
      },
      sources: { sources: [podcastUrl] },
      outputDir: join(dir, "outputs"),
      maxEpisodesPerSource: 3
    },
    transcriptProvider: mockTranscriptProvider,
    insightProvider: mockInsightProvider,
    repositories: repos
  });

  if (results.length !== 3) {
    throw new Error(`Expected Xiaoyuzhou podcast page to process 3 recent episodes, got ${results.length}.`);
  }
  if (results.some((result) => result.episodeTitle === "深思圈")) {
    throw new Error(`Podcast page was incorrectly processed as the channel itself: ${JSON.stringify(results)}.`);
  }
  const rows = openPodcastNoteDb(dbPath).query("select title, page_url, audio_url from episodes order by updated_at desc limit 3").all() as Array<Record<string, unknown>>;
  if (rows.some((row) => String(row["page_url"]).includes("/podcast/"))) {
    throw new Error(`Expected episode URLs, got ${JSON.stringify(rows)}.`);
  }
  if (rows.some((row) => !String(row["audio_url"]).endsWith(".m4a"))) {
    throw new Error(`Expected direct .m4a audio URLs, got ${JSON.stringify(rows)}.`);
  }

  console.log(JSON.stringify({ ok: true, dbPath, episodeTitles: results.map((result) => result.episodeTitle) }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
