import { connectorFor, connectors, listenNotesConnector, normalizeAudioUrl, xiaoyuzhouConnector } from "../../../packages/connectors/src/index.ts";

const routes = [
  ["https://example.com/feed.xml", "rss"],
  ["listennotes:podcast-fixture", "listennotes"],
  ["https://podcasts.apple.com/us/podcast/example-show/id123456789", "apple"],
  ["https://open.spotify.com/episode/0abc123", "spotify"],
  ["https://www.youtube.com/watch?v=abc123", "youtube"],
  ["https://youtu.be/abc123", "youtube"],
  ["https://www.xiaoyuzhoufm.com/episode/fixture", "xiaoyuzhou"],
  ["https://example.com/article", "manual"],
  ["AI组织", "listennotes"]
] as const;

for (const [input, expected] of routes) {
  const actual = connectorFor(input).type;
  if (actual !== expected) {
    throw new Error(`Expected ${input} to route to ${expected}, got ${actual}.`);
  }
}

const orderedTypes = connectors.map((connector) => connector.type);
if (orderedTypes.at(-1) !== "manual") throw new Error("Manual connector must remain the final fallback.");
if (orderedTypes.indexOf("manual") < orderedTypes.indexOf("apple")) throw new Error("Platform connectors must precede manual fallback.");
if (orderedTypes.indexOf("listennotes") < 0) throw new Error("Listen Notes connector is not registered.");

const ximalayaWrappedAudio =
  "https://jt.ximalaya.com//GKwRIUEN0khwAeae5gSVnIMT.m4a?channel=rss&jt=https%3A%2F%2Faod.cos.tx.xmcdn.com%2Fstorages%2F0d4a-audiofreehighqps%2FA6%2F61%2FGKwRIUEN0khwAeae5gSVnIMT.m4a";
const ximalayaDirectAudio = normalizeAudioUrl(ximalayaWrappedAudio);
if (ximalayaDirectAudio !== "https://aod.cos.tx.xmcdn.com/storages/0d4a-audiofreehighqps/A6/61/GKwRIUEN0khwAeae5gSVnIMT.m4a") {
  throw new Error(`Expected Ximalaya wrapped audio to normalize to direct media URL, got ${ximalayaDirectAudio}.`);
}

const originalKey = process.env["LISTEN_NOTES_API_KEY"];
delete process.env["LISTEN_NOTES_API_KEY"];
try {
  const source = await listenNotesConnector.resolveSource("listennotes:podcast-fixture");
  if (source.type !== "listennotes") throw new Error("Listen Notes source returned the wrong type.");
  if (source.externalId !== "podcast-fixture") throw new Error("Listen Notes metadata-only source did not preserve id.");
  if (source.metadata?.["mode"] !== "metadata-only") throw new Error("Listen Notes no-key mode should be metadata-only.");

  const episode = await listenNotesConnector.resolveEpisode("listennotes:episode-fixture");
  if (episode.externalId !== "episode-fixture") throw new Error("Listen Notes metadata-only episode did not preserve id.");

  const textTopic = await listenNotesConnector.resolveSource("AI组织");
  if (textTopic.title !== "AI组织") throw new Error("Listen Notes text topic source did not preserve the query as title.");
  const textTopicEpisodes = await listenNotesConnector.listEpisodes(textTopic);
  if (textTopicEpisodes.length !== 0) throw new Error("Listen Notes text topic without an API key should not make network calls.");
} finally {
  if (originalKey) process.env["LISTEN_NOTES_API_KEY"] = originalKey;
}

if (process.env["CHECK_LIVE_CONNECTORS"] === "true") {
  const source = await xiaoyuzhouConnector.resolveSource("https://www.xiaoyuzhoufm.com/podcast/6830fbe029612ab92d299c9d");
  const episodes = await xiaoyuzhouConnector.listEpisodes(source, { limit: 3 });
  if (episodes.length !== 3) throw new Error(`Expected Xiaoyuzhou podcast page to list 3 episodes, got ${episodes.length}.`);
  if (episodes.some((episode) => episode.pageUrl.includes("/podcast/"))) {
    throw new Error(`Xiaoyuzhou podcast page must list episode URLs, got ${JSON.stringify(episodes.map((episode) => episode.pageUrl))}.`);
  }
  if (episodes.some((episode) => !episode.audioUrl?.endsWith(".m4a"))) {
    throw new Error(`Xiaoyuzhou podcast episodes must expose direct .m4a audio URLs, got ${JSON.stringify(episodes.map((episode) => episode.audioUrl))}.`);
  }
}

console.log("Connector registry check passed.");
