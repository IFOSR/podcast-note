import type { Episode, Insight } from "../../../packages/core/src/types.ts";
import type { createRepositories } from "../../../packages/db/src/index.ts";
import type { WikiPageEvidenceRecord, WikiPageRecord, WikiUpdateProposalRecord } from "../../../packages/db/src/repositories.ts";

type Repositories = ReturnType<typeof createRepositories>;

export type WikiAskResult = {
  ok: true;
  question: string;
  answer: string;
  insufficient: boolean;
  hasConflict: boolean;
  citations: WikiAskCitation[];
};

export type WikiAskCitation = {
  wikiPath: string;
  wikiTitle: string;
  episodeId: string;
  episodeTitle: string;
  episodeUrl?: string;
  insightId: string;
  timestamp?: string;
  supportType: string;
  claim: string;
  evidenceExcerpt: string;
};

export type WikiAskLlmProvider = {
  name: string;
  model: string;
  completeJson<T>(input: {
    schema: Record<string, unknown>;
    prompt: string;
  }): Promise<T>;
};

type Candidate = {
  id: string;
  page: WikiPageRecord;
  evidence: WikiPageEvidenceRecord;
  insight?: Insight;
  episode?: Episode;
  score: number;
};

type WikiAskLlmResponse = {
  insufficient: boolean;
  answer: string;
  citationIds: string[];
  reasoning?: string;
};

const genericQueryTerms = new Set(["ai", "llm", "ml", "人工智能"]);

const wikiAskLlmSchema = {
  type: "object",
  additionalProperties: false,
  required: ["insufficient", "answer", "citationIds"],
  properties: {
    insufficient: { type: "boolean" },
    answer: { type: "string" },
    citationIds: { type: "array", items: { type: "string" }, maxItems: 5 },
    reasoning: { type: "string" }
  }
};

export function askWiki(input: {
  repositories: Repositories;
  workspaceId: string;
  vaultRoot?: string;
  question: string;
  limit?: number;
}): WikiAskResult {
  const question = input.question.trim();
  const terms = queryTermsFor(question);
  if (!question || terms.length === 0) return insufficientResult(question, false);

  const candidates = retrieveWikiCandidates({
    repositories: input.repositories,
    workspaceId: input.workspaceId,
    vaultRoot: input.vaultRoot,
    question,
    limit: input.limit ?? 5,
    requireTermMatch: true
  });
  const conflictProposals = conflictProposalsFor(input.repositories, input.workspaceId);
  const hasConflict = candidates.some((candidate) => pageHasConflict(candidate.page, conflictProposals))
    || conflictProposals.some((proposal) => proposalMatchesTerms(proposal, terms));
  if (candidates.length === 0) return insufficientResult(question, hasConflict);

  const citations = candidates.map(candidateToCitation);
  return {
    ok: true,
    question,
    answer: renderDeterministicAnswer({ candidates, citations, hasConflict }),
    insufficient: false,
    hasConflict,
    citations
  };
}

export async function askWikiWithLlm(input: {
  repositories: Repositories;
  workspaceId: string;
  vaultRoot?: string;
  question: string;
  llm: WikiAskLlmProvider;
  candidateLimit?: number;
  citationLimit?: number;
}): Promise<WikiAskResult> {
  const question = input.question.trim();
  if (!question) return insufficientResult(question, false);

  const candidates = retrieveWikiCandidates({
    repositories: input.repositories,
    workspaceId: input.workspaceId,
    vaultRoot: input.vaultRoot,
    question,
    limit: input.candidateLimit ?? 20,
    requireTermMatch: false
  });
  const conflictProposals = conflictProposalsFor(input.repositories, input.workspaceId);
  const hasConflict = candidates.some((candidate) => pageHasConflict(candidate.page, conflictProposals))
    || conflictProposals.some((proposal) => proposalMatchesTerms(proposal, queryTermsFor(question)));
  if (candidates.length === 0) return insufficientResult(question, hasConflict);

  const response = await input.llm.completeJson<WikiAskLlmResponse>({
    schema: wikiAskLlmSchema,
    prompt: wikiAskPrompt({
      question,
      candidates,
      hasConflict,
      citationLimit: input.citationLimit ?? 5
    })
  });

  return normalizeWikiAskLlmResponse({
    question,
    response,
    candidates,
    hasConflict
  });
}

