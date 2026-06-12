import type { TranscriptProvider, TranscriptionInput, TranscriptionOutput } from "./types.ts";

type VolcengineTranscriptProviderOptions = {
  mode?: "standard" | "flash";
  apiKey?: string;
  appId?: string;
  accessToken?: string;
  resourceId?: string;
  submitEndpoint?: string;
  queryEndpoint?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  language?: string;
  enableSpeakerInfo?: boolean;
};

type VolcengineUtterance = {
  text?: string;
  start_time?: number;
  end_time?: number;
  speaker_id?: number | string;
  additions?: Record<string, unknown>;
};

type VolcengineQueryResponse = {
  audio_info?: {
    duration?: number;
  };
  result?: {
    text?: string;
    utterances?: VolcengineUtterance[];
  };
};

const submitSuccessStatus = "20000000";
const processingStatuses = new Set(["20000001", "20000002"]);

export function createVolcengineTranscriptProvider(
  options: VolcengineTranscriptProviderOptions = {}
): TranscriptProvider {
  const apiKey = options.apiKey ?? process.env["VOLCENGINE_ASR_API_KEY"];
  const appId = options.appId ?? process.env["VOLCENGINE_ASR_APP_ID"];
  const accessToken = options.accessToken ?? process.env["VOLCENGINE_ASR_ACCESS_TOKEN"];
  const mode = options.mode ?? normalizeMode(process.env["VOLCENGINE_ASR_MODE"]);
  const resourceId = options.resourceId ?? process.env["VOLCENGINE_ASR_RESOURCE_ID"] ?? (mode === "flash" ? "volc.bigasr.auc_turbo" : "volc.seedasr.auc");
  const submitEndpoint =
    options.submitEndpoint ?? process.env["VOLCENGINE_ASR_SUBMIT_ENDPOINT"] ?? "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit";
  const queryEndpoint =
    options.queryEndpoint ?? process.env["VOLCENGINE_ASR_QUERY_ENDPOINT"] ?? "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query";
  const flashEndpoint = process.env["VOLCENGINE_ASR_FLASH_ENDPOINT"] ?? "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
  const pollIntervalMs = options.pollIntervalMs ?? numberFromEnv("VOLCENGINE_ASR_POLL_INTERVAL_MS", 3000);
  const baseTimeoutMs = options.timeoutMs ?? numberFromEnv("VOLCENGINE_ASR_TIMEOUT_MS", 60 * 60 * 1000);
  const language = options.language ?? process.env["VOLCENGINE_ASR_LANGUAGE"];
  const enableSpeakerInfo = options.enableSpeakerInfo ?? booleanFromEnv("VOLCENGINE_ASR_ENABLE_SPEAKER_INFO", true);

  if (!apiKey && (!appId || !accessToken)) {
    throw new Error("VOLCENGINE_ASR_API_KEY or both VOLCENGINE_ASR_APP_ID and VOLCENGINE_ASR_ACCESS_TOKEN are required to create the Volcengine transcript provider.");
  }

  return {
    name: "volcengine",
    model: resourceId,
    async transcribe(input: TranscriptionInput): Promise<TranscriptionOutput> {
      if (!input.audioUrl) {
        throw new Error("Volcengine transcription requires a public audioUrl. Local file upload is not implemented yet.");
      }

      const format = audioFormatFromUrl(input.audioUrl);
      if (!format) {
        throw new Error("Volcengine transcription requires a direct audio URL ending in .mp3, .m4a, .mp4a, .wav, .ogg, or .raw.");
      }

      const requestId = crypto.randomUUID();
      if (mode === "flash") {
        const result = await recognizeFlash({
          endpoint: flashEndpoint,
          apiKey,
          appId,
          accessToken,
          resourceId,
          requestId,
          audioUrl: input.audioUrl,
          format,
          language,
          enableSpeakerInfo
        });
        return volcengineResponseToTranscriptionOutput(result, language);
      }

      await submitTask({
        endpoint: submitEndpoint,
        apiKey,
        appId,
        accessToken,
        resourceId,
        requestId,
        audioUrl: input.audioUrl,
        format,
        language,
        enableSpeakerInfo
      });

      const result = await pollTask({
        endpoint: queryEndpoint,
        apiKey,
        appId,
        accessToken,
        resourceId,
        requestId,
        pollIntervalMs,
        timeoutMs: volcengineAsrTimeoutMs(input.episode.durationSec, baseTimeoutMs)
      });

      return volcengineResponseToTranscriptionOutput(result, language);
    }
  };
}

export function volcengineAsrTimeoutMs(durationSec?: number, baseTimeoutMs = 60 * 60 * 1000): number {
  const durationMs = Math.max(0, durationSec ?? 0) * 1000;
  if (durationMs <= baseTimeoutMs) return baseTimeoutMs;
  return durationMs + 60 * 60 * 1000;
}

async function recognizeFlash(input: {
  endpoint: string;
  apiKey?: string;
  appId?: string;
  accessToken?: string;
  resourceId: string;
  requestId: string;
  audioUrl: string;
  format: string;
  language?: string;
  enableSpeakerInfo: boolean;
}): Promise<VolcengineQueryResponse> {
  const audio: Record<string, unknown> = {
    format: input.format,
    url: input.audioUrl
  };
  if (input.language) audio["language"] = input.language;

  const response = await fetch(input.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(input),
      "X-Api-Resource-Id": input.resourceId,
      "X-Api-Request-Id": input.requestId,
      "X-Api-Sequence": "-1"
    },
    body: JSON.stringify({
      user: {
        uid: input.apiKey ?? input.appId ?? "podcast-note-worker"
      },
      audio,
      request: {
        model_name: "bigmodel",
        enable_itn: true,
        enable_punc: true,
        enable_speaker_info: input.enableSpeakerInfo,
        show_utterances: true,
        ssd_version: input.enableSpeakerInfo ? "200" : undefined
      }
    })
  });

  const statusCode = response.headers.get("x-api-status-code");
  if (statusCode !== submitSuccessStatus) {
    const message = response.headers.get("x-api-message") ?? await response.text();
    throw new Error(`Volcengine flash recognition failed: status=${statusCode ?? response.status.toString()} message=${message}`);
  }

  return await response.json() as VolcengineQueryResponse;
}

