import { spawn } from "node:child_process";
import type {
  EpisodeSummaryInput,
  InsightProvider,
  IntentAssistantInput,
  IntentAssistantOutput,
  IntentAssistantProvider,
  WatchInsightInput
} from "./types.ts";
import {
  episodeSummarySchema,
  insightSystemPrompt,
  intentAssistantSchema,
  intentAssistantSystemPrompt,
  normalizeEpisodeSummary,
  normalizeIntentAssistantOutput,
  normalizeWatchInsights,
  segmentPayload,
  summarySystemPrompt,
  watchInsightsSchema,
  type InsightResponse,
  type SummaryResponse
} from "./llm-json.ts";

export type CommandLineProviderOptions = {
  deepseekCommand?: string;
  kimiCommand?: string;
  model?: string;
  deepseekModel?: string;
  kimiModel?: string;
  cwd?: string;
  timeoutMs?: number;
};

export type CommandLineJsonProvider = {
  name: string;
  model: string;
  completeJson<T>(input: {
    schema: Record<string, unknown>;
    prompt: string;
  }): Promise<T>;
};

type CommandSpec = {
  name: "deepseek" | "kimi";
  command: string;
  args: string[];
  promptMode: "argument" | "flag";
  timeoutMs: number;
};

export function createCommandLineInsightProvider(options: CommandLineProviderOptions = {}): InsightProvider {
  const config = providerConfig(options, "insight");
  return {
    name: "command-line-llm",
    model: config.modelLabel,
    async summarizeEpisode(input: EpisodeSummaryInput) {
      const output = await runLocalLlmJson<SummaryResponse>({
        ...config,
        schema: episodeSummarySchema,
        prompt: [
          summarySystemPrompt(input.outputLanguage),
          "",
          "Summarize this podcast episode from transcript segments. Return only valid JSON that matches the schema.",
          "Do not wrap JSON in markdown fences. Do not include explanations.",
          "",
          "JSON schema:",
          JSON.stringify(episodeSummarySchema, null, 2),
          "",
          `Episode: ${JSON.stringify(input.episode)}`,
          "",
          `Segments: ${JSON.stringify(segmentPayload(input.segments))}`
        ].join("\n")
      });
      return normalizeEpisodeSummary(output, input.segments);
    },
    async extractWatchInsights(input: WatchInsightInput) {
      const output = await runLocalLlmJson<InsightResponse>({
        ...config,
        schema: watchInsightsSchema,
        prompt: [
          insightSystemPrompt(input.outputLanguage),
          "",
          "Extract only watch-specific insights. Return only valid JSON that matches the schema.",
          "Do not wrap JSON in markdown fences. Do not include explanations.",
          "",
          "JSON schema:",
          JSON.stringify(watchInsightsSchema, null, 2),
          "",
          `Episode: ${JSON.stringify(input.episode)}`,
          "",
          `Watch: ${JSON.stringify(input.watch)}`,
          "",
          `Segments: ${JSON.stringify(segmentPayload(input.segments))}`
        ].join("\n")
      });
      return normalizeWatchInsights(output, input, config.modelLabel);
    }
  };
}

export function createCommandLineIntentAssistantProvider(options: CommandLineProviderOptions = {}): IntentAssistantProvider {
  const config = providerConfig(options, "intent");
  return {
    name: "command-line-intent-assistant",
    model: config.modelLabel,
    async analyze(input: IntentAssistantInput): Promise<IntentAssistantOutput> {
      const output = await runLocalLlmJson<IntentAssistantOutput>({
        ...config,
        schema: intentAssistantSchema,
        prompt: [
          intentAssistantSystemPrompt(input.outputLanguage),
          "",
          "Analyze the user message for Podcast Note. Return only valid JSON that matches the schema.",
          "Do not wrap JSON in markdown fences. Do not include explanations.",
          "",
          "JSON schema:",
          JSON.stringify(intentAssistantSchema, null, 2),
          "",
          `User message: ${JSON.stringify(input.message)}`,
          "",
          `Product context: ${JSON.stringify(input.context ?? {})}`
        ].join("\n")
      });
      return normalizeIntentAssistantOutput(output);
    }
  };
}

export function createCommandLineJsonProvider(options: CommandLineProviderOptions = {}, purpose: "insight" | "intent" | "wiki" = "wiki"): CommandLineJsonProvider {
  const config = providerConfig(options, purpose);
  return {
    name: "command-line-json",
    model: config.modelLabel,
    async completeJson<T>(input): Promise<T> {
      return await runLocalLlmJson<T>({
        ...config,
        schema: input.schema,
        prompt: input.prompt
      });
    }
  };
}

