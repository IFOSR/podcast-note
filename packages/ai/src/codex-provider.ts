import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { stableId } from "../../core/src/format.ts";
import type { EpisodeSummary, Insight, OutputLanguage, SemanticSegment } from "../../core/src/types.ts";
import type { EpisodeSummaryInput, InsightProvider, WatchInsightInput } from "./types.ts";
import { promptVersions } from "./types.ts";

type CodexInsightProviderOptions = {
  command?: string;
  model?: string;
  cwd?: string;
  timeoutMs?: number;
};

type SummaryResponse = EpisodeSummary;

type InsightResponse = {
  insights: Array<{
    segmentIndex: number;
    claim: string;
    evidenceExcerpt: string;
    reasoning: string;
    implication: string;
    timestampStartSec: number;
    timestampEndSec: number;
    entities: Array<{ name: string; type: string }>;
    relevanceScore: number;
    confidence: number;
  }>;
};

export function createCodexInsightProvider(options: CodexInsightProviderOptions = {}): InsightProvider {
  const command = options.command ?? process.env["CODEX_COMMAND"] ?? "codex";
  const model = options.model ?? process.env["CODEX_INSIGHT_MODEL"] ?? "gpt-5.5";
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? numberFromEnv("CODEX_INSIGHT_TIMEOUT_MS", 10 * 60 * 1000);

  return {
    name: "codex",
    model,
    async summarizeEpisode(input: EpisodeSummaryInput): Promise<EpisodeSummary> {
      const output = await runCodexJson<SummaryResponse>({
        command,
        model,
        cwd,
        timeoutMs,
        schema: episodeSummarySchema,
        prompt: [
          summarySystemPrompt(input.outputLanguage),
          "",
          "Summarize this podcast episode from transcript segments. Return only JSON that matches the schema.",
          "",
          `Episode: ${JSON.stringify(input.episode)}`,
          "",
          `Segments: ${JSON.stringify(segmentPayload(input.segments))}`
        ].join("\n")
      });

      return normalizeSummary(output, input.segments);
    },
    async extractWatchInsights(input: WatchInsightInput): Promise<Insight[]> {
      const output = await runCodexJson<InsightResponse>({
        command,
        model,
        cwd,
        timeoutMs,
        schema: watchInsightsSchema,
        prompt: [
          insightSystemPrompt(input.outputLanguage),
          "",
          "Extract only watch-specific insights. Return only JSON that matches the schema.",
          "",
          `Episode: ${JSON.stringify(input.episode)}`,
          "",
          `Watch: ${JSON.stringify(input.watch)}`,
          "",
          `Segments: ${JSON.stringify(segmentPayload(input.segments))}`
        ].join("\n")
      });

      return normalizeInsights(output, input, model);
    }
  };
}