async function submitTask(input: {
  endpoint: string;
  apiKey?: string;
  appId?: string;
  accessToken?: string;
  resourceId: string;
  requestId: string;
  audioUrl: string;
  format: string;
  language?: string;
  enableSpeakerInfo: boolean;
}): Promise<void> {
  const audio: Record<string, unknown> = {
    format: input.format,
    url: input.audioUrl
  };
  if (input.language) audio["language"] = input.language;

  const response = await fetch(input.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(input),
      "X-Api-Resource-Id": input.resourceId,
      "X-Api-Request-Id": input.requestId,
      "X-Api-Sequence": "-1"
    },
    body: JSON.stringify({
      user: {
        uid: "podcast-note-worker"
      },
      audio,
      request: {
        model_name: "bigmodel",
        model_version: "400",
        enable_itn: true,
        enable_punc: true,
        enable_speaker_info: input.enableSpeakerInfo,
        show_utterances: true,
        ssd_version: input.enableSpeakerInfo ? "200" : undefined
      }
    })
  });

  const statusCode = response.headers.get("x-api-status-code");
  if (statusCode !== submitSuccessStatus) {
    const message = response.headers.get("x-api-message") ?? await response.text();
    throw new Error(`Volcengine submit failed: status=${statusCode ?? response.status.toString()} message=${message}`);
  }
}

async function pollTask(input: {
  endpoint: string;
  apiKey?: string;
  appId?: string;
  accessToken?: string;
  resourceId: string;
  requestId: string;
  pollIntervalMs: number;
  timeoutMs: number;
}): Promise<VolcengineQueryResponse> {
  const deadline = Date.now() + input.timeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(input.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(input),
        "X-Api-Resource-Id": input.resourceId,
        "X-Api-Request-Id": input.requestId
      },
      body: "{}"
    });

    const statusCode = response.headers.get("x-api-status-code");
    if (statusCode === submitSuccessStatus) {
      return await response.json() as VolcengineQueryResponse;
    }

    if (statusCode && processingStatuses.has(statusCode)) {
      await sleep(input.pollIntervalMs);
      continue;
    }

    const message = response.headers.get("x-api-message") ?? await response.text();
    throw new Error(`Volcengine query failed: status=${statusCode ?? response.status.toString()} message=${message}`);
  }

  throw new Error(`Volcengine transcription timed out after ${input.timeoutMs}ms.`);
}

export function volcengineAuthHeaders(input: { apiKey?: string; appId?: string; accessToken?: string }): Record<string, string> {
  if (input.appId && input.accessToken) {
    return {
      "X-Api-App-Key": input.appId,
      "X-Api-Access-Key": input.accessToken
    };
  }
  if (input.apiKey) {
    return {
      "X-Api-Key": input.apiKey
    };
  }
  throw new Error("Volcengine ASR requires either VOLCENGINE_ASR_API_KEY or both VOLCENGINE_ASR_APP_ID and VOLCENGINE_ASR_ACCESS_TOKEN.");
}

function authHeaders(input: { apiKey?: string; appId?: string; accessToken?: string }): Record<string, string> {
  return volcengineAuthHeaders(input);
}

function volcengineResponseToTranscriptionOutput(result: VolcengineQueryResponse, language?: string): TranscriptionOutput {
  const utterances = result.result?.utterances ?? [];
  const segments = utterances.length > 0
    ? utterances.map((utterance) => ({
      startSec: msToSec(utterance.start_time),
      endSec: Math.max(msToSec(utterance.end_time), msToSec(utterance.start_time) + 1),
      text: utterance.text?.trim() ?? "",
      speaker: speakerFromUtterance(utterance)
    })).filter((segment) => segment.text.length > 0)
    : [{
      startSec: 0,
      endSec: Math.max(1, msToSec(result.audio_info?.duration)),
      text: result.result?.text?.trim() ?? ""
    }].filter((segment) => segment.text.length > 0);

  if (segments.length === 0) {
    throw new Error("Volcengine transcription completed but returned no transcript text.");
  }

  return {
    language,
    durationSec: msToSec(result.audio_info?.duration),
    segments
  };
}

function normalizeMode(value: string | undefined): "standard" | "flash" {
  return value === "flash" ? "flash" : "standard";
}

export function audioFormatFromUrl(input: string): "mp3" | "m4a" | "mp4a" | "wav" | "ogg" | "raw" | undefined {
  try {
    const pathname = new URL(input).pathname.toLowerCase();
    if (pathname.endsWith(".mp3")) return "mp3";
    if (pathname.endsWith(".m4a")) return "m4a";
    if (pathname.endsWith(".mp4a")) return "mp4a";
    if (pathname.endsWith(".wav")) return "wav";
    if (pathname.endsWith(".ogg")) return "ogg";
    if (pathname.endsWith(".raw")) return "raw";
    return undefined;
  } catch {
    return undefined;
  }
}

function speakerFromUtterance(utterance: VolcengineUtterance): string | undefined {
  const speaker = utterance.speaker_id ?? utterance.additions?.["speaker"];
  return speaker === undefined ? undefined : `speaker_${String(speaker)}`;
}

function msToSec(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round((value / 1000) * 1000) / 1000);
}

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanFromEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;
  return /^(1|true|yes)$/i.test(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