function retrieveWikiCandidates(input: {
  repositories: Repositories;
  workspaceId: string;
  vaultRoot?: string;
  question: string;
  limit: number;
  requireTermMatch: boolean;
}): Candidate[] {
  const terms = queryTermsFor(input.question);
  const pages = input.repositories.listWikiPages({
    workspaceId: input.workspaceId,
    vaultRoot: input.vaultRoot,
    limit: 500
  });
  const pageById = new Map(pages.map((page) => [page.id, page]));
  return input.repositories.listWikiPageEvidence({
    workspaceId: input.workspaceId,
    limit: Math.max(input.limit * 10, 100)
  })
    .map((evidence, index): Candidate | undefined => {
      const page = pageById.get(evidence.pageId);
      if (!page || page.status === "archived") return undefined;
      const insight = input.repositories.listInsights({ episodeId: evidence.episodeId, limit: 100 })
        .find((item) => item.id === evidence.insightId);
      const episode = input.repositories.getEpisode(evidence.episodeId);
      const score = terms.length > 0 ? scoreCandidate({ page, evidence, insight, episode }, terms) : 0;
      if (input.requireTermMatch && score <= 0) return undefined;
      return {
        id: `c${index + 1}`,
        page,
        evidence,
        insight,
        episode,
        score
      };
    })
    .filter((candidate): candidate is Candidate => Boolean(candidate))
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit);
}

function conflictProposalsFor(repositories: Repositories, workspaceId: string): WikiUpdateProposalRecord[] {
  return ["pending", "approved", "applied"]
    .flatMap((status) => repositories.listWikiUpdateProposals({
      workspaceId,
      status: status as "pending" | "approved" | "applied",
      limit: 100
    }))
    .filter((proposal) => proposal.proposalType === "flag_conflict");
}

function wikiAskPrompt(input: {
  question: string;
  candidates: Candidate[];
  hasConflict: boolean;
  citationLimit: number;
}): string {
  return [
    "你是 Podcast Note 的知识库 RAG 回答层。",
    "你必须只基于给定的 wiki evidence 回答，不得补充外部知识、常识或猜测。",
    "如果 evidence 不能直接回答用户问题，把 insufficient 设为 true，answer 用中文说明知识库证据不足，citationIds 返回空数组。",
    "如果可以回答，综合多条 evidence 给出简洁中文答案，并返回实际使用的 citationIds。",
    `最多使用 ${input.citationLimit} 条 citation。`,
    input.hasConflict ? "注意：候选证据涉及冲突观点，回答时必须提醒用户有冲突。" : "",
    "",
    `用户问题：${input.question}`,
    "",
    "候选 evidence JSON：",
    JSON.stringify(input.candidates.map((candidate) => ({
      id: candidate.id,
      wikiPath: candidate.page.path,
      wikiTitle: candidate.page.title,
      pageStatus: candidate.page.status,
      claim: candidate.evidence.claim,
      evidenceExcerpt: candidate.evidence.evidenceExcerpt,
      supportType: candidate.evidence.supportType,
      episodeTitle: candidate.episode?.title ?? candidate.evidence.episodeId,
      episodeUrl: candidate.episode?.pageUrl,
      timestamp: formatTimestampRange(candidate.evidence.timestampStartSec, candidate.evidence.timestampEndSec),
      insightReasoning: candidate.insight?.reasoning,
      insightImplication: candidate.insight?.implication
    })), null, 2),
    "",
    "输出必须是 JSON，不能使用 markdown 代码块。Schema:",
    JSON.stringify(wikiAskLlmSchema, null, 2)
  ].filter(Boolean).join("\n");
}

function normalizeWikiAskLlmResponse(input: {
  question: string;
  response: WikiAskLlmResponse;
  candidates: Candidate[];
  hasConflict: boolean;
}): WikiAskResult {
  const selected = input.response.citationIds
    .map((id) => input.candidates.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is Candidate => Boolean(candidate))
    .slice(0, 5);
  if (input.response.insufficient || selected.length === 0) {
    return insufficientResult(input.question, input.hasConflict);
  }
  const answer = [
    input.hasConflict && !input.response.answer.includes("冲突") ? "当前知识库中有冲突观点，以下回答需要结合冲突证据一起阅读。" : undefined,
    input.response.answer.trim(),
    "",
    "回答只基于当前已入库的 wiki page、insight 和 source citation。"
  ].filter(Boolean).join("\n");
  return {
    ok: true,
    question: input.question,
    answer,
    insufficient: false,
    hasConflict: input.hasConflict,
    citations: selected.map(candidateToCitation)
  };
}

function renderDeterministicAnswer(input: {
  candidates: Candidate[];
  citations: WikiAskCitation[];
  hasConflict: boolean;
}): string {
  const top = input.candidates[0];
  const bullets = input.citations.map((citation, index) => [
    `${index + 1}. ${citation.claim}`,
    `证据：${citation.evidenceExcerpt}`,
    `Wiki：${citation.wikiPath}`,
    `来源：${citation.episodeTitle}${citation.timestamp ? ` · ${citation.timestamp}` : ""}${citation.episodeUrl ? ` · ${citation.episodeUrl}` : ""}`
  ].join("\n")).join("\n\n");
  return [
    input.hasConflict ? "当前知识库中有冲突观点，以下回答需要按待审冲突一起阅读。" : undefined,
    `基于知识库页面「${top.page.title}」，目前最相关的结论是：${top.evidence.claim}`,
    "",
    bullets,
    "",
    "回答只基于当前已入库的 wiki page、insight 和 source citation。"
  ].filter(Boolean).join("\n");
}

