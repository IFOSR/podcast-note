import { spawn } from "node:child_process";
import { stableId } from "../../core/src/format.ts";
import type { Insight } from "../../core/src/types.ts";
import type {
  WikiPatch,
  WikiProposalProvider,
  WikiProposalProviderInput,
  WikiProposalType,
  WikiUpdateProposal
} from "./types.ts";
import { formatTimestamp, isoDate, slugifyPathPart, wikiLink } from "./format.ts";

export type DeepSeekTuiWikiProposalProviderOptions = {
  command?: string;
  cwd?: string;
  timeoutMs?: number;
};

type DeepSeekProposalResponse = {
  proposals?: Array<Partial<WikiUpdateProposal> & {
    patch?: Partial<WikiPatch>;
  }>;
};

const proposalTypes = new Set<WikiProposalType>([
  "create_page",
  "append_evidence",
  "revise_summary",
  "flag_conflict",
  "add_crosslink"
]);

export function createDeepSeekTuiWikiProposalProvider(
  options: DeepSeekTuiWikiProposalProviderOptions = {}
): WikiProposalProvider {
  const command = options.command ?? process.env["DEEPSEEK_TUI_COMMAND"] ?? "deepseek-tui";
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? numberFromEnv("DEEPSEEK_TUI_WIKI_PROPOSAL_TIMEOUT_MS", 10 * 60 * 1000);

  return {
    name: "deepseek-tui",
    model: "wiki-proposal-v1",
    async generateProposals(input: WikiProposalProviderInput): Promise<WikiUpdateProposal[]> {
      const raw = await runDeepSeekTui({
        command,
        cwd,
        timeoutMs,
        prompt: buildPrompt(input)
      });
      return normalizeResponse(parseJsonObject<DeepSeekProposalResponse>(raw), input);
    }
  };
}

async function runDeepSeekTui(input: {
  command: string;
  cwd: string;
  timeoutMs: number;
  prompt: string;
}): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const command = parseCommand(input.command);
    const child = spawn(command.file, [...command.args, "exec", "--auto", input.prompt], {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`deepseek-tui wiki proposal generation timed out after ${input.timeoutMs}ms.`));
    }, input.timeoutMs);

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
      reject(new Error(`deepseek-tui exec failed with code ${code ?? "unknown"}: ${stderr || stdout}`.trim()));
    });
  });
}

function buildPrompt(input: WikiProposalProviderInput): string {
  const minConfidence = input.config.minConfidence ?? 0.75;
  const minGroundedness = input.config.minGroundedness ?? 0.8;
  const published = input.result.insights
    .filter((insight) =>
      insight.status === "published"
      && insight.confidence >= minConfidence
      && (insight.groundednessScore ?? 0) >= minGroundedness
    )
    .map((insight) => ({
      id: insight.id,
      claim: insight.claim,
      evidenceExcerpt: insight.evidenceExcerpt,
      reasoning: insight.reasoning,
      implication: insight.implication,
      timestampStartSec: insight.timestampStartSec,
      timestampEndSec: insight.timestampEndSec,
      entities: insight.entities,
      relevanceScore: insight.relevanceScore,
      confidence: insight.confidence,
      groundednessScore: insight.groundednessScore
    }));

  return [
    "You are wiki-proposal-v1 for PodcastNote.",
    "Generate Obsidian wiki update proposals from grounded podcast insights.",
    "Do not ask the user to confirm anything. Make all judgment calls yourself.",
    "Return only valid JSON, with no markdown fences and no explanation.",
    "",
    "Allowed proposal_type values: create_page, append_evidence, revise_summary, flag_conflict, add_crosslink.",
    "Allowed patch.operation values: create, append.",
    "Prefer conservative proposals that can be traced to an insight and timestamp.",
    "Use relative Markdown target paths under 20 Concepts, 30 Entities, or 40 Claims.",
    "",
    "JSON schema:",
    JSON.stringify({
      proposals: [{
        insightId: "insight id or omit for episode-level proposal",
        targetPath: "40 Claims/example.md",
        proposalType: "create_page",
        title: "short human readable title",
        rationale: "why this should update the wiki",
        patch: {
          section: "支持证据",
          operation: "append",
          markdown: "- dated evidence line with source/timestamp/insight_id",
          citations: [{
            episodeId: input.result.episode.id,
            insightId: "insight id",
            timestampStartSec: 0,
            timestampEndSec: 60
          }]
        }
      }]
    }, null, 2),
    "",
    "Episode:",
    JSON.stringify({
      id: input.result.episode.id,
      title: input.result.episode.title,
      publishedAt: input.result.episode.publishedAt,
      pageUrl: input.result.episode.pageUrl,
      podcastTitle: input.result.episode.metadata?.podcastTitle
    }, null, 2),
    "",
    "Watch:",
    JSON.stringify({
      id: input.watch.id,
      workspaceId: input.watch.workspaceId,
      name: input.watch.name,
      query: input.watch.query,
      includeTerms: input.watch.includeTerms,
      expandedTerms: input.watch.expandedTerms,
      outputLanguage: input.watch.outputLanguage
    }, null, 2),
    "",
    "Published insights:",
    JSON.stringify(published, null, 2)
  ].join("\n");
}

