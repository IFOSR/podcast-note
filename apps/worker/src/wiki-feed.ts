import type { createRepositories } from "../../../packages/db/src/index.ts";
import type { WikiPageRecord, WikiUpdateProposalRecord } from "../../../packages/db/src/repositories.ts";

type Repositories = ReturnType<typeof createRepositories>;

export type WikiFeedItem = {
  type: "new_claim" | "knowledge_page_updated" | "pending_proposal" | "conflict_detected" | "marked_stale" | "archived";
  title: string;
  targetPath?: string;
  status?: string;
  proposalId?: string;
  pageId?: string;
  rationale?: string;
  updatedAt?: string;
};

export type WikiFeed = {
  ok: true;
  counts: {
    pages: number;
    activePages: number;
    pendingProposals: number;
    conflicts: number;
    stalePages: number;
    archivedPages: number;
  };
  feed: WikiFeedItem[];
};

export function buildWikiFeed(input: {
  repositories: Repositories;
  workspaceId: string;
  vaultRoot?: string;
  limit?: number;
}): WikiFeed {
  const pages = input.repositories.listWikiPages({
    workspaceId: input.workspaceId,
    vaultRoot: input.vaultRoot,
    limit: input.limit ?? 100
  });
  const pending = input.repositories.listWikiUpdateProposals({
    workspaceId: input.workspaceId,
    status: "pending",
    limit: input.limit ?? 100
  });
  const exports = input.repositories.listWikiExports({
    workspaceId: input.workspaceId,
    exportType: "wiki_page",
    limit: input.limit ?? 100
  });
  const feed: WikiFeedItem[] = [
    ...pending.map(proposalToFeedItem),
    ...pages.filter((page) => page.status === "stale" || page.status === "deprecated").map(stalePageToFeedItem),
    ...pages.filter((page) => page.status === "archived").map(archivedPageToFeedItem),
    ...exports.map((item) => ({
      type: item.filePath.startsWith("40 Claims/") ? "new_claim" as const : "knowledge_page_updated" as const,
      title: item.filePath.startsWith("40 Claims/") ? `新观点：${titleFromPath(item.filePath)}` : `知识页更新：${titleFromPath(item.filePath)}`,
      targetPath: item.filePath,
      updatedAt: item.updatedAt
    }))
  ];

  return {
    ok: true,
    counts: {
      pages: pages.length,
      activePages: pages.filter((page) => page.status === "active").length,
      pendingProposals: pending.length,
      conflicts: pending.filter((proposal) => proposal.proposalType === "flag_conflict").length + pages.filter((page) => page.status === "contested").length,
      stalePages: pages.filter((page) => page.status === "stale" || page.status === "deprecated").length,
      archivedPages: pages.filter((page) => page.status === "archived").length
    },
    feed: feed.slice(0, input.limit ?? 100)
  };
}

function proposalToFeedItem(proposal: WikiUpdateProposalRecord): WikiFeedItem {
  if (proposal.proposalType === "flag_conflict") {
    return {
      type: "conflict_detected",
      title: proposal.title,
      targetPath: proposal.targetPath,
      proposalId: proposal.id,
      rationale: proposal.rationale,
      updatedAt: proposal.updatedAt
    };
  }
  return {
    type: "pending_proposal",
    title: proposal.title,
    targetPath: proposal.targetPath,
    proposalId: proposal.id,
    rationale: proposal.rationale,
    updatedAt: proposal.updatedAt
  };
}

function stalePageToFeedItem(page: WikiPageRecord): WikiFeedItem {
  return {
    type: "marked_stale",
    title: `知识衰退：${page.title}`,
    targetPath: page.path,
    pageId: page.id,
    status: page.status,
    updatedAt: page.updatedAt
  };
}

function archivedPageToFeedItem(page: WikiPageRecord): WikiFeedItem {
  return {
    type: "archived",
    title: `已归档：${page.title}`,
    targetPath: page.path,
    pageId: page.id,
    status: page.status,
    updatedAt: page.updatedAt
  };
}

function titleFromPath(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/i, "") ?? path;
}
