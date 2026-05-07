import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { audioCacheKey, createLocalObjectStorage, putAudioCache, putTranscriptJson, transcriptObjectKey } from "../../../packages/storage/src/index.ts";

const root = await mkdtemp(join(tmpdir(), "podcast-note-storage-"));
const storage = createLocalObjectStorage(root);

const transcript = {
  language: "en",
  durationSec: 4,
  segments: [{ startSec: 0, endSec: 4, text: "Object storage smoke transcript." }]
};

const transcriptObject = await putTranscriptJson(storage, {
  episodeId: "ep/storage smoke",
  provider: "mock provider",
  model: "mock/model",
  transcript
});
const expectedTranscriptKey = transcriptObjectKey("ep/storage smoke", "mock provider", "mock/model");
if (transcriptObject.key !== expectedTranscriptKey) {
  throw new Error(`Unexpected transcript key ${transcriptObject.key}`);
}
if (!(await storage.exists(transcriptObject.key))) {
  throw new Error("Transcript object was not stored.");
}
const loadedTranscript = JSON.parse(await storage.getObjectText(transcriptObject.key));
if (loadedTranscript.segments?.[0]?.text !== transcript.segments[0]!.text) {
  throw new Error("Stored transcript JSON did not round-trip.");
}

const audioBytes = new TextEncoder().encode("fake audio bytes");
const audioObject = await putAudioCache(storage, {
  episodeId: "ep/storage smoke",
  audioUrl: "https://example.invalid/audio.mp3",
  body: audioBytes,
  contentType: "audio/mpeg"
});
if (!audioObject.key.startsWith("audio-cache/ep-storage-smoke/")) {
  throw new Error(`Unexpected audio cache key ${audioObject.key}`);
}
if (!(await storage.exists(audioObject.key))) {
  throw new Error("Audio cache object was not stored.");
}
const expectedAudioKey = audioCacheKey("ep/storage smoke", audioObject.checksum!, "mp3");
if (audioObject.key !== expectedAudioKey) {
  throw new Error(`Audio key ${audioObject.key} did not include checksum ${audioObject.checksum}`);
}

const duplicateAudioObject = await putAudioCache(storage, {
  episodeId: "ep/storage smoke",
  audioUrl: "https://example.invalid/audio.mp3",
  body: audioBytes,
  contentType: "audio/mpeg"
});
if (duplicateAudioObject.key !== audioObject.key) {
  throw new Error("Audio cache did not reuse the checksum-derived object key.");
}

console.log("Object storage adapter check passed.");