async function runCodexJson<T>(input: {
  command: string;
  model: string;
  cwd: string;
  timeoutMs: number;
  schema: Record<string, unknown>;
  prompt: string;
}): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "podcast-note-codex-"));
  const schemaPath = join(dir, "schema.json");
  const outputPath = join(dir, "output.json");

  try {
    await writeFile(schemaPath, JSON.stringify(input.schema, null, 2));
    await runCommand({
      command: input.command,
      args: [
        "exec",
        "--sandbox",
        "read-only",
        "--model",
        input.model,
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        "--cd",
        input.cwd,
        "-"
      ],
      stdin: input.prompt,
      timeoutMs: input.timeoutMs
    });

    const raw = await readFile(outputPath, "utf8");
    return JSON.parse(raw) as T;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runCommand(input: {
  command: string;
  args: string[];
  stdin: string;
  timeoutMs: number;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Codex insight generation timed out after ${input.timeoutMs}ms.`));
    }, input.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`codex exec failed with code ${code ?? "unknown"}: ${stderr || stdout}`.trim()));
    });

    child.stdin.end(input.stdin);
  });
}

function normalizeSummary(response: SummaryResponse, segments: SemanticSegment[]): EpisodeSummary {
  if (typeof response.oneLiner !== "string") throw new Error("summary.oneLiner must be a string.");
  if (typeof response.overview !== "string") throw new Error("summary.overview must be a string.");
  if (!Array.isArray(response.chapters)) throw new Error("summary.chapters must be an array.");
  if (!Array.isArray(response.entities)) throw new Error("summary.entities must be an array.");
  if (typeof response.worthListening !== "object" || response.worthListening === null) {
    throw new Error("summary.worthListening must be an object.");
  }

  return {
    oneLiner: response.oneLiner.trim(),
    overview: response.overview.trim(),
    chapters: response.chapters.map((chapter, index) => ({
      title: stringOrFallback(chapter.title, `Segment ${index + 1}`),
      startSec: clampToEpisode(chapter.startSec, segments),
      endSec: clampToEpisode(chapter.endSec, segments),
      summary: stringOrFallback(chapter.summary, "")
    })),
    worthListening: {
      recommendation: normalizeRecommendation(response.worthListening.recommendation),
      reason: stringOrFallback(response.worthListening.reason, ""),
      bestSegments: response.worthListening.bestSegments.map((segment) => ({
        startSec: clampToEpisode(segment.startSec, segments),
        endSec: clampToEpisode(segment.endSec, segments),
        reason: stringOrFallback(segment.reason, "")
      }))
    },
    entities: response.entities.map((entity) => ({
      name: stringOrFallback(entity.name, "unknown"),
      type: stringOrFallback(entity.type, "unknown"),
      mentions: Number.isFinite(entity.mentions) ? Math.max(0, Math.floor(entity.mentions)) : 0
    }))
  };
}

function normalizeInsights(response: InsightResponse, input: WatchInsightInput, model: string): Insight[] {
  if (!Array.isArray(response.insights)) throw new Error("insights must be an array.");

  return response.insights.slice(0, 8).map((rawInsight) => {
    const segment = input.segments[rawInsight.segmentIndex] ?? nearestSegment(input.segments, rawInsight.timestampStartSec);
    const startSec = clamp(rawInsight.timestampStartSec, segment.startSec, segment.endSec);
    const endSec = clamp(Math.max(rawInsight.timestampEndSec, startSec + 1), segment.startSec, segment.endSec);
    const claim = stringOrFallback(rawInsight.claim, "").trim();
    const evidenceExcerpt = stringOrFallback(rawInsight.evidenceExcerpt, "").trim();

    if (!claim || !evidenceExcerpt) {
      throw new Error("Codex insight response must include non-empty claim and evidenceExcerpt.");
    }

    return {
      id: stableId("ins", `${input.watch.id}:${input.episode.id}:${segment.index}:${claim}:${evidenceExcerpt}`),
      workspaceId: input.workspaceId,
      watchId: input.watch.id,
      episodeId: input.episode.id,
      segmentIndex: segment.index,
      claim,
      evidenceExcerpt,
      reasoning: stringOrFallback(rawInsight.reasoning, ""),
      implication: stringOrFallback(rawInsight.implication, ""),
      timestampStartSec: startSec,
      timestampEndSec: endSec,
      entities: rawInsight.entities.map((entity) => ({
        name: stringOrFallback(entity.name, "unknown"),
        type: stringOrFallback(entity.type, "unknown")
      })),
      relevanceScore: clampScore(rawInsight.relevanceScore),
      confidence: clampScore(rawInsight.confidence),
      outputLanguage: input.outputLanguage,
      status: "draft",
      promptVersion: promptVersions.watchInsight,
      model
    };
  });
}

function segmentPayload(segments: SemanticSegment[]): Array<{
  index: number;
  startSec: number;
  endSec: number;
  text: string;
}> {
  return segments.map((segment) => ({
    index: segment.index,
    startSec: segment.startSec,
    endSec: segment.endSec,
    text: segment.text
  }));
}

function summarySystemPrompt(outputLanguage: OutputLanguage): string {
  return [
    "You are a podcast intelligence analyst.",
    "Use only the supplied transcript segments.",
    "Do not invent facts, speakers, companies, citations, or timestamps.",
    `Output language: ${outputLanguage}.`
  ].join(" ");
}

function insightSystemPrompt(outputLanguage: OutputLanguage): string {
  return [
    "You are a podcast intelligence analyst.",
    "Extract watch-specific insights, not generic summary bullets.",
    "Every claim must be directly supported by evidenceExcerpt from one transcript segment.",
    "Use relevanceScore for Watch fit and confidence for claim support.",
    "Do not invent facts, entities, evidence, or timestamps.",
    `Output language: ${outputLanguage}.`
  ].join(" ");
}

function nearestSegment(segments: SemanticSegment[], timestampSec: number): SemanticSegment {
  const found = segments.find((segment) => timestampSec >= segment.startSec && timestampSec <= segment.endSec);
  if (found) return found;
  const first = segments[0];
  if (!first) throw new Error("Cannot normalize insights without transcript segments.");
  return first;
}

function clampToEpisode(value: number, segments: SemanticSegment[]): number {
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first || !last) return Math.max(0, Math.floor(value));
  return clamp(value, first.startSec, last.endSec);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.floor(Math.min(max, Math.max(min, value)));
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

function normalizeRecommendation(value: string): "listen_full" | "listen_segments" | "skip" {
  if (value === "listen_full" || value === "listen_segments" || value === "skip") return value;
  return "listen_segments";
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const episodeSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["oneLiner", "overview", "chapters", "worthListening", "entities"],
  properties: {
    oneLiner: { type: "string" },
    overview: { type: "string" },
    chapters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "startSec", "endSec", "summary"],
        properties: {
          title: { type: "string" },
          startSec: { type: "number" },
          endSec: { type: "number" },
          summary: { type: "string" }
        }
      }
    },
    worthListening: {
      type: "object",
      additionalProperties: false,
      required: ["recommendation", "reason", "bestSegments"],
      properties: {
        recommendation: { type: "string", enum: ["listen_full", "listen_segments", "skip"] },
        reason: { type: "string" },
        bestSegments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["startSec", "endSec", "reason"],
            properties: {
              startSec: { type: "number" },
              endSec: { type: "number" },
              reason: { type: "string" }
            }
          }
        }
      }
    },
    entities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "type", "mentions"],
        properties: {
          name: { type: "string" },
          type: { type: "string" },
          mentions: { type: "number" }
        }
      }
    }
  }
};

const watchInsightsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["insights"],
  properties: {
    insights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "segmentIndex",
          "claim",
          "evidenceExcerpt",
          "reasoning",
          "implication",
          "timestampStartSec",
          "timestampEndSec",
          "entities",
          "relevanceScore",
          "confidence"
        ],
        properties: {
          segmentIndex: { type: "number" },
          claim: { type: "string" },
          evidenceExcerpt: { type: "string" },
          reasoning: { type: "string" },
          implication: { type: "string" },
          timestampStartSec: { type: "number" },
          timestampEndSec: { type: "number" },
          entities: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "type"],
              properties: {
                name: { type: "string" },
                type: { type: "string" }
              }
            }
          },
          relevanceScore: { type: "number" },
          confidence: { type: "number" }
        }
      }
    }
  }
};
