import { audioFormatFromUrl, volcengineAuthHeaders } from "../../../packages/ai/src/volcengine-transcript-provider.ts";

const cases = [
  ["https://example.com/audio.mp3", "mp3"],
  ["https://example.com/audio.m4a?token=fixture", "m4a"],
  ["https://media.xyzcdn.net/podcast/episode.mp4a", "mp4a"],
  ["https://example.com/audio.wav", "wav"],
  ["https://example.com/audio.ogg", "ogg"],
  ["https://example.com/audio.raw", "raw"]
] as const;

for (const [url, expected] of cases) {
  const actual = audioFormatFromUrl(url);
  if (actual !== expected) {
    throw new Error(`Expected ${url} to resolve as ${expected}, got ${actual}.`);
  }
}

if (audioFormatFromUrl("https://www.xiaoyuzhoufm.com/episode/fixture") !== undefined) {
  throw new Error("Platform pages should not be treated as direct audio URLs.");
}

const preferredHeaders = volcengineAuthHeaders({
  apiKey: "invalid-api-key",
  appId: "valid-app-id",
  accessToken: "valid-access-token"
});
if (preferredHeaders["X-Api-Key"]) {
  throw new Error("App ID + access token should take precedence over VOLCENGINE_ASR_API_KEY when both are configured.");
}
if (preferredHeaders["X-Api-App-Key"] !== "valid-app-id" || preferredHeaders["X-Api-Access-Key"] !== "valid-access-token") {
  throw new Error(`Unexpected Volcengine app auth headers: ${JSON.stringify(preferredHeaders)}`);
}

const apiKeyHeaders = volcengineAuthHeaders({ apiKey: "valid-api-key" });
if (apiKeyHeaders["X-Api-Key"] !== "valid-api-key") {
  throw new Error(`Expected API key fallback headers, got ${JSON.stringify(apiKeyHeaders)}`);
}

console.log("Audio format check passed.");