function providerConfig(options: CommandLineProviderOptions, purpose: "insight" | "intent" | "wiki") {
  const timeoutMs = options.timeoutMs
    ?? numberFromEnv(timeoutEnvName(purpose), purpose === "insight" ? 30 * 60 * 1000 : 2 * 60 * 1000);
  const deepseekModel = options.deepseekModel
    ?? options.model
    ?? process.env[modelEnvName("DEEPSEEK", purpose)]
    ?? process.env["DEEPSEEK_MODEL"]
    ?? "deepseek-chat";
  const kimiModel = options.kimiModel
    ?? options.model
    ?? process.env[modelEnvName("KIMI", purpose)]
    ?? process.env["KIMI_MODEL"]
    ?? "kimi-k2-0711-preview";
  return {
    cwd: options.cwd ?? process.cwd(),
    modelLabel: `deepseek:${deepseekModel}|kimi:${kimiModel}`,
    commands: [
      deepseekCommandSpec({
        command: options.deepseekCommand ?? process.env["DEEPSEEK_TUI_COMMAND"] ?? "deepseek-tui",
        model: deepseekModel,
        timeoutMs
      }),
      kimiCommandSpec({
        command: options.kimiCommand ?? process.env["KIMI_CODE_COMMAND"] ?? "kimi",
        model: kimiModel,
        timeoutMs
      })
    ]
  };
}

function timeoutEnvName(purpose: "insight" | "intent" | "wiki"): string {
  if (purpose === "intent") return "LOCAL_LLM_INTENT_TIMEOUT_MS";
  if (purpose === "wiki") return "LOCAL_LLM_WIKI_TIMEOUT_MS";
  return "LOCAL_LLM_INSIGHT_TIMEOUT_MS";
}

function modelEnvName(provider: "DEEPSEEK" | "KIMI", purpose: "insight" | "intent" | "wiki"): string {
  if (purpose === "intent") return `${provider}_INTENT_MODEL`;
  if (purpose === "wiki") return `${provider}_WIKI_MODEL`;
  return `${provider}_INSIGHT_MODEL`;
}

async function runLocalLlmJson<T>(input: {
  cwd: string;
  commands: CommandSpec[];
  schema: Record<string, unknown>;
  prompt: string;
}): Promise<T> {
  const errors: string[] = [];
  for (const command of input.commands) {
    try {
      const raw = await runLocalLlmCommand({
        cwd: input.cwd,
        command,
        prompt: input.prompt
      });
      return parseJsonObject<T>(raw);
    } catch (error) {
      errors.push(`${command.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`All local LLM commands failed: ${errors.join(" | ")}`);
}

async function runLocalLlmCommand(input: {
  cwd: string;
  command: CommandSpec;
  prompt: string;
}): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const promptArgs = input.command.promptMode === "flag" ? ["-p", input.prompt] : [input.prompt];
    const child = spawn(input.command.command, [...input.command.args, ...promptArgs], {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`${input.command.name} timed out after ${input.command.timeoutMs}ms.`));
    }, input.command.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`exited with code ${code ?? "unknown"}: ${stderr || stdout}`.trim()));
    });
  });
}

function deepseekCommandSpec(input: { command: string; model: string; timeoutMs: number }): CommandSpec {
  const parsed = parseCommand(input.command);
  return {
    name: "deepseek",
    command: parsed.file,
    args: [...parsed.args, "exec", "--model", input.model],
    promptMode: "argument",
    timeoutMs: input.timeoutMs
  };
}

function kimiCommandSpec(input: { command: string; model: string; timeoutMs: number }): CommandSpec {
  const parsed = parseCommand(input.command);
  return {
    name: "kimi",
    command: parsed.file,
    args: [...parsed.args, "--quiet", "-m", input.model],
    promptMode: "flag",
    timeoutMs: input.timeoutMs
  };
}

function parseCommand(command: string): { file: string; args: string[] } {
  const parts = splitCommand(command.trim());
  if (parts.length === 0) return { file: command.trim(), args: [] };
  return { file: parts[0], args: parts.slice(1) };
}

function splitCommand(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "\"" | "'" | undefined;
  let escaped = false;
  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if ((char === "\"" || char === "'") && (!quote || quote === char)) {
      quote = quote ? undefined : char;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (escaped) current += "\\";
  if (current) parts.push(current);
  return parts;
}

function parseJsonObject<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    for (let index = raw.indexOf("{"); index !== -1; index = raw.indexOf("{", index + 1)) {
      const candidate = balancedJsonObject(raw, index);
      if (!candidate) continue;
      try {
        return JSON.parse(candidate) as T;
      } catch {
        continue;
      }
    }
    throw new Error("Local LLM command did not return a JSON object.");
  }
}

function balancedJsonObject(raw: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return raw.slice(start, index + 1);
  }
  return undefined;
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
