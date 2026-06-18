import type { Episode, EpisodeProcessingResult, Insight, Watch } from "../../core/src/types.ts";

export type WikiExportType = "source_note" | "brief" | "proposal" | "wiki_page" | "lark_doc";
export type WikiExportStatus = "written" | "skipped" | "failed";
export type WikiProposalType = "create_page" | "append_evidence" | "revise_summary" | "flag_conflict" | "add_crosslink";
export type WikiProposalStatus = "pending" | "approved" | "applied" | "rejected" | "failed";

export type WikiExportRecord = {
  id: string;
  workspaceId: string;
  vaultRoot: string;
  episodeId?: string;
  watchId?: string;
  exportType: WikiExportType;
  filePath: string;
  contentHash: string;
  status: WikiExportStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type WikiUpdateProposal = {
  id: string;
  workspaceId: string;
  episodeId: string;
  insightId?: string;
  targetPath: string;
  proposalType: WikiProposalType;
  title: string;
  rationale: string;
  patch: WikiPatch;
  status: WikiProposalStatus;
  createdAt?: string;
  updatedAt?: string;
};

export type WikiPatch = {
  section: string;
  operation: "append" | "create";
  markdown: string;
  citations: Array<{
    episodeId: string;
    insightId?: string;
    timestampStartSec?: number;
    timestampEndSec?: number;
  }>;
};

export type WikiVaultConfig = {
  vaultRoot: string;
  autoApply?: boolean;
  minConfidence?: number;
  minGroundedness?: number;
  now?: string;
  proposalProvider?: WikiProposalProvider;
};

export type WikiProposalProviderInput = {
  result: EpisodeProcessingResult;
  watch: Watch;
  config: Omit<WikiVaultConfig, "proposalProvider">;
};

export type WikiProposalProvider = {
  readonly name: string;
  readonly model?: string;
  generateProposals(input: WikiProposalProviderInput): Promise<WikiUpdateProposal[]>;
};

export type WikiEpisodeContext = {
  result: EpisodeProcessingResult;
  watch: Watch;
  transcriptProvider?: string;
  summaryModel?: string;
  processedAt?: string;
};

export type WikiCompileResult = {
  sourceNotePath: string;
  sourceNoteHash: string;
  sourceNoteStatus: WikiExportStatus;
  proposals: WikiUpdateProposal[];
  appliedPaths: string[];
  appliedHashes: Record<string, string>;
  healthPath: string;
  logPath: string;
};

export type WikiEpisodeRecord = {
  episode: Episode;
  watch: Watch;
  result: EpisodeProcessingResult;
};

export type InsightWithEpisode = Insight & {
  episodeTitle: string;
  episodePageUrl: string;
  episodePublishedAt?: string;
  watchName: string;
};

export type LarkDocumentPublisher = {
  publishMarkdown(input: {
    title: string;
    markdown: string;
    target?: string;
  }): Promise<{
    providerDocumentId: string;
    url?: string;
  }>;
};