function candidateToCitation(candidate: Candidate): WikiAskCitation {
  return {
    wikiPath: candidate.page.path,
    wikiTitle: candidate.page.title,
    episodeId: candidate.evidence.episodeId,
    episodeTitle: candidate.episode?.title ?? candidate.evidence.episodeId,
    episodeUrl: candidate.episode?.pageUrl,
    insightId: candidate.evidence.insightId,
    timestamp: formatTimestampRange(candidate.evidence.timestampStartSec, candidate.evidence.timestampEndSec),
    supportType: candidate.evidence.supportType,
    claim: candidate.evidence.claim,
    evidenceExcerpt: candidate.evidence.evidenceExcerpt
  };
}

function scoreCandidate(input: {
  page: WikiPageRecord;
  evidence: WikiPageEvidenceRecord;
  insight?: Insight;
  episode?: Episode;
}, terms: string[]): number {
  const haystack = normalizeForSearch([
    input.page.title,
    input.page.path,
    input.evidence.claim,
    input.evidence.evidenceExcerpt,
    input.insight?.reasoning,
    input.insight?.implication,
    input.episode?.title
  ].filter(Boolean).join("\n"));
  let score = 0;
  let specificScore = 0;
  let specificHitCount = 0;
  const requiredSpecificHits = Math.min(2, specificTermsFor(terms).length);
  for (const term of terms) {
    if (!haystack.includes(term)) continue;
    const weight = term.length >= 4 ? 2 : 1;
    score += weight;
    if (!isGenericQueryTerm(term)) {
      specificScore += weight;
      specificHitCount += 1;
    }
  }
  if (specificScore === 0 || specificHitCount < requiredSpecificHits) return 0;
  if (input.evidence.supportType === "supporting") score += 2;
  if (input.page.status === "active") score += 2;
  if (input.page.status === "contested") score += 1;
  score += Math.min(1, input.evidence.confidence);
  score += Math.min(1, input.evidence.groundednessScore);
  return score;
}

function isGenericQueryTerm(term: string): boolean {
  return genericQueryTerms.has(term);
}

function specificTermsFor(terms: string[]): string[] {
  return terms.filter((term) => !isGenericQueryTerm(term));
}

function pageHasConflict(page: WikiPageRecord, proposals: WikiUpdateProposalRecord[]): boolean {
  return page.status === "contested" || proposals.some((proposal) => proposal.targetPath === page.path);
}

function proposalMatchesTerms(proposal: WikiUpdateProposalRecord, terms: string[]): boolean {
  const haystack = normalizeForSearch([
    proposal.title,
    proposal.rationale,
    proposal.targetPath,
    typeof proposal.patch.markdown === "string" ? proposal.patch.markdown : undefined
  ].filter(Boolean).join("\n"));
  return terms.some((term) => haystack.includes(term));
}

function insufficientResult(question: string, hasConflict: boolean): WikiAskResult {
  return {
    ok: true,
    question,
    answer: `知识库证据不足：暂时没有找到能直接回答「${question}」的 wiki page 或 insight 引用。`,
    insufficient: true,
    hasConflict,
    citations: []
  };
}

function queryTermsFor(question: string): string[] {
  const normalized = normalizeForSearch(question);
  const terms = new Set<string>();
  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_-]*/g)) {
    if (match[0].length >= 2) terms.add(match[0]);
  }
  for (const match of normalized.matchAll(/\p{Script=Han}+/gu)) {
    const compact = stripChineseStopwords(match[0]);
    if (compact.length >= 2) terms.add(compact);
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= compact.length - size; index += 1) {
        terms.add(compact.slice(index, index + size));
      }
    }
  }
  return Array.from(terms).filter((term) => term.length >= 2);
}

function normalizeForSearch(input: string): string {
  return input.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, " ");
}

function stripChineseStopwords(input: string): string {
  return input
    .replace(/(帮我|请问|请|一下|知识库|播客|里面|关于|对于|有没有|是否|什么样|有什么样|什么|哪些|怎么|为什么|如何|多少|观点|结论|总结|情况|内容|讲了|提到|相关|直接|最新|特点|特征|具备|具有|的|了|啊|吗|呢)/gu, "")
    .trim();
}

function formatTimestampRange(startSec?: number, endSec?: number): string | undefined {
  if (startSec === undefined) return undefined;
  const start = formatTimestamp(startSec);
  return endSec && endSec > startSec ? `${start}-${formatTimestamp(endSec)}` : start;
}

function formatTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hour = Math.floor(whole / 3600);
  const minute = Math.floor((whole % 3600) / 60);
  const second = whole % 60;
  if (hour > 0) return `${hour}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  return `${minute}:${String(second).padStart(2, "0")}`;
}
