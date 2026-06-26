import type { Episode, Insight, Watch } from "../../../packages/core/src/types.ts";
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

type Candidate = {
  page: WikiPageRecord;
  evidence: WikiPageEvidenceRecord;
  insight?: Insight;
  episode?: Episode;
  watch?: Watch;
  score: number;
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

  const pages = input.repositories.listWikiPages({
    workspaceId: input.workspaceId,
    vaultRoot: input.vaultRoot,
    limit: input.limit ?? 200
  });
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const watchById = new Map(input.repositories.listWatchesForWorkspace(input.workspaceId).map((watch) => [watch.id, watch]));
  const candidates = input.repositories.listWikiPageEvidence({
    workspaceId: input.workspaceId,
    limit: (input.limit ?? 200) * 10
  })
    .map((evidence): Candidate | undefined => {
      const page = pageById.get(evidence.pageId);
      if (!page || page.status === "archived") return undefined;
      const insight = input.repositories.listInsights({ episodeId: evidence.episodeId, limit: 100 })
        .find((item) => item.id === evidence.insightId);
      const episode = input.repositories.getEpisode(evidence.episodeId);
      const score = scoreCandidate({ page, evidence, insight, episode }, terms);
      if (score <= 0) return undefined;
      return {
        page,
        evidence,
        insight,
        episode,
        watch: evidence.watchId ? watchById.get(evidence.watchId) : undefined,
        score
      };
    })
    .filter((candidate): candidate is Candidate => Boolean(candidate))
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 5);

  const conflictProposals = input.repositories.listWikiUpdateProposals({
    workspaceId: input.workspaceId,
    status: "pending",
    limit: 100
  }).filter((proposal) => proposal.proposalType === "flag_conflict");
  const hasConflict = candidates.some((candidate) => pageHasConflict(candidate.page, conflictProposals))
    || conflictProposals.some((proposal) => proposalMatchesTerms(proposal, terms));
  if (candidates.length === 0) return insufficientResult(question, hasConflict);

  const citations = candidates.map(candidateToCitation);
  return {
    ok: true,
    question,
    answer: renderAnswer({ question, candidates, citations, hasConflict }),
    insufficient: false,
    hasConflict,
    citations
  };
}

function renderAnswer(input: {
  question: string;
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
  for (const term of terms) {
    if (haystack.includes(term)) score += term.length >= 4 ? 2 : 1;
  }
  if (score === 0) return 0;
  if (input.evidence.supportType === "supporting") score += 2;
  if (input.page.status === "active") score += 2;
  if (input.page.status === "contested") score += 1;
  score += Math.min(1, input.evidence.confidence);
  score += Math.min(1, input.evidence.groundednessScore);
  return score;
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
    .replace(/(帮我|请问|请|一下|知识库|播客|里面|关于|对于|有没有|是否|什么|哪些|怎么|为什么|如何|多少|观点|结论|总结|情况|内容|讲了|提到|相关|直接|最新)/gu, "")
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