function normalizeResponse(response: DeepSeekProposalResponse, input: WikiProposalProviderInput): WikiUpdateProposal[] {
  if (!Array.isArray(response.proposals)) {
    throw new Error("deepseek-tui wiki proposal response must include proposals array.");
  }
  const minConfidence = input.config.minConfidence ?? 0.75;
  const minGroundedness = input.config.minGroundedness ?? 0.8;
  const insightById = new Map(input.result.insights
    .filter((insight) =>
      insight.status === "published"
      && insight.confidence >= minConfidence
      && (insight.groundednessScore ?? 0) >= minGroundedness
    )
    .map((insight) => [insight.id, insight]));
  const normalized = response.proposals.slice(0, 30).flatMap((raw, index) => {
    const insight = raw.insightId ? insightById.get(raw.insightId) : undefined;
    if (typeof raw.insightId === "string" && !insight) return [];
    const targetPath = normalizeTargetPath(raw.targetPath, insight, input, index);
    const proposalType = normalizeProposalType(raw.proposalType, targetPath);
    const patch = normalizePatch(raw.patch, insight, input);
    const title = stringOrFallback(raw.title, defaultTitle(proposalType, targetPath, insight)).trim();
    const rationale = stringOrFallback(raw.rationale, "DeepSeek TUI generated wiki-proposal-v1 update.").trim();
    const idSeed = [
      raw.id,
      raw.insightId,
      targetPath,
      proposalType,
      patch.section,
      patch.markdown
    ].filter(Boolean).join(":");

    return [{
      id: stableId("wiki_prop", idSeed || `${input.result.episode.id}:${index}`),
      workspaceId: input.watch.workspaceId,
      episodeId: input.result.episode.id,
      insightId: insight?.id ?? (typeof raw.insightId === "string" ? raw.insightId : undefined),
      targetPath,
      proposalType,
      title,
      rationale,
      patch,
      status: "pending" as const
    }];
  });

  return dedupeProposals(normalized);
}

function parseCommand(command: string): { file: string; args: string[] } {
  const parts = splitCommand(command.trim());
  if (parts.length === 0) return { file: "deepseek-tui", args: [] };
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

function normalizePatch(
  patch: Partial<WikiPatch> | undefined,
  insight: Insight | undefined,
  input: WikiProposalProviderInput
): WikiPatch {
  const section = stringOrFallback(patch?.section, "支持证据").trim();
  const operation = patch?.operation === "create" ? "create" : "append";
  const markdown = stringOrFallback(patch?.markdown, insight ? evidenceLine(input, insight) : episodeEvidenceLine(input)).trim();
  const rawCitations = Array.isArray(patch?.citations) ? patch.citations : [];
  const citations = rawCitations.length > 0
    ? rawCitations.map((citation) => ({
      episodeId: stringOrFallback(citation.episodeId, input.result.episode.id),
      insightId: typeof citation.insightId === "string" ? citation.insightId : insight?.id,
      timestampStartSec: numberOrUndefined(citation.timestampStartSec),
      timestampEndSec: numberOrUndefined(citation.timestampEndSec)
    }))
    : [{
      episodeId: input.result.episode.id,
      insightId: insight?.id,
      timestampStartSec: insight?.timestampStartSec,
      timestampEndSec: insight?.timestampEndSec
    }];

  return {
    section,
    operation,
    markdown,
    citations
  };
}

function normalizeTargetPath(
  rawPath: unknown,
  insight: Insight | undefined,
  input: WikiProposalProviderInput,
  index: number
): string {
  const fallback = insight
    ? `40 Claims/${slugifyPathPart(insight.claim.replace(/[。.!?！？]$/g, ""), insight.id)}.md`
    : `20 Concepts/${slugifyPathPart(input.watch.query || input.watch.name, `${input.result.episode.id}-${index}`)}.md`;
  const path = typeof rawPath === "string" && rawPath.trim() ? rawPath.trim() : fallback;
  const normalized = path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.\.(\/|$)/g, "")
    .replace(/\/+/g, "/");
  const withExtension = normalized.toLowerCase().endsWith(".md") ? normalized : `${normalized}.md`;
  if (/^(20 Concepts|30 Entities|40 Claims)\//.test(withExtension)) return withExtension;
  return fallback;
}

function normalizeProposalType(rawType: unknown, targetPath: string): WikiProposalType {
  if (typeof rawType === "string" && proposalTypes.has(rawType as WikiProposalType)) {
    return rawType as WikiProposalType;
  }
  return targetPath.startsWith("40 Claims/") ? "create_page" : "append_evidence";
}

function defaultTitle(proposalType: WikiProposalType, targetPath: string, insight?: Insight): string {
  if (insight) return `${proposalType === "create_page" ? "形成观点页" : "补充证据"}：${insight.claim}`;
  return `更新 wiki：${targetPath.replace(/\.md$/i, "")}`;
}

function evidenceLine(input: WikiProposalProviderInput, insight: Insight): string {
  return `- ${isoDate(input.result.episode.publishedAt, new Date().toISOString())}: ${insight.claim} ${sourceNoteLink(input)} ${formatTimestamp(insight.timestampStartSec)}-${formatTimestamp(insight.timestampEndSec)} (insight_id: ${insight.id})`;
}

function episodeEvidenceLine(input: WikiProposalProviderInput): string {
  return `- ${isoDate(input.result.episode.publishedAt, new Date().toISOString())}: ${input.result.summary.oneLiner} ${sourceNoteLink(input)}`;
}

function sourceNoteLink(input: WikiProposalProviderInput): string {
  const date = isoDate(input.result.episode.publishedAt, new Date().toISOString());
  return wikiLink(`${date} - ${slugifyPathPart(input.result.episode.title)}`);
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
    throw new Error("deepseek-tui did not return a JSON object.");
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

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function dedupeProposals(proposals: WikiUpdateProposal[]): WikiUpdateProposal[] {
  const seen = new Set<string>();
  return proposals.filter((proposal) => {
    const key = `${proposal.id}:${proposal.targetPath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
