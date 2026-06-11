import { createCodexInsightProvider, createVolcengineTranscriptProvider } from "../../../packages/ai/src/index.ts";
import { mockInsightProvider, mockTranscriptProvider } from "../../../packages/ai/src/mock-provider.ts";
import { connectorFor, parseRss } from "../../../packages/connectors/src/index.ts";
import { episodeDedupeKey } from "../../../packages/core/src/dedupe.ts";
import { formatTimestamp } from "../../../packages/core/src/format.ts";
import { checkGroundedness } from "../../../packages/core/src/groundedness.ts";
import { scoreEpisodeMetadata } from "../../../packages/core/src/scoring.ts";
import { buildSemanticSegments } from "../../../packages/core/src/segmenting.ts";
import { createLocalObjectStorage } from "../../../packages/storage/src/index.ts";
import { demoWatch } from "./pipeline.ts";
import { userWatchToSystemWatch } from "./process-sources.ts";

const rss = `<?xml version="1.0"?>
<rss>
  <channel>
    <title>Fixture Feed</title>
    <link>https://example.com</link>
    <item>
      <title>AI agent workflow commercialization</title>
      <guid>episode-1</guid>
      <link>https://example.com/e1</link>
      <description>AI agent workflow and MCP discussion.</description>
      <enclosure url="https://example.com/e1.mp3" type="audio/mpeg" />
      <pubDate>Sat, 25 Apr 2026 00:00:00 GMT</pubDate>
      <itunes:duration>10:00</itunes:duration>
    </item>
  </channel>
</rss>`;

const parsed = parseRss(rss);
const episode = parsed.episodes[0];
if (!episode) throw new Error("RSS parser failed to produce an episode.");

const watch = demoWatch();
const workspaceScopedWatch = userWatchToSystemWatch({
  workspaceId: "workspace_preview_check",
  name: "Preview Check",
  topic: "AI workflow"
});
if (workspaceScopedWatch.workspaceId !== "workspace_preview_check") {
  throw new Error(`Process sources should preserve an explicit workspace id, got ${workspaceScopedWatch.workspaceId}.`);
}
const score = scoreEpisodeMetadata(watch, {
  id: "episode_fixture",
  title: episode.title,
  description: episode.description,
  pageUrl: episode.pageUrl,
  audioUrl: episode.audioUrl
});
if (score.decision === "skip") throw new Error("Metadata scorer unexpectedly skipped fixture episode.");

const segments = buildSemanticSegments([
  {
    startSec: 0,
    endSec: 60,
    text: "AI agent workflow commercialization needs evidence and rollback points."
  }
]);

const groundedness = checkGroundedness(
  {
    id: "ins_fixture",
    workspaceId: watch.workspaceId,
    watchId: watch.id,
    episodeId: "episode_fixture",
    claim: "AI agent workflow commercialization needs evidence.",
    evidenceExcerpt: "AI agent workflow commercialization needs evidence and rollback points.",
    timestampStartSec: 0,
    timestampEndSec: 60,
    entities: [],
    relevanceScore: 0.9,
    confidence: 0.8,
    outputLanguage: "zh-CN",
    status: "draft",
    promptVersion: "check",
    model: "check"
  },
  segments
);

if (!groundedness.supportsClaim) throw new Error("Groundedness check failed fixture insight.");
if (!connectorFor("https://example.com/feed.xml")) throw new Error("Connector registry failed.");
if (!episodeDedupeKey({ ...episode, title: episode.title })) throw new Error("Dedupe key failed.");
if (!formatTimestamp(90).includes("1:30")) throw new Error("Timestamp formatting failed.");
if (!mockInsightProvider.name || !mockTranscriptProvider.name) throw new Error("AI providers failed to import.");
if (typeof createCodexInsightProvider !== "function") throw new Error("Codex insight provider failed to import.");
if (typeof createVolcengineTranscriptProvider !== "function") throw new Error("Volcengine transcript provider failed to import.");
if (typeof createLocalObjectStorage !== "function") throw new Error("Object storage exports failed to import.");

console.log("Import check passed.");
