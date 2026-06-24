import type { Episode, EpisodeProcessingResult, EpisodeSummary, Insight, Source, TranscriptSegment, User, Watch, Workspace } from "../../core/src/types.ts";
import { stableId } from "../../core/src/format.ts";
import type { TranscriptionOutput } from "../../ai/src/types.ts";
import type { PodcastNoteDb } from "./sqlite.ts";

type StoredTranscript = {
  id: string;
  episodeId: string;
  provider: string;
  model: string;
  language?: string;
  segments: TranscriptSegment[];
  confidence?: number;
  durationSec?: number;
};

export type ProcessingStage = "resolved" | "transcribing" | "transcribed" | "analyzing" | "analyzed" | "exported" | "failed";
export type ProcessingStatus = "running" | "completed" | "failed";
export type WatchPollStatus = "completed" | "failed";
export type EpisodeProcessingJobStatus = "queued" | "running" | "completed" | "failed";
export type DailyBriefStatus = "sent" | "failed" | "skipped";
export type InsightFeedbackAction = "saved" | "irrelevant" | "wrong" | "archived";
export type UsageEventType = "view" | "save" | "irrelevant" | "wrong" | "playback" | "open_email";
export type UsageEntityType = "inbox" | "episode" | "insight" | "brief" | "watch";
export type LarkBindSessionStatus = "pending" | "completed" | "expired" | "failed";
export type LarkConnectionStatus = "active" | "reauth_required" | "revoked";
export type LarkBotInstallationStatus = "active" | "disabled";
export type LarkDeliveryType = "episode_summary" | "wiki_pending_proposal_summary";
export type LarkPendingIntentStatus = "pending" | "completed" | "cancelled" | "expired";
export type WikiExportType = "source_note" | "brief" | "proposal" | "wiki_page" | "lark_doc";
export type WikiExportStatus = "written" | "skipped" | "failed";
export type WikiProposalType = "create_page" | "append_evidence" | "revise_summary" | "flag_conflict" | "add_crosslink";
export type WikiProposalStatus = "pending" | "approved" | "applied" | "rejected" | "failed";

export type Session = {
  id: string;
  userId: string;
  workspaceId: string;
  token: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
};

export type HydratedSession = Session & {
  user: User;
  workspace: Workspace;
};

export type UsageEvent = {
  id: string;
  workspaceId: string;
  userId: string;
  sessionId?: string;
  eventType: UsageEventType;
  entityType: UsageEntityType;
  entityId?: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
};

export type LarkBindSession = {
  id: string;
  workspaceId: string;
  agentId: string;
  stateHash: string;
  permissionPackage: string;
  terminalFingerprint?: string;
  status: LarkBindSessionStatus;
  connectionId?: string;
  verificationUrl: string;
  expiresAt: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
};

export type LarkConnection = {
  id: string;
  workspaceId: string;
  agentId: string;
  tenantKey: string;
  openId: string;
  unionId?: string;
  userName?: string;
  permissionPackage: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt?: string;
  status: LarkConnectionStatus;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
};

export type LarkBotInstallation = {
  id: string;
  workspaceId: string;
  appId: string;
  tenantKey: string;
  chatId: string;
  chatName?: string;
  operatorOpenId?: string;
  status: LarkBotInstallationStatus;
  installedAt: string;
  updatedAt: string;
  disabledAt?: string;
};

export type LarkDeliveryRecord = {
  id: string;
  workspaceId: string;
  watchId?: string;
  episodeId?: string;
  chatId: string;
  deliveryType: LarkDeliveryType;
  deliveryKey?: string;
  providerMessageId: string;
  deliveredAt: string;
};

export type LarkPendingIntent = {
  id: string;
  workspaceId: string;
  chatId: string;
  senderOpenId?: string;
  intentType: string;
  intent: Record<string, unknown>;
  status: LarkPendingIntentStatus;
  expiresAt: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
};

export type WikiExport = {
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

export type WikiUpdateProposalRecord = {
  id: string;
  workspaceId: string;
  episodeId: string;
  insightId?: string;
  targetPath: string;
  proposalType: WikiProposalType;
  title: string;
  rationale: string;
  patch: Record<string, unknown>;
  status: WikiProposalStatus;
  createdAt: string;
  updatedAt: string;
};

export type WatchPoll = {
  id: string;
  watchId: string;
  checkedAt: string;
  status: WatchPollStatus;
  candidateCount: number;
  queuedCount: number;
  error?: string;
};

export type EpisodeProcessingJob = {
  id: string;
  workspaceId: string;
  watchId: string;
  episodeId: string;
  sourceUrl: string;
  status: EpisodeProcessingJobStatus;
  attempts: number;
  relevanceScore?: number;
  relevanceReason: Record<string, unknown>;
  processingRunId?: string;
  error?: string;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type DailyBrief = {
  id: string;
  workspaceId: string;
  userId: string;
  briefDate: string;
  timezone: string;
  status: DailyBriefStatus;
  insightCount: number;
  subject?: string;
  providerMessageId?: string;
  error?: string;
  sentAt?: string;
};

export type InsightFeedback = {
  id: string;
  workspaceId: string;
  userId: string;
  insightId: string;
  action: InsightFeedbackAction;
  note?: string;
  createdAt: string;
};

export type InboxItem = Insight & {
  episodeTitle: string;
  episodePageUrl: string;
  episodeAudioUrl?: string;
  episodePublishedAt?: string;
  watchName: string;
  feedbackAction?: InsightFeedbackAction;
  feedbackNote?: string;
};

export type EpisodeDetail = {
  episode: Episode;
  source?: Source;
  summary?: EpisodeSummary;
  transcript?: StoredTranscript;
  insights: Array<Insight & { feedbackAction?: InsightFeedbackAction; feedbackNote?: string }>;
  player: {
    audioUrl?: string;
    pageUrl: string;
    durationSec?: number;
  };
};

export type DueWatch = {
  watch: Watch;
  lastPoll?: WatchPoll;
  now: string;
  since: string;
  reason: "never_polled" | "frequency_elapsed";
};

export type PollingJobInput = {
  id: string;
  workspaceId: string;
  watchId: string;
  watchType: Watch["type"];
  query: string;
  frequency: Watch["frequency"];
  since: string;
  now: string;
  reason: DueWatch["reason"];
};

type CreateWatchInput = Omit<Watch, "id" | "workspaceId" | "enabled" | "expandedTerms"> & {
  id?: string;
  enabled?: boolean;
  expandedTerms?: string[];
};

type UpdateWatchInput = Partial<Omit<Watch, "id" | "workspaceId">>;

export function createRepositories(db: PodcastNoteDb) {
  return {
    upsertUser: (user: { id: string; email?: string; name?: string; timezone?: string }) => upsertUser(db, user),
    getUser: (id: string) => getUser(db, id),
    ensurePersonalWorkspaceForUser: (userId: string) => ensurePersonalWorkspaceForUser(db, userId),
    getWorkspace: (id: string) => getWorkspace(db, id),
    createWatchForWorkspace: (workspaceId: string, input: CreateWatchInput) => createWatchForWorkspace(db, workspaceId, input),
    getWatchForWorkspace: (workspaceId: string, watchId: string) => getWatchForWorkspace(db, workspaceId, watchId),
    updateWatchForWorkspace: (workspaceId: string, watchId: string, patch: UpdateWatchInput) => updateWatchForWorkspace(db, workspaceId, watchId, patch),
    deleteWatchForWorkspace: (workspaceId: string, watchId: string) => deleteWatchForWorkspace(db, workspaceId, watchId),
    listWatchesForWorkspace: (workspaceId: string) => listWatchesForWorkspace(db, workspaceId),
    listEnabledWatchesForWorkspace: (workspaceId: string) => listEnabledWatchesForWorkspace(db, workspaceId),
    recordWatchPoll: (watchId: string, input: {
      checkedAt: string;
      status: WatchPollStatus;
      candidateCount?: number;
      queuedCount?: number;
      error?: string;
    }) => recordWatchPoll(db, watchId, input),
    getLatestWatchPoll: (watchId: string) => getLatestWatchPoll(db, watchId),
    listDueWatches: (options: { now: string; workspaceId?: string }) => listDueWatches(db, options),
    planPollingJobs: (options: { now: string; workspaceId?: string }) => planPollingJobs(db, options),
    upsertWatch: (watch: Watch) => upsertWatch(db, watch),
    upsertSource: (source: Source) => upsertSource(db, source),
    findSourceByTitle: (title: string) => findSourceByTitle(db, title),
    upsertEpisode: (episode: Episode) => upsertEpisode(db, episode),
    saveTranscript: (input: {
      episodeId: string;
      provider: string;
      model: string;
      transcript: TranscriptionOutput;
    }) => saveTranscript(db, input),
    saveProcessingResult: (result: EpisodeProcessingResult, watch: Watch, model: string) =>
      saveProcessingResult(db, result, watch, model),
    startProcessingRun: (input: { watchId: string; sources: string[] }) => startProcessingRun(db, input),
    completeProcessingRun: (runId: string) => completeProcessingRun(db, runId),
    failProcessingRun: (runId: string, error: string) => failProcessingRun(db, runId, error),
    updateEpisodeProcessingStatus: (input: {
      runId: string;
      episodeId: string;
      sourceUrl: string;
      stage: ProcessingStage;
      status: ProcessingStatus;
      error?: string;
    }) => updateEpisodeProcessingStatus(db, input),
    getProcessingRun: (runId: string) => getProcessingRun(db, runId),
    enqueueEpisodeProcessingJob: (input: {
      workspaceId: string;
      watchId: string;
      episodeId: string;
      sourceUrl: string;
      queuedAt?: string;
      relevanceScore?: number;
      relevanceReason?: Record<string, unknown>;
    }) => enqueueEpisodeProcessingJob(db, input),
    getEpisodeProcessingJob: (id: string) => getEpisodeProcessingJob(db, id),
    listQueuedEpisodeProcessingJobs: (options: { workspaceId?: string; limit?: number } = {}) => listQueuedEpisodeProcessingJobs(db, options),
    countEpisodeProcessingJobsByStatus: (workspaceId?: string) => countEpisodeProcessingJobsByStatus(db, workspaceId),
    retryFailedEpisodeProcessingJobsForWorkspace: (workspaceId: string) => retryFailedEpisodeProcessingJobsForWorkspace(db, workspaceId),
    claimEpisodeProcessingJob: (id: string) => claimEpisodeProcessingJob(db, id),
    attachProcessingRunToJob: (id: string, runId: string) => attachProcessingRunToJob(db, id, runId),
    completeEpisodeProcessingJob: (id: string) => completeEpisodeProcessingJob(db, id),
    failEpisodeProcessingJob: (id: string, error: string) => failEpisodeProcessingJob(db, id, error),
    requeueStaleEpisodeProcessingJobs: (options: {
      workspaceId?: string;
      staleBefore: string;
      error: string;
      maxAttempts?: number;
      jobIds?: string[];
    }) => requeueStaleEpisodeProcessingJobs(db, options),
    recordDailyBrief: (input: {
      workspaceId: string;
      userId: string;
      briefDate: string;
      timezone: string;
      status: DailyBriefStatus;
      insightCount?: number;
      subject?: string;
      providerMessageId?: string;
      error?: string;
      sentAt?: string;
    }) => recordDailyBrief(db, input),
    getDailyBrief: (workspaceId: string, userId: string, briefDate: string) => getDailyBrief(db, workspaceId, userId, briefDate),
    listDailyBriefs: (options: { workspaceId?: string; userId?: string; limit?: number } = {}) => listDailyBriefs(db, options),
    listInsightsForDailyBrief: (options: { workspaceId: string; since: string; until: string; limit?: number }) => listInsightsForDailyBrief(db, options),
    createSession: (input: {
      userId: string;
      workspaceId: string;
      token: string;
      expiresAt: string;
      createdAt?: string;
    }) => createSession(db, input),
    getSessionByToken: (token: string, now?: string) => getSessionByToken(db, token, now),
    revokeSession: (id: string, revokedAt?: string) => revokeSession(db, id, revokedAt),
    recordUsageEvent: (input: {
      workspaceId: string;
      userId: string;
      sessionId?: string;
      eventType: UsageEventType;
      entityType: UsageEntityType;
      entityId?: string;
      metadata?: Record<string, unknown>;
      occurredAt?: string;
    }) => recordUsageEvent(db, input),
    listUsageEvents: (options: { workspaceId?: string; userId?: string; entityType?: UsageEntityType; limit?: number } = {}) => listUsageEvents(db, options),
    listInboxItems: (options: { workspaceId: string; feedbackAction?: InsightFeedbackAction; limit?: number }) => listInboxItems(db, options),
    recordInsightFeedback: (input: {
      workspaceId: string;
      userId: string;
      insightId: string;
      action: InsightFeedbackAction;
      note?: string;
      createdAt?: string;
    }) => recordInsightFeedback(db, input),
    getInsightFeedback: (workspaceId: string, userId: string, insightId: string) => getInsightFeedback(db, workspaceId, userId, insightId),
    getEpisodeDetailForWorkspace: (input: { workspaceId: string; episodeId: string; userId?: string }) => getEpisodeDetailForWorkspace(db, input),
    getEpisode: (id: string) => getEpisode(db, id),
    getLatestTranscriptForEpisode: (episodeId: string) => getLatestTranscriptForEpisode(db, episodeId),
    getLatestInsightsForWatch: (watchId: string, limit = 50) => getLatestInsightsForWatch(db, watchId, limit),
    listProcessedEpisodes: (options: { limit?: number } = {}) => listProcessedEpisodes(db, options),
    listProcessedEpisodeDetailsForWorkspace: (options: { workspaceId: string; limit?: number }) =>
      listProcessedEpisodeDetailsForWorkspace(db, options),
    listProcessingRuns: (options: { limit?: number } = {}) => listProcessingRuns(db, options),
    listInsights: (options: { watchId?: string; episodeId?: string; limit?: number } = {}) => listInsights(db, options),
    createLarkBindSession: (input: {
      id: string;
      workspaceId: string;
      agentId: string;
      stateHash: string;
      permissionPackage: string;
      terminalFingerprint?: string;
      verificationUrl: string;
      expiresAt: string;
      createdAt: string;
    }) => createLarkBindSession(db, input),
    getLarkBindSession: (id: string) => getLarkBindSession(db, id),
    getLarkBindSessionByStateHash: (stateHash: string) => getLarkBindSessionByStateHash(db, stateHash),
    completeLarkBindSession: (input: {
      id: string;
      connectionId: string;
      completedAt: string;
    }) => completeLarkBindSession(db, input),
    expireLarkBindSession: (id: string, error?: string) => expireLarkBindSession(db, id, error),
    createLarkConnection: (input: {
      id: string;
      workspaceId: string;
      agentId: string;
      tenantKey: string;
      openId: string;
      unionId?: string;
      userName?: string;
      permissionPackage: string;
      encryptedAccessToken: string;
      encryptedRefreshToken: string;
      accessTokenExpiresAt: string;
      refreshTokenExpiresAt?: string;
      createdAt: string;
    }) => createLarkConnection(db, input),
    getLarkConnection: (id: string) => getLarkConnection(db, id),
    getLatestLarkConnectionForWorkspace: (workspaceId: string) => getLatestLarkConnectionForWorkspace(db, workspaceId),
    upsertLarkBotInstallation: (input: {
      id: string;
      workspaceId: string;
      appId: string;
      tenantKey: string;
      chatId: string;
      chatName?: string;
      operatorOpenId?: string;
      installedAt: string;
    }) => upsertLarkBotInstallation(db, input),
    getLatestLarkBotInstallationForWorkspace: (workspaceId: string, appId?: string) =>
      getLatestLarkBotInstallationForWorkspace(db, workspaceId, appId),
    listActiveLarkBotInstallationsForWorkspace: (workspaceId: string, appId?: string) =>
      listActiveLarkBotInstallationsForWorkspace(db, workspaceId, appId),
    getLarkDeliveryRecord: (input: {
      workspaceId: string;
      watchId: string;
      episodeId: string;
      chatId: string;
      deliveryType: LarkDeliveryType;
    }) => getLarkDeliveryRecord(db, input),
    createLarkDeliveryRecord: (input: {
      workspaceId: string;
      watchId: string;
      episodeId: string;
      chatId: string;
      deliveryType: LarkDeliveryType;
      providerMessageId: string;
      deliveredAt?: string;
    }) => createLarkDeliveryRecord(db, input),
    getLarkDeliveryRecordByKey: (input: {
      workspaceId: string;
      chatId: string;
      deliveryType: LarkDeliveryType;
      deliveryKey: string;
    }) => getLarkDeliveryRecordByKey(db, input),
    createLarkDeliveryRecordByKey: (input: {
      workspaceId: string;
      chatId: string;
      deliveryType: LarkDeliveryType;
      deliveryKey: string;
      providerMessageId: string;
      deliveredAt?: string;
    }) => createLarkDeliveryRecordByKey(db, input),
    createLarkPendingIntent: (input: {
      workspaceId: string;
      chatId: string;
      senderOpenId?: string;
      intentType: string;
      intent: Record<string, unknown>;
      expiresAt: string;
      createdAt?: string;
    }) => createLarkPendingIntent(db, input),
    getLatestPendingLarkIntent: (input: {
      workspaceId: string;
      chatId: string;
      senderOpenId?: string;
      now?: string;
    }) => getLatestPendingLarkIntent(db, input),
    completeLarkPendingIntent: (id: string, completedAt?: string) => completeLarkPendingIntent(db, id, completedAt),
    cancelLarkPendingIntent: (id: string, completedAt?: string, error?: string) => cancelLarkPendingIntent(db, id, completedAt, error),
    expireLarkPendingIntents: (now?: string) => expireLarkPendingIntents(db, now),
    recordWikiExport: (input: {
      workspaceId: string;
      vaultRoot: string;
      episodeId?: string;
      watchId?: string;
      exportType: WikiExportType;
      filePath: string;
      contentHash: string;
      status: WikiExportStatus;
      error?: string;
    }) => recordWikiExport(db, input),
    listWikiExports: (options: { workspaceId?: string; episodeId?: string; exportType?: WikiExportType; limit?: number } = {}) =>
      listWikiExports(db, options),
    upsertWikiUpdateProposal: (input: {
      id: string;
      workspaceId: string;
      episodeId: string;
      insightId?: string;
      targetPath: string;
      proposalType: WikiProposalType;
      title: string;
      rationale: string;
      patch: Record<string, unknown>;
      status: WikiProposalStatus;
    }) => upsertWikiUpdateProposal(db, input),
    listWikiUpdateProposals: (options: { workspaceId?: string; episodeId?: string; status?: WikiProposalStatus; limit?: number } = {}) =>
      listWikiUpdateProposals(db, options),
    updateWikiUpdateProposalStatus: (id: string, status: WikiProposalStatus) => updateWikiUpdateProposalStatus(db, id, status)
  };
}

function recordWikiExport(db: PodcastNoteDb, input: {
  workspaceId: string;
  vaultRoot: string;
  episodeId?: string;
  watchId?: string;
  exportType: WikiExportType;
  filePath: string;
  contentHash: string;
  status: WikiExportStatus;
  error?: string;
}): WikiExport {
  const id = stableId("wiki_export", `${input.workspaceId}:${input.exportType}:${input.filePath}`);
  db.query(`
    insert into wiki_exports (
      id, workspace_id, vault_root, episode_id, watch_id, export_type, file_path,
      content_hash, status, error
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(workspace_id, export_type, file_path) do update set
      vault_root = excluded.vault_root,
      episode_id = excluded.episode_id,
      watch_id = excluded.watch_id,
      content_hash = excluded.content_hash,
      status = excluded.status,
      error = excluded.error,
      updated_at = datetime('now')
  `).run(
    id,
    input.workspaceId,
    input.vaultRoot,
    input.episodeId ?? null,
    input.watchId ?? null,
    input.exportType,
    input.filePath,
    input.contentHash,
    input.status,
    input.error ?? null
  );
  const row = db.query("select * from wiki_exports where id = ?").get(id) as Record<string, unknown> | null;
  if (row) return wikiExportFromRow(row);
  const fallback = db.query(`
    select * from wiki_exports where workspace_id = ? and export_type = ? and file_path = ?
  `).get(input.workspaceId, input.exportType, input.filePath) as Record<string, unknown> | null;
  if (!fallback) throw new Error(`Failed to record wiki export ${id}`);
  return wikiExportFromRow(fallback);
}

function listWikiExports(db: PodcastNoteDb, options: {
  workspaceId?: string;
  episodeId?: string;
  exportType?: WikiExportType;
  limit?: number;
}): WikiExport[] {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.workspaceId) {
    conditions.push("workspace_id = ?");
    params.push(options.workspaceId);
  }
  if (options.episodeId) {
    conditions.push("episode_id = ?");
    params.push(options.episodeId);
  }
  if (options.exportType) {
    conditions.push("export_type = ?");
    params.push(options.exportType);
  }
  const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
  const rows = db.query(`
    select * from wiki_exports ${where} order by updated_at desc limit ?
  `).all(...params, normalizeLimit(options.limit)) as Array<Record<string, unknown>>;
  return rows.map(wikiExportFromRow);
}

function upsertWikiUpdateProposal(db: PodcastNoteDb, input: {
  id: string;
  workspaceId: string;
  episodeId: string;
  insightId?: string;
  targetPath: string;
  proposalType: WikiProposalType;
  title: string;
  rationale: string;
  patch: Record<string, unknown>;
  status: WikiProposalStatus;
}): WikiUpdateProposalRecord {
  db.query(`
    insert into wiki_update_proposals (
      id, workspace_id, episode_id, insight_id, target_path, proposal_type,
      title, rationale, patch_json, status
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      target_path = excluded.target_path,
      proposal_type = excluded.proposal_type,
      title = excluded.title,
      rationale = excluded.rationale,
      patch_json = excluded.patch_json,
      status = excluded.status,
      updated_at = datetime('now')
  `).run(
    input.id,
    input.workspaceId,
    input.episodeId,
    input.insightId ?? null,
    input.targetPath,
    input.proposalType,
    input.title,
    input.rationale,
    JSON.stringify(input.patch),
    input.status
  );
  const row = db.query("select * from wiki_update_proposals where id = ?").get(input.id) as Record<string, unknown> | null;
  if (!row) throw new Error(`Failed to upsert wiki proposal ${input.id}`);
  return wikiUpdateProposalFromRow(row);
}

function listWikiUpdateProposals(db: PodcastNoteDb, options: {
  workspaceId?: string;
  episodeId?: string;
  status?: WikiProposalStatus;
  limit?: number;
}): WikiUpdateProposalRecord[] {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.workspaceId) {
    conditions.push("workspace_id = ?");
    params.push(options.workspaceId);
  }
  if (options.episodeId) {
    conditions.push("episode_id = ?");
    params.push(options.episodeId);
  }
  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
  const rows = db.query(`
    select * from wiki_update_proposals ${where} order by updated_at desc limit ?
  `).all(...params, normalizeLimit(options.limit)) as Array<Record<string, unknown>>;
  return rows.map(wikiUpdateProposalFromRow);
}

function updateWikiUpdateProposalStatus(db: PodcastNoteDb, id: string, status: WikiProposalStatus): WikiUpdateProposalRecord | undefined {
  db.query(`
    update wiki_update_proposals set status = ?, updated_at = datetime('now') where id = ?
  `).run(status, id);
  const row = db.query("select * from wiki_update_proposals where id = ?").get(id) as Record<string, unknown> | null;
  return row ? wikiUpdateProposalFromRow(row) : undefined;
}

function createLarkBindSession(db: PodcastNoteDb, input: {
  id: string;
  workspaceId: string;
  agentId: string;
  stateHash: string;
  permissionPackage: string;
  terminalFingerprint?: string;
  verificationUrl: string;
  expiresAt: string;
  createdAt: string;
}): LarkBindSession {
  db.query(`
    insert into lark_bind_sessions (
      id, workspace_id, agent_id, state_hash, permission_package, terminal_fingerprint,
      status, verification_url, expires_at, created_at
    ) values (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(
    input.id,
    input.workspaceId,
    input.agentId,
    input.stateHash,
    input.permissionPackage,
    input.terminalFingerprint ?? null,
    input.verificationUrl,
    input.expiresAt,
    input.createdAt
  );
  const session = getLarkBindSession(db, input.id);
  if (!session) throw new Error(`Failed to create Lark bind session ${input.id}`);
  return session;
}

function getLarkBindSession(db: PodcastNoteDb, id: string): LarkBindSession | undefined {
  const row = db.query("select * from lark_bind_sessions where id = ?").get(id) as Record<string, unknown> | null;
  return row ? larkBindSessionFromRow(row) : undefined;
}

function getLarkBindSessionByStateHash(db: PodcastNoteDb, stateHash: string): LarkBindSession | undefined {
  const row = db.query("select * from lark_bind_sessions where state_hash = ?").get(stateHash) as Record<string, unknown> | null;
  return row ? larkBindSessionFromRow(row) : undefined;
}

function completeLarkBindSession(db: PodcastNoteDb, input: {
  id: string;
  connectionId: string;
  completedAt: string;
}): LarkBindSession {
  db.query(`
    update lark_bind_sessions
    set status = 'completed', connection_id = ?, completed_at = ?, error = null
    where id = ?
  `).run(input.connectionId, input.completedAt, input.id);
  const session = getLarkBindSession(db, input.id);
  if (!session) throw new Error(`Failed to complete Lark bind session ${input.id}`);
  return session;
}

function expireLarkBindSession(db: PodcastNoteDb, id: string, error?: string): LarkBindSession | undefined {
  db.query(`
    update lark_bind_sessions
    set status = 'expired', error = ?
    where id = ? and status = 'pending'
  `).run(error ?? "授权二维码已过期", id);
  return getLarkBindSession(db, id);
}

function createLarkConnection(db: PodcastNoteDb, input: {
  id: string;
  workspaceId: string;
  agentId: string;
  tenantKey: string;
  openId: string;
  unionId?: string;
  userName?: string;
  permissionPackage: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt?: string;
  createdAt: string;
}): LarkConnection {
  db.query(`
    insert into lark_connections (
      id, workspace_id, agent_id, tenant_key, open_id, union_id, user_name,
      permission_package, encrypted_access_token, encrypted_refresh_token,
      access_token_expires_at, refresh_token_expires_at, status, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    on conflict(id) do update set
      tenant_key = excluded.tenant_key,
      open_id = excluded.open_id,
      union_id = excluded.union_id,
      user_name = excluded.user_name,
      permission_package = excluded.permission_package,
      encrypted_access_token = excluded.encrypted_access_token,
      encrypted_refresh_token = excluded.encrypted_refresh_token,
      access_token_expires_at = excluded.access_token_expires_at,
      refresh_token_expires_at = excluded.refresh_token_expires_at,
      status = 'active',
      updated_at = excluded.updated_at,
      revoked_at = null
  `).run(
    input.id,
    input.workspaceId,
    input.agentId,
    input.tenantKey,
    input.openId,
    input.unionId ?? null,
    input.userName ?? null,
    input.permissionPackage,
    input.encryptedAccessToken,
    input.encryptedRefreshToken,
    input.accessTokenExpiresAt,
    input.refreshTokenExpiresAt ?? null,
    input.createdAt,
    input.createdAt
  );
  const connection = getLarkConnection(db, input.id);
  if (!connection) throw new Error(`Failed to create Lark connection ${input.id}`);
  return connection;
}

function getLarkConnection(db: PodcastNoteDb, id: string): LarkConnection | undefined {
  const row = db.query("select * from lark_connections where id = ?").get(id) as Record<string, unknown> | null;
  return row ? larkConnectionFromRow(row) : undefined;
}

function getLatestLarkConnectionForWorkspace(db: PodcastNoteDb, workspaceId: string): LarkConnection | undefined {
  const row = db.query(`
    select * from lark_connections
    where workspace_id = ? and status = 'active'
    order by updated_at desc, created_at desc
    limit 1
  `).get(workspaceId) as Record<string, unknown> | null;
  return row ? larkConnectionFromRow(row) : undefined;
}

function upsertLarkBotInstallation(db: PodcastNoteDb, input: {
  id: string;
  workspaceId: string;
  appId: string;
  tenantKey: string;
  chatId: string;
  chatName?: string;
  operatorOpenId?: string;
  installedAt: string;
}): LarkBotInstallation {
  db.query(`
    insert into lark_bot_installations (
      id, workspace_id, app_id, tenant_key, chat_id, chat_name, operator_open_id,
      status, installed_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    on conflict(workspace_id, app_id, chat_id) do update set
      tenant_key = excluded.tenant_key,
      chat_name = excluded.chat_name,
      operator_open_id = excluded.operator_open_id,
      status = 'active',
      updated_at = excluded.updated_at,
      disabled_at = null
  `).run(
    input.id,
    input.workspaceId,
    input.appId,
    input.tenantKey,
    input.chatId,
    input.chatName ?? null,
    input.operatorOpenId ?? null,
    input.installedAt,
    input.installedAt
  );
  const installation = getLatestLarkBotInstallationForWorkspace(db, input.workspaceId, input.appId);
  if (!installation) throw new Error(`Failed to upsert Lark bot installation for workspace ${input.workspaceId}`);
  return installation;
}

function getLatestLarkBotInstallationForWorkspace(db: PodcastNoteDb, workspaceId: string, appId?: string): LarkBotInstallation | undefined {
  const row = appId
    ? db.query(`
      select * from lark_bot_installations
      where workspace_id = ? and app_id = ? and status = 'active'
      order by updated_at desc, installed_at desc
      limit 1
    `).get(workspaceId, appId) as Record<string, unknown> | null
    : db.query(`
      select * from lark_bot_installations
      where workspace_id = ? and status = 'active'
      order by updated_at desc, installed_at desc
      limit 1
    `).get(workspaceId) as Record<string, unknown> | null;
  return row ? larkBotInstallationFromRow(row) : undefined;
}

function listActiveLarkBotInstallationsForWorkspace(db: PodcastNoteDb, workspaceId: string, appId?: string): LarkBotInstallation[] {
  const rows = appId
    ? db.query(`
      select * from lark_bot_installations
      where workspace_id = ? and app_id = ? and status = 'active'
      order by updated_at desc, installed_at desc
    `).all(workspaceId, appId) as Array<Record<string, unknown>>
    : db.query(`
      select * from lark_bot_installations
      where workspace_id = ? and status = 'active'
      order by updated_at desc, installed_at desc
    `).all(workspaceId) as Array<Record<string, unknown>>;
  return rows.map(larkBotInstallationFromRow);
}

function getLarkDeliveryRecord(db: PodcastNoteDb, input: {
  workspaceId: string;
  watchId: string;
  episodeId: string;
  chatId: string;
  deliveryType: LarkDeliveryType;
}): LarkDeliveryRecord | undefined {
  const row = db.query(`
    select * from lark_delivery_records
    where workspace_id = ? and watch_id = ? and episode_id = ? and chat_id = ? and delivery_type = ?
    limit 1
  `).get(input.workspaceId, input.watchId, input.episodeId, input.chatId, input.deliveryType) as Record<string, unknown> | null;
  return row ? larkDeliveryRecordFromRow(row) : undefined;
}

function getLarkDeliveryRecordByKey(db: PodcastNoteDb, input: {
  workspaceId: string;
  chatId: string;
  deliveryType: LarkDeliveryType;
  deliveryKey: string;
}): LarkDeliveryRecord | undefined {
  const row = db.query(`
    select * from lark_delivery_records
    where workspace_id = ? and chat_id = ? and delivery_type = ? and delivery_key = ?
    limit 1
  `).get(input.workspaceId, input.chatId, input.deliveryType, input.deliveryKey) as Record<string, unknown> | null;
  return row ? larkDeliveryRecordFromRow(row) : undefined;
}

function createLarkDeliveryRecord(db: PodcastNoteDb, input: {
  workspaceId: string;
  watchId: string;
  episodeId: string;
  chatId: string;
  deliveryType: LarkDeliveryType;
  providerMessageId: string;
  deliveredAt?: string;
}): LarkDeliveryRecord {
  const deliveredAt = input.deliveredAt ?? new Date().toISOString();
  const id = stableId("lark_delivery", `${input.workspaceId}:${input.watchId}:${input.episodeId}:${input.chatId}:${input.deliveryType}`);
  db.query(`
    insert into lark_delivery_records (
      id, workspace_id, watch_id, episode_id, chat_id, delivery_type, delivery_key, provider_message_id, delivered_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(workspace_id, watch_id, episode_id, chat_id, delivery_type) do nothing
  `).run(
    id,
    input.workspaceId,
    input.watchId,
    input.episodeId,
    input.chatId,
    input.deliveryType,
    null,
    input.providerMessageId,
    deliveredAt
  );
  const record = getLarkDeliveryRecord(db, input);
  if (!record) throw new Error(`Failed to create Lark delivery record for episode ${input.episodeId}`);
  return record;
}

function createLarkDeliveryRecordByKey(db: PodcastNoteDb, input: {
  workspaceId: string;
  chatId: string;
  deliveryType: LarkDeliveryType;
  deliveryKey: string;
  providerMessageId: string;
  deliveredAt?: string;
}): LarkDeliveryRecord {
  const deliveredAt = input.deliveredAt ?? new Date().toISOString();
  const id = stableId("lark_delivery", `${input.workspaceId}:${input.chatId}:${input.deliveryType}:${input.deliveryKey}`);
  db.query(`
    insert into lark_delivery_records (
      id, workspace_id, watch_id, episode_id, chat_id, delivery_type, delivery_key, provider_message_id, delivered_at
    ) values (?, ?, null, null, ?, ?, ?, ?, ?)
    on conflict(workspace_id, chat_id, delivery_type, delivery_key) do nothing
  `).run(
    id,
    input.workspaceId,
    input.chatId,
    input.deliveryType,
    input.deliveryKey,
    input.providerMessageId,
    deliveredAt
  );
  const record = getLarkDeliveryRecordByKey(db, input);
  if (!record) throw new Error(`Failed to create Lark delivery record for key ${input.deliveryKey}`);
  return record;
}

function createLarkPendingIntent(db: PodcastNoteDb, input: {
  workspaceId: string;
  chatId: string;
  senderOpenId?: string;
  intentType: string;
  intent: Record<string, unknown>;
  expiresAt: string;
  createdAt?: string;
}): LarkPendingIntent {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const id = stableId("lark_pending", `${input.workspaceId}:${input.chatId}:${input.senderOpenId ?? ""}:${input.intentType}:${createdAt}`);
  db.query(`
    insert into lark_pending_intents (
      id, workspace_id, chat_id, sender_open_id, intent_type, intent_json,
      status, expires_at, created_at
    ) values (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    id,
    input.workspaceId,
    input.chatId,
    input.senderOpenId ?? null,
    input.intentType,
    JSON.stringify(input.intent),
    input.expiresAt,
    createdAt
  );
  const intent = db.query("select * from lark_pending_intents where id = ?").get(id) as Record<string, unknown> | null;
  if (!intent) throw new Error(`Failed to create Lark pending intent ${id}`);
  return larkPendingIntentFromRow(intent);
}

function getLatestPendingLarkIntent(db: PodcastNoteDb, input: {
  workspaceId: string;
  chatId: string;
  senderOpenId?: string;
  now?: string;
}): LarkPendingIntent | undefined {
  expireLarkPendingIntents(db, input.now);
  const params: unknown[] = [input.workspaceId, input.chatId];
  let senderFilter = "";
  if (input.senderOpenId) {
    senderFilter = "and (sender_open_id = ? or sender_open_id is null)";
    params.push(input.senderOpenId);
  }
  const row = db.query(`
    select * from lark_pending_intents
    where workspace_id = ?
      and chat_id = ?
      and status = 'pending'
      ${senderFilter}
    order by created_at desc
    limit 1
  `).get(...params) as Record<string, unknown> | null;
  return row ? larkPendingIntentFromRow(row) : undefined;
}

function completeLarkPendingIntent(db: PodcastNoteDb, id: string, completedAt?: string): LarkPendingIntent | undefined {
  db.query(`
    update lark_pending_intents
    set status = 'completed', completed_at = ?, error = null
    where id = ? and status = 'pending'
  `).run(completedAt ?? new Date().toISOString(), id);
  const row = db.query("select * from lark_pending_intents where id = ?").get(id) as Record<string, unknown> | null;
  return row ? larkPendingIntentFromRow(row) : undefined;
}

function cancelLarkPendingIntent(db: PodcastNoteDb, id: string, completedAt?: string, error?: string): LarkPendingIntent | undefined {
  db.query(`
    update lark_pending_intents
    set status = 'cancelled', completed_at = ?, error = ?
    where id = ? and status = 'pending'
  `).run(completedAt ?? new Date().toISOString(), error ?? null, id);
  const row = db.query("select * from lark_pending_intents where id = ?").get(id) as Record<string, unknown> | null;
  return row ? larkPendingIntentFromRow(row) : undefined;
}

function expireLarkPendingIntents(db: PodcastNoteDb, now?: string): number {
  const result = db.query(`
    update lark_pending_intents
    set status = 'expired', completed_at = ?, error = 'pending intent expired'
    where status = 'pending' and datetime(expires_at) <= datetime(?)
  `).run(now ?? new Date().toISOString(), now ?? new Date().toISOString());
  return result.changes;
}

function upsertUser(db: PodcastNoteDb, input: { id: string; email?: string; name?: string; timezone?: string }): User {
  const user: User = {
    id: input.id,
    email: input.email,
    name: input.name,
    timezone: input.timezone ?? "Asia/Shanghai"
  };

  db.query(`
    insert into users (id, email, name, timezone, updated_at)
    values (?, ?, ?, ?, datetime('now'))
    on conflict(id) do update set
      email = excluded.email,
      name = excluded.name,
      timezone = excluded.timezone,
      updated_at = datetime('now')
  `).run(user.id, user.email ?? null, user.name ?? null, user.timezone);

  return user;
}

function getUser(db: PodcastNoteDb, id: string): User | undefined {
  const row = db.query("select * from users where id = ?").get(id) as Record<string, unknown> | null;
  return row ? userFromRow(row) : undefined;
}

function ensurePersonalWorkspaceForUser(db: PodcastNoteDb, userId: string): Workspace {
  const existing = db.query("select * from workspaces where owner_user_id = ? and type = 'personal'").get(userId) as Record<string, unknown> | null;
  if (existing) return workspaceFromRow(existing);

  const user = getUser(db, userId);
  if (!user) {
    throw new Error(`Cannot create personal workspace for missing user: ${userId}`);
  }

  const workspace: Workspace = {
    id: stableId("workspace", `${userId}:personal`),
    ownerUserId: userId,
    name: user.name ? `${user.name}'s Personal Workspace` : "Personal Workspace",
    type: "personal"
  };

  db.query(`
    insert into workspaces (id, owner_user_id, name, type, updated_at)
    values (?, ?, ?, 'personal', datetime('now'))
    on conflict(owner_user_id, type) do update set
      name = excluded.name,
      updated_at = datetime('now')
  `).run(workspace.id, workspace.ownerUserId, workspace.name);

  const created = getWorkspace(db, workspace.id);
  if (!created) {
    throw new Error(`Failed to create personal workspace for user: ${userId}`);
  }
  return created;
}

function getWorkspace(db: PodcastNoteDb, id: string): Workspace | undefined {
  const row = db.query("select * from workspaces where id = ?").get(id) as Record<string, unknown> | null;
  return row ? workspaceFromRow(row) : undefined;
}

function listWatchesForWorkspace(db: PodcastNoteDb, workspaceId: string): Watch[] {
  const rows = db.query("select * from watches where workspace_id = ? order by updated_at desc").all(workspaceId) as Array<Record<string, unknown>>;
  return rows.map(watchFromRow);
}

function listEnabledWatchesForWorkspace(db: PodcastNoteDb, workspaceId: string): Watch[] {
  const rows = db.query(`
    select * from watches
    where workspace_id = ? and enabled = 1
    order by updated_at desc
  `).all(workspaceId) as Array<Record<string, unknown>>;
  return rows.map(watchFromRow);
}

function listEnabledWatches(db: PodcastNoteDb, workspaceId?: string): Watch[] {
  const params: unknown[] = [];
  const conditions = ["enabled = 1"];
  if (workspaceId) {
    conditions.push("workspace_id = ?");
    params.push(workspaceId);
  }
  const rows = db.query(`
    select * from watches
    where ${conditions.join(" and ")}
    order by updated_at desc
  `).all(...params) as Array<Record<string, unknown>>;
  return rows.map(watchFromRow);
}

function createWatchForWorkspace(db: PodcastNoteDb, workspaceId: string, input: CreateWatchInput): Watch {
  if (!getWorkspace(db, workspaceId)) {
    throw new Error(`Cannot create watch for missing workspace: ${workspaceId}`);
  }

  const watch: Watch = {
    id: input.id ?? stableId("watch", `${workspaceId}:${input.type}:${input.query}:${input.name}`),
    workspaceId,
    name: input.name,
    type: input.type,
    query: input.query,
    outputLanguage: input.outputLanguage,
    includeTerms: input.includeTerms,
    excludeTerms: input.excludeTerms,
    expandedTerms: input.expandedTerms ?? [],
    minRelevanceScore: input.minRelevanceScore,
    frequency: input.frequency,
    backfillDays: input.backfillDays,
    enabled: input.enabled ?? true
  };
  return upsertWatch(db, watch);
}

function getWatchForWorkspace(db: PodcastNoteDb, workspaceId: string, watchId: string): Watch | undefined {
  const row = db.query("select * from watches where workspace_id = ? and id = ?").get(workspaceId, watchId) as Record<string, unknown> | null;
  return row ? watchFromRow(row) : undefined;
}

function updateWatchForWorkspace(db: PodcastNoteDb, workspaceId: string, watchId: string, patch: UpdateWatchInput): Watch | undefined {
  const current = getWatchForWorkspace(db, workspaceId, watchId);
  if (!current) return undefined;
  const next: Watch = {
    ...current,
    ...patch,
    id: current.id,
    workspaceId: current.workspaceId,
    includeTerms: patch.includeTerms ?? current.includeTerms,
    excludeTerms: patch.excludeTerms ?? current.excludeTerms,
    expandedTerms: patch.expandedTerms ?? current.expandedTerms,
    enabled: patch.enabled ?? current.enabled
  };
  return upsertWatch(db, next);
}

function deleteWatchForWorkspace(db: PodcastNoteDb, workspaceId: string, watchId: string): boolean {
  const result = db.query("delete from watches where workspace_id = ? and id = ?").run(workspaceId, watchId);
  return result.changes > 0;
}

function recordWatchPoll(db: PodcastNoteDb, watchId: string, input: {
  checkedAt: string;
  status: WatchPollStatus;
  candidateCount?: number;
  queuedCount?: number;
  error?: string;
}): WatchPoll {
  const id = stableId("poll", `${watchId}:${input.checkedAt}`);
  const poll: WatchPoll = {
    id,
    watchId,
    checkedAt: input.checkedAt,
    status: input.status,
    candidateCount: input.candidateCount ?? 0,
    queuedCount: input.queuedCount ?? 0,
    error: input.error
  };

  db.query(`
    insert into watch_polls (
      id, watch_id, checked_at, status, candidate_count, queued_count, error
    ) values (?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      checked_at = excluded.checked_at,
      status = excluded.status,
      candidate_count = excluded.candidate_count,
      queued_count = excluded.queued_count,
      error = excluded.error
  `).run(
    poll.id,
    poll.watchId,
    poll.checkedAt,
    poll.status,
    poll.candidateCount,
    poll.queuedCount,
    poll.error ?? null
  );

  return poll;
}

function getLatestWatchPoll(db: PodcastNoteDb, watchId: string): WatchPoll | undefined {
  const row = db.query(`
    select * from watch_polls
    where watch_id = ?
    order by checked_at desc, id desc
    limit 1
  `).get(watchId) as Record<string, unknown> | null;
  return row ? watchPollFromRow(row) : undefined;
}

function listDueWatches(db: PodcastNoteDb, options: { now: string; workspaceId?: string }): DueWatch[] {
  const nowMs = Date.parse(options.now);
  if (!Number.isFinite(nowMs)) {
    throw new Error(`Invalid scheduler now timestamp: ${options.now}`);
  }

  return listEnabledWatches(db, options.workspaceId)
    .map((watch): DueWatch | undefined => {
      const lastPoll = getLatestWatchPoll(db, watch.id);
      if (!lastPoll) {
        return {
          watch,
          now: options.now,
          since: isoDaysBefore(options.now, watch.backfillDays),
          reason: "never_polled"
        };
      }

      const lastPollMs = Date.parse(lastPoll.checkedAt);
      if (!Number.isFinite(lastPollMs)) {
        throw new Error(`Invalid watch poll timestamp for ${watch.id}: ${lastPoll.checkedAt}`);
      }
      if (nowMs - lastPollMs < frequencyIntervalMs(watch.frequency)) {
        return undefined;
      }
      return {
        watch,
        lastPoll,
        now: options.now,
        since: lastPoll.checkedAt,
        reason: "frequency_elapsed"
      };
    })
    .filter((item): item is DueWatch => item !== undefined)
    .sort((a, b) => a.watch.id.localeCompare(b.watch.id));
}

function planPollingJobs(db: PodcastNoteDb, options: { now: string; workspaceId?: string }): PollingJobInput[] {
  return listDueWatches(db, options).map((item) => ({
    id: stableId("polljob", `${item.watch.id}:${item.since}:${item.now}`),
    workspaceId: item.watch.workspaceId,
    watchId: item.watch.id,
    watchType: item.watch.type,
    query: item.watch.query,
    frequency: item.watch.frequency,
    since: item.since,
    now: item.now,
    reason: item.reason
  }));
}

function frequencyIntervalMs(frequency: Watch["frequency"]): number {
  switch (frequency) {
    case "realtime":
      return 60 * 60 * 1000;
    case "daily":
      return 24 * 60 * 60 * 1000;
    case "weekly":
      return 7 * 24 * 60 * 60 * 1000;
  }
}

function isoDaysBefore(now: string, days: number): string {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) {
    throw new Error(`Invalid scheduler now timestamp: ${now}`);
  }
  const safeDays = Number.isFinite(days) && days > 0 ? days : 30;
  return new Date(nowMs - safeDays * 24 * 60 * 60 * 1000).toISOString();
}

function startProcessingRun(db: PodcastNoteDb, input: { watchId: string; sources: string[] }): string {
  const id = stableId("run", `${input.watchId}:${input.sources.join("\n")}:${Date.now()}`);
  db.query(`
    insert into processing_runs (id, watch_id, input_sources_json, status)
    values (?, ?, ?, 'running')
  `).run(id, input.watchId, JSON.stringify(input.sources));
  return id;
}

function completeProcessingRun(db: PodcastNoteDb, runId: string): void {
  db.query(`
    update processing_runs
    set status = 'completed', finished_at = datetime('now'), error = null
    where id = ?
  `).run(runId);
}

function failProcessingRun(db: PodcastNoteDb, runId: string, error: string): void {
  db.query(`
    update processing_runs
    set status = 'failed', finished_at = datetime('now'), error = ?
    where id = ?
  `).run(error, runId);
}

function updateEpisodeProcessingStatus(db: PodcastNoteDb, input: {
  runId: string;
  episodeId: string;
  sourceUrl: string;
  stage: ProcessingStage;
  status: ProcessingStatus;
  error?: string;
}): void {
  db.query(`
    insert into processing_episode_statuses (
      run_id, episode_id, source_url, stage, status, error, updated_at
    ) values (?, ?, ?, ?, ?, ?, datetime('now'))
    on conflict(run_id, episode_id) do update set
      source_url = excluded.source_url,
      stage = excluded.stage,
      status = excluded.status,
      error = excluded.error,
      updated_at = datetime('now')
  `).run(
    input.runId,
    input.episodeId,
    input.sourceUrl,
    input.stage,
    input.status,
    input.error ?? null
  );
}

function getProcessingRun(db: PodcastNoteDb, runId: string): Record<string, unknown> | undefined {
  const run = db.query("select * from processing_runs where id = ?").get(runId) as Record<string, unknown> | null;
  if (!run) return undefined;
  const episodes = db.query(`
    select * from processing_episode_statuses where run_id = ? order by updated_at asc
  `).all(runId) as Array<Record<string, unknown>>;
  return {
    ...run,
    episodes
  };
}

function upsertWatch(db: PodcastNoteDb, watch: Watch): Watch {
  db.query(`
    insert into watches (
      id, workspace_id, name, type, query, output_language, include_terms_json,
      exclude_terms_json, expanded_terms_json, min_relevance_score, frequency, backfill_days, enabled, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    on conflict(id) do update set
      workspace_id = excluded.workspace_id,
      name = excluded.name,
      type = excluded.type,
      query = excluded.query,
      output_language = excluded.output_language,
      include_terms_json = excluded.include_terms_json,
      exclude_terms_json = excluded.exclude_terms_json,
      expanded_terms_json = excluded.expanded_terms_json,
      min_relevance_score = excluded.min_relevance_score,
      frequency = excluded.frequency,
      backfill_days = excluded.backfill_days,
      enabled = excluded.enabled,
      updated_at = datetime('now')
  `).run(
    watch.id,
    watch.workspaceId,
    watch.name,
    watch.type,
    watch.query,
    watch.outputLanguage,
    JSON.stringify(watch.includeTerms),
    JSON.stringify(watch.excludeTerms),
    JSON.stringify(watch.expandedTerms),
    watch.minRelevanceScore,
    watch.frequency,
    watch.backfillDays,
    watch.enabled ? 1 : 0
  );
  return watch;
}

function upsertSource(db: PodcastNoteDb, source: Source): Source {
  db.query(`
    insert into sources (
      id, type, url, canonical_url, external_id, title, author, language, metadata_json, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    on conflict(type, url) do update set
      canonical_url = excluded.canonical_url,
      external_id = excluded.external_id,
      title = excluded.title,
      author = excluded.author,
      language = excluded.language,
      metadata_json = excluded.metadata_json,
      updated_at = datetime('now')
  `).run(
    source.id,
    source.type,
    source.url,
    source.canonicalUrl ?? null,
    source.externalId ?? null,
    source.title ?? null,
    source.author ?? null,
    source.language ?? null,
    "{}"
  );
  return source;
}

function findSourceByTitle(db: PodcastNoteDb, title: string): Source | undefined {
  const normalized = title.trim();
  if (!normalized) return undefined;
  const row = db.query(`
    select * from sources
    where title = ?
       or lower(title) = lower(?)
    order by updated_at desc
    limit 1
  `).get(normalized, normalized) as Record<string, unknown> | null;
  return row ? sourceFromRow(row) : undefined;
}

function upsertEpisode(db: PodcastNoteDb, episode: Episode): Episode {
  db.query(`
    insert into episodes (
      id, source_id, guid, title, description, published_at, duration_sec,
      audio_url, page_url, language, checksum, metadata_json, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    on conflict(id) do update set
      source_id = excluded.source_id,
      guid = excluded.guid,
      title = excluded.title,
      description = excluded.description,
      published_at = excluded.published_at,
      duration_sec = excluded.duration_sec,
      audio_url = excluded.audio_url,
      page_url = excluded.page_url,
      language = excluded.language,
      checksum = excluded.checksum,
      metadata_json = excluded.metadata_json,
      updated_at = datetime('now')
  `).run(
    episode.id,
    episode.sourceId ?? null,
    episode.guid ?? null,
    episode.title,
    episode.description ?? null,
    episode.publishedAt ?? null,
    episode.durationSec ?? null,
    episode.audioUrl ?? null,
    episode.pageUrl,
    episode.language ?? null,
    episode.checksum ?? null,
    JSON.stringify(episode.metadata ?? {})
  );
  return episode;
}

function enqueueEpisodeProcessingJob(db: PodcastNoteDb, input: {
  workspaceId: string;
  watchId: string;
  episodeId: string;
  sourceUrl: string;
  queuedAt?: string;
  relevanceScore?: number;
  relevanceReason?: Record<string, unknown>;
}): EpisodeProcessingJob {
  const id = stableId("epjob", `${input.workspaceId}:${input.watchId}:${input.episodeId}`);
  const queuedAt = input.queuedAt ?? new Date().toISOString();
  db.query(`
    insert into episode_processing_jobs (
      id, workspace_id, watch_id, episode_id, source_url, status, relevance_score,
      relevance_reason_json, queued_at, updated_at
    ) values (?, ?, ?, ?, ?, 'queued', ?, ?, ?, datetime('now'))
    on conflict(workspace_id, watch_id, episode_id) do update set
      source_url = excluded.source_url,
      relevance_score = excluded.relevance_score,
      relevance_reason_json = excluded.relevance_reason_json,
      queued_at = case
        when episode_processing_jobs.status in ('completed', 'running') then episode_processing_jobs.queued_at
        else excluded.queued_at
      end,
      status = case
        when episode_processing_jobs.status in ('completed', 'running') then episode_processing_jobs.status
        else 'queued'
      end,
      error = case
        when episode_processing_jobs.status in ('completed', 'running') then episode_processing_jobs.error
        else null
      end,
      started_at = case
        when episode_processing_jobs.status in ('completed', 'running') then episode_processing_jobs.started_at
        else null
      end,
      finished_at = case
        when episode_processing_jobs.status in ('completed', 'running') then episode_processing_jobs.finished_at
        else null
      end,
      processing_run_id = case
        when episode_processing_jobs.status in ('completed', 'running') then episode_processing_jobs.processing_run_id
        else null
      end,
      updated_at = datetime('now')
  `).run(
    id,
    input.workspaceId,
    input.watchId,
    input.episodeId,
    input.sourceUrl,
    input.relevanceScore ?? null,
    JSON.stringify(input.relevanceReason ?? {}),
    queuedAt
  );
  const job = db.query("select * from episode_processing_jobs where id = ?").get(id) as Record<string, unknown> | null;
  if (!job) throw new Error(`Failed to enqueue episode processing job ${id}`);
  return episodeProcessingJobFromRow(job);
}

function getEpisodeProcessingJob(db: PodcastNoteDb, id: string): EpisodeProcessingJob | undefined {
  const row = db.query("select * from episode_processing_jobs where id = ?").get(id) as Record<string, unknown> | null;
  return row ? episodeProcessingJobFromRow(row) : undefined;
}

function listQueuedEpisodeProcessingJobs(db: PodcastNoteDb, options: { workspaceId?: string; limit?: number }): EpisodeProcessingJob[] {
  const params: unknown[] = [];
  let where = "status = 'queued'";
  if (options.workspaceId) {
    where += " and workspace_id = ?";
    params.push(options.workspaceId);
  }
  const rows = db.query(`
    select * from episode_processing_jobs
    where ${where}
    order by queued_at asc, id asc
    limit ?
  `).all(...params, normalizeLimit(options.limit)) as Array<Record<string, unknown>>;
  return rows.map(episodeProcessingJobFromRow);
}

function countEpisodeProcessingJobsByStatus(db: PodcastNoteDb, workspaceId?: string): Record<EpisodeProcessingJobStatus, number> {
  const rows = workspaceId
    ? db.query("select status, count(*) as count from episode_processing_jobs where workspace_id = ? group by status").all(workspaceId) as Array<Record<string, unknown>>
    : db.query("select status, count(*) as count from episode_processing_jobs group by status").all() as Array<Record<string, unknown>>;
  const counts: Record<EpisodeProcessingJobStatus, number> = { queued: 0, running: 0, completed: 0, failed: 0 };
  for (const row of rows) {
    const status = String(row["status"]) as EpisodeProcessingJobStatus;
    if (status in counts) counts[status] = Number(row["count"] ?? 0);
  }
  return counts;
}

function retryFailedEpisodeProcessingJobsForWorkspace(db: PodcastNoteDb, workspaceId: string): number {
  const result = db.query(`
    update episode_processing_jobs
    set status = 'queued',
      queued_at = ?,
      processing_run_id = null,
      error = null,
      started_at = null,
      finished_at = null,
      updated_at = datetime('now')
    where workspace_id = ?
      and status = 'failed'
  `).run(new Date().toISOString(), workspaceId);
  return result.changes;
}

function claimEpisodeProcessingJob(db: PodcastNoteDb, id: string): EpisodeProcessingJob | undefined {
  const result = db.query(`
    update episode_processing_jobs
    set status = 'running', attempts = attempts + 1, started_at = datetime('now'), error = null, updated_at = datetime('now')
    where id = ? and status = 'queued'
  `).run(id);
  if (result.changes === 0) return undefined;
  return getEpisodeProcessingJob(db, id);
}

function attachProcessingRunToJob(db: PodcastNoteDb, id: string, runId: string): void {
  db.query(`
    update episode_processing_jobs
    set processing_run_id = ?, updated_at = datetime('now')
    where id = ?
  `).run(runId, id);
}

function completeEpisodeProcessingJob(db: PodcastNoteDb, id: string): void {
  db.query(`
    update episode_processing_jobs
    set status = 'completed', finished_at = datetime('now'), error = null, updated_at = datetime('now')
    where id = ?
  `).run(id);
}

function failEpisodeProcessingJob(db: PodcastNoteDb, id: string, error: string): void {
  db.query(`
    update episode_processing_jobs
    set status = 'failed', finished_at = datetime('now'), error = ?, updated_at = datetime('now')
    where id = ?
  `).run(error, id);
}

function requeueStaleEpisodeProcessingJobs(db: PodcastNoteDb, options: {
  workspaceId?: string;
  staleBefore: string;
  error: string;
  maxAttempts?: number;
  jobIds?: string[];
}): number {
  const maxAttempts = options.maxAttempts ?? Number.MAX_SAFE_INTEGER;
  const staleParams: unknown[] = [options.staleBefore];
  let workspaceFilter = "";
  if (options.workspaceId) {
    workspaceFilter = "and workspace_id = ?";
    staleParams.push(options.workspaceId);
  }
  let jobFilter = "";
  if (options.jobIds?.length) {
    jobFilter = `and id in (${options.jobIds.map(() => "?").join(", ")})`;
    staleParams.push(...options.jobIds);
  }
  const staleJobs = db.query(`
    select id, processing_run_id, attempts
    from episode_processing_jobs
    where status = 'running'
      and started_at is not null
      and datetime(started_at) < datetime(?)
      ${workspaceFilter}
      ${jobFilter}
  `).all(...staleParams) as Array<Record<string, unknown>>;
  if (staleJobs.length === 0) return 0;

  const runIds = staleJobs
    .map((row) => nullableString(row["processing_run_id"]))
    .filter((runId) => runId !== undefined);
  for (const runId of runIds) {
    failProcessingRun(db, runId, options.error);
    db.query(`
      update processing_episode_statuses
      set stage = 'failed', status = 'failed', error = ?, updated_at = datetime('now')
      where run_id = ?
    `).run(options.error, runId);
  }

  const cappedIds = staleJobs
    .filter((row) => Number(row["attempts"] ?? 0) >= maxAttempts)
    .map((row) => String(row["id"]));
  const retryableIds = staleJobs
    .filter((row) => Number(row["attempts"] ?? 0) < maxAttempts)
    .map((row) => String(row["id"]));

  for (const id of cappedIds) {
    db.query(`
      update episode_processing_jobs
      set status = 'failed',
        error = ?,
        finished_at = datetime('now'),
        updated_at = datetime('now')
      where id = ?
    `).run(`${options.error} Automatic retry limit reached.`, id);
  }

  for (const id of retryableIds) {
    db.query(`
      update episode_processing_jobs
      set status = 'queued',
        processing_run_id = null,
        error = ?,
        started_at = null,
        finished_at = null,
        updated_at = datetime('now')
      where id = ?
    `).run(options.error, id);
  }
  return retryableIds.length;
}

function recordDailyBrief(db: PodcastNoteDb, input: {
  workspaceId: string;
  userId: string;
  briefDate: string;
  timezone: string;
  status: DailyBriefStatus;
  insightCount?: number;
  subject?: string;
  providerMessageId?: string;
  error?: string;
  sentAt?: string;
}): DailyBrief {
  const id = stableId("brief", `${input.workspaceId}:${input.userId}:${input.briefDate}`);
  db.query(`
    insert into daily_briefs (
      id, workspace_id, user_id, brief_date, timezone, status, insight_count,
      subject, provider_message_id, error, sent_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(workspace_id, user_id, brief_date) do update set
      timezone = excluded.timezone,
      status = excluded.status,
      insight_count = excluded.insight_count,
      subject = excluded.subject,
      provider_message_id = excluded.provider_message_id,
      error = excluded.error,
      sent_at = excluded.sent_at,
      updated_at = datetime('now')
  `).run(
    id,
    input.workspaceId,
    input.userId,
    input.briefDate,
    input.timezone,
    input.status,
    input.insightCount ?? 0,
    input.subject ?? null,
    input.providerMessageId ?? null,
    input.error ?? null,
    input.sentAt ?? null
  );
  const brief = getDailyBrief(db, input.workspaceId, input.userId, input.briefDate);
  if (!brief) throw new Error(`Failed to record daily brief ${id}`);
  return brief;
}

function getDailyBrief(db: PodcastNoteDb, workspaceId: string, userId: string, briefDate: string): DailyBrief | undefined {
  const row = db.query(`
    select * from daily_briefs where workspace_id = ? and user_id = ? and brief_date = ?
  `).get(workspaceId, userId, briefDate) as Record<string, unknown> | null;
  return row ? dailyBriefFromRow(row) : undefined;
}

function listDailyBriefs(db: PodcastNoteDb, options: { workspaceId?: string; userId?: string; limit?: number }): DailyBrief[] {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.workspaceId) {
    conditions.push("workspace_id = ?");
    params.push(options.workspaceId);
  }
  if (options.userId) {
    conditions.push("user_id = ?");
    params.push(options.userId);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const rows = db.query(`
    select * from daily_briefs ${where} order by brief_date desc limit ?
  `).all(...params, normalizeLimit(options.limit)) as Array<Record<string, unknown>>;
  return rows.map(dailyBriefFromRow);
}

function listInsightsForDailyBrief(db: PodcastNoteDb, options: { workspaceId: string; since: string; until: string; limit?: number }): Array<Insight & { episodeTitle: string; episodePageUrl: string; watchName: string; createdAt: string }> {
  const rows = db.query(`
    select
      i.*,
      i.created_at as insight_created_at,
      e.title as episode_title,
      e.page_url as episode_page_url,
      w.name as watch_name
    from insights i
    join episodes e on e.id = i.episode_id
    join watches w on w.id = i.watch_id
    where i.workspace_id = ?
      and i.status = 'published'
      and i.created_at >= ?
      and i.created_at < ?
    order by i.relevance_score desc, i.created_at desc
    limit ?
  `).all(options.workspaceId, options.since, options.until, normalizeLimit(options.limit)) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    ...insightFromRow(row),
    episodeTitle: String(row["episode_title"]),
    episodePageUrl: String(row["episode_page_url"]),
    watchName: String(row["watch_name"]),
    createdAt: String(row["insight_created_at"])
  }));
}

function createSession(db: PodcastNoteDb, input: {
  userId: string;
  workspaceId: string;
  token: string;
  expiresAt: string;
  createdAt?: string;
}): Session {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const id = stableId("session", `${input.userId}:${input.workspaceId}:${input.token}`);
  db.query(`
    insert into sessions (id, user_id, workspace_id, token, created_at, expires_at)
    values (?, ?, ?, ?, ?, ?)
    on conflict(token) do update set
      user_id = excluded.user_id,
      workspace_id = excluded.workspace_id,
      expires_at = excluded.expires_at,
      revoked_at = null
  `).run(id, input.userId, input.workspaceId, input.token, createdAt, input.expiresAt);
  const row = db.query("select * from sessions where token = ?").get(input.token) as Record<string, unknown> | null;
  if (!row) throw new Error(`Failed to create session ${id}`);
  return sessionFromRow(row);
}

function getSessionByToken(db: PodcastNoteDb, token: string, now = new Date().toISOString()): HydratedSession | undefined {
  const row = db.query(`
    select
      s.*,
      u.id as user_id_joined,
      u.email as user_email,
      u.name as user_name,
      u.timezone as user_timezone,
      w.id as workspace_id_joined,
      w.owner_user_id as workspace_owner_user_id,
      w.name as workspace_name,
      w.type as workspace_type
    from sessions s
    join users u on u.id = s.user_id
    join workspaces w on w.id = s.workspace_id
    where s.token = ?
      and s.revoked_at is null
      and s.expires_at > ?
  `).get(token, now) as Record<string, unknown> | null;
  if (!row) return undefined;
  const session = sessionFromRow(row);
  return {
    ...session,
    user: {
      id: String(row["user_id_joined"]),
      email: nullableString(row["user_email"]),
      name: nullableString(row["user_name"]),
      timezone: nullableString(row["user_timezone"]) ?? "Asia/Shanghai"
    },
    workspace: {
      id: String(row["workspace_id_joined"]),
      ownerUserId: String(row["workspace_owner_user_id"]),
      name: String(row["workspace_name"]),
      type: "personal"
    }
  };
}

function revokeSession(db: PodcastNoteDb, id: string, revokedAt = new Date().toISOString()): void {
  db.query("update sessions set revoked_at = ? where id = ?").run(revokedAt, id);
}

function recordUsageEvent(db: PodcastNoteDb, input: {
  workspaceId: string;
  userId: string;
  sessionId?: string;
  eventType: UsageEventType;
  entityType: UsageEntityType;
  entityId?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}): UsageEvent {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const id = stableId("usage", `${input.workspaceId}:${input.userId}:${input.eventType}:${input.entityType}:${input.entityId ?? ""}:${occurredAt}`);
  db.query(`
    insert into usage_events (
      id, workspace_id, user_id, session_id, event_type, entity_type, entity_id, metadata_json, occurred_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.workspaceId,
    input.userId,
    input.sessionId ?? null,
    input.eventType,
    input.entityType,
    input.entityId ?? null,
    JSON.stringify(input.metadata ?? {}),
    occurredAt
  );
  const row = db.query("select * from usage_events where id = ?").get(id) as Record<string, unknown> | null;
  if (!row) throw new Error(`Failed to record usage event ${id}`);
  return usageEventFromRow(row);
}

function listUsageEvents(db: PodcastNoteDb, options: { workspaceId?: string; userId?: string; entityType?: UsageEntityType; limit?: number }): UsageEvent[] {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.workspaceId) {
    conditions.push("workspace_id = ?");
    params.push(options.workspaceId);
  }
  if (options.userId) {
    conditions.push("user_id = ?");
    params.push(options.userId);
  }
  if (options.entityType) {
    conditions.push("entity_type = ?");
    params.push(options.entityType);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const rows = db.query(`
    select * from usage_events ${where}
    order by occurred_at desc, id desc
    limit ?
  `).all(...params, normalizeLimit(options.limit)) as Array<Record<string, unknown>>;
  return rows.map(usageEventFromRow);
}

function saveTranscript(db: PodcastNoteDb, input: {
  episodeId: string;
  provider: string;
  model: string;
  transcript: TranscriptionOutput;
}): StoredTranscript {
  const id = stableId("tr", `${input.episodeId}:${input.provider}:${input.model}`);
  const save = db.transaction(() => {
    db.query(`
      insert into transcripts (
        id, episode_id, provider, model, language, segments_json, confidence, duration_sec
      ) values (?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(episode_id, provider, model) do update set
        language = excluded.language,
        segments_json = excluded.segments_json,
        confidence = excluded.confidence,
        duration_sec = excluded.duration_sec
    `).run(
      id,
      input.episodeId,
      input.provider,
      input.model,
      input.transcript.language ?? null,
      JSON.stringify(input.transcript.segments),
      input.transcript.confidence ?? null,
      input.transcript.durationSec ?? null
    );

    db.query("delete from episode_segments where transcript_id = ?").run(id);
    for (const [index, segment] of input.transcript.segments.entries()) {
      db.query(`
        insert into episode_segments (
          id, episode_id, transcript_id, segment_index, start_sec, end_sec, speaker, text
        ) values (?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(episode_id, segment_index) do update set
          transcript_id = excluded.transcript_id,
          start_sec = excluded.start_sec,
          end_sec = excluded.end_sec,
          speaker = excluded.speaker,
          text = excluded.text
      `).run(
        stableId("seg", `${input.episodeId}:${index}:${segment.startSec}:${segment.endSec}`),
        input.episodeId,
        id,
        index,
        segment.startSec,
        segment.endSec,
        segment.speaker ?? null,
        segment.text
      );
    }
  });
  save();

  return {
    id,
    episodeId: input.episodeId,
    provider: input.provider,
    model: input.model,
    language: input.transcript.language,
    segments: input.transcript.segments,
    confidence: input.transcript.confidence,
    durationSec: input.transcript.durationSec
  };
}

function saveProcessingResult(db: PodcastNoteDb, result: EpisodeProcessingResult, watch: Watch, model: string): void {
  const save = db.transaction(() => {
    saveSummary(db, result.episode.id, result.summary, watch.outputLanguage, model);
    db.query("delete from insights where watch_id = ? and episode_id = ?").run(watch.id, result.episode.id);
    for (const insight of result.insights) {
      saveInsight(db, insight);
    }
  });
  save();
}

function saveSummary(
  db: PodcastNoteDb,
  episodeId: string,
  summary: EpisodeSummary,
  outputLanguage: string,
  model: string
): void {
  db.query(`
    insert into episode_summaries (
      id, episode_id, output_language, one_liner, overview, chapters_json,
      worth_listening_json, entities_json, prompt_version, model
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(episode_id, output_language, prompt_version) do update set
      one_liner = excluded.one_liner,
      overview = excluded.overview,
      chapters_json = excluded.chapters_json,
      worth_listening_json = excluded.worth_listening_json,
      entities_json = excluded.entities_json,
      model = excluded.model
  `).run(
    stableId("sum", `${episodeId}:${outputLanguage}:episode-summary-v1`),
    episodeId,
    outputLanguage,
    summary.oneLiner,
    summary.overview,
    JSON.stringify(summary.chapters),
    JSON.stringify(summary.worthListening),
    JSON.stringify(summary.entities),
    "episode-summary-v1",
    model
  );
}

function saveInsight(db: PodcastNoteDb, insight: Insight): void {
  db.query(`
    insert into insights (
      id, workspace_id, watch_id, episode_id, segment_index, claim, evidence_excerpt,
      reasoning, implication, timestamp_start_sec, timestamp_end_sec, entities_json,
      relevance_score, confidence, groundedness_score, output_language, status, prompt_version, model
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      claim = excluded.claim,
      evidence_excerpt = excluded.evidence_excerpt,
      reasoning = excluded.reasoning,
      implication = excluded.implication,
      timestamp_start_sec = excluded.timestamp_start_sec,
      timestamp_end_sec = excluded.timestamp_end_sec,
      entities_json = excluded.entities_json,
      relevance_score = excluded.relevance_score,
      confidence = excluded.confidence,
      groundedness_score = excluded.groundedness_score,
      output_language = excluded.output_language,
      status = excluded.status,
      prompt_version = excluded.prompt_version,
      model = excluded.model
  `).run(
    insight.id,
    insight.workspaceId,
    insight.watchId,
    insight.episodeId,
    insight.segmentIndex ?? null,
    insight.claim,
    insight.evidenceExcerpt,
    insight.reasoning ?? null,
    insight.implication ?? null,
    insight.timestampStartSec,
    insight.timestampEndSec,
    JSON.stringify(insight.entities),
    insight.relevanceScore,
    insight.confidence,
    insight.groundednessScore ?? null,
    insight.outputLanguage,
    insight.status,
    insight.promptVersion,
    insight.model
  );
}

function getEpisode(db: PodcastNoteDb, id: string): Episode | undefined {
  const row = db.query("select * from episodes where id = ?").get(id) as Record<string, unknown> | null;
  return row ? episodeFromRow(row) : undefined;
}

function listInboxItems(db: PodcastNoteDb, options: { workspaceId: string; feedbackAction?: InsightFeedbackAction; limit?: number }): InboxItem[] {
  const params: unknown[] = [options.workspaceId];
  let feedbackFilter = "";
  if (options.feedbackAction) {
    feedbackFilter = "and f.action = ?";
    params.push(options.feedbackAction);
  }
  const rows = db.query(`
    select
      i.*,
      e.title as episode_title,
      e.page_url as episode_page_url,
      e.audio_url as episode_audio_url,
      e.published_at as episode_published_at,
      w.name as watch_name,
      f.action as feedback_action,
      f.note as feedback_note
    from insights i
    join episodes e on e.id = i.episode_id
    join watches w on w.id = i.watch_id
    left join insight_feedback f on f.workspace_id = i.workspace_id and f.insight_id = i.id
    where i.workspace_id = ?
      and i.status = 'published'
      ${feedbackFilter}
    order by i.created_at desc, i.relevance_score desc
    limit ?
  `).all(...params, normalizeLimit(options.limit)) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    ...insightFromRow(row),
    episodeTitle: String(row["episode_title"]),
    episodePageUrl: String(row["episode_page_url"]),
    episodeAudioUrl: nullableString(row["episode_audio_url"]),
    episodePublishedAt: nullableString(row["episode_published_at"]),
    watchName: String(row["watch_name"]),
    feedbackAction: nullableString(row["feedback_action"]) as InsightFeedbackAction | undefined,
    feedbackNote: nullableString(row["feedback_note"])
  }));
}

function recordInsightFeedback(db: PodcastNoteDb, input: {
  workspaceId: string;
  userId: string;
  insightId: string;
  action: InsightFeedbackAction;
  note?: string;
  createdAt?: string;
}): InsightFeedback {
  const id = stableId("fb", `${input.workspaceId}:${input.userId}:${input.insightId}`);
  const createdAt = input.createdAt ?? new Date().toISOString();
  db.query(`
    insert into insight_feedback (id, workspace_id, user_id, insight_id, action, note, created_at)
    values (?, ?, ?, ?, ?, ?, ?)
    on conflict(workspace_id, user_id, insight_id) do update set
      action = excluded.action,
      note = excluded.note,
      updated_at = datetime('now')
  `).run(id, input.workspaceId, input.userId, input.insightId, input.action, input.note ?? null, createdAt);
  const feedback = getInsightFeedback(db, input.workspaceId, input.userId, input.insightId);
  if (!feedback) throw new Error(`Failed to record insight feedback ${id}`);
  return feedback;
}

function getInsightFeedback(db: PodcastNoteDb, workspaceId: string, userId: string, insightId: string): InsightFeedback | undefined {
  const row = db.query(`
    select * from insight_feedback where workspace_id = ? and user_id = ? and insight_id = ?
  `).get(workspaceId, userId, insightId) as Record<string, unknown> | null;
  return row ? insightFeedbackFromRow(row) : undefined;
}

function getEpisodeDetailForWorkspace(db: PodcastNoteDb, input: { workspaceId: string; episodeId: string; userId?: string }): EpisodeDetail | undefined {
  const episodeRow = db.query(`
    select e.* from episodes e
    where e.id = ? and exists (
      select 1 from insights i where i.episode_id = e.id and i.workspace_id = ?
    )
  `).get(input.episodeId, input.workspaceId) as Record<string, unknown> | null;
  if (!episodeRow) return undefined;
  const episode = episodeFromRow(episodeRow);
  const sourceRow = episode.sourceId
    ? db.query("select * from sources where id = ?").get(episode.sourceId) as Record<string, unknown> | null
    : null;
  const summaryRow = db.query(`
    select * from episode_summaries where episode_id = ? order by created_at desc limit 1
  `).get(input.episodeId) as Record<string, unknown> | null;
  const transcript = getLatestTranscriptForEpisode(db, input.episodeId);
  const insightRows = db.query(`
    select i.*, f.action as feedback_action, f.note as feedback_note
    from insights i
    left join insight_feedback f on f.workspace_id = i.workspace_id and f.insight_id = i.id and (? is null or f.user_id = ?)
    where i.workspace_id = ? and i.episode_id = ? and i.status = 'published'
    order by i.timestamp_start_sec asc, i.relevance_score desc
  `).all(input.userId ?? null, input.userId ?? null, input.workspaceId, input.episodeId) as Array<Record<string, unknown>>;
  const insights = insightRows.map((row) => ({
    ...insightFromRow(row),
    feedbackAction: nullableString(row["feedback_action"]) as InsightFeedbackAction | undefined,
    feedbackNote: nullableString(row["feedback_note"])
  }));
  return {
    episode,
    source: sourceRow ? sourceFromRow(sourceRow) : undefined,
    summary: summaryRow ? summaryFromRow(summaryRow) : undefined,
    transcript,
    insights,
    player: {
      audioUrl: episode.audioUrl,
      pageUrl: episode.pageUrl,
      durationSec: episode.durationSec ?? transcript?.durationSec
    }
  };
}

function getLatestTranscriptForEpisode(db: PodcastNoteDb, episodeId: string): StoredTranscript | undefined {
  const row = db.query(`
    select * from transcripts where episode_id = ? order by created_at desc limit 1
  `).get(episodeId) as Record<string, unknown> | null;
  if (!row) return undefined;
  return transcriptFromRow(row);
}

function getLatestInsightsForWatch(db: PodcastNoteDb, watchId: string, limit: number): Insight[] {
  const rows = db.query(`
    select * from insights where watch_id = ? order by created_at desc limit ?
  `).all(watchId, limit) as Array<Record<string, unknown>>;
  return rows.map(insightFromRow);
}

function listProcessedEpisodes(db: PodcastNoteDb, options: { limit?: number }): Array<Episode & { transcriptCount: number; insightCount: number; lastProcessedAt?: string }> {
  const rows = db.query(`
    select
      e.*,
      count(distinct t.id) as transcript_count,
      count(distinct i.id) as insight_count,
      max(coalesce(i.created_at, t.created_at, e.updated_at, e.created_at)) as last_processed_at
    from episodes e
    left join transcripts t on t.episode_id = e.id
    left join insights i on i.episode_id = e.id
    where t.id is not null or i.id is not null
    group by e.id
    order by last_processed_at desc
    limit ?
  `).all(normalizeLimit(options.limit)) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    ...episodeFromRow(row),
    transcriptCount: Number(row["transcript_count"] ?? 0),
    insightCount: Number(row["insight_count"] ?? 0),
    lastProcessedAt: nullableString(row["last_processed_at"])
  }));
}

function listProcessedEpisodeDetailsForWorkspace(db: PodcastNoteDb, options: { workspaceId: string; limit?: number }): EpisodeDetail[] {
  const rows = db.query(`
    select i.episode_id, max(i.created_at) as last_insight_at
    from insights i
    join episode_summaries s on s.episode_id = i.episode_id
    where i.workspace_id = ? and i.status = 'published'
    group by i.episode_id
    order by last_insight_at desc
    limit ?
  `).all(options.workspaceId, normalizeLimit(options.limit)) as Array<Record<string, unknown>>;
  return rows
    .map((row) => getEpisodeDetailForWorkspace(db, {
      workspaceId: options.workspaceId,
      episodeId: String(row["episode_id"])
    }))
    .filter((detail) => detail !== undefined);
}

function listProcessingRuns(db: PodcastNoteDb, options: { limit?: number }): Array<Record<string, unknown> & { episodeCount: number }> {
  const rows = db.query(`
    select pr.*, count(pes.episode_id) as episode_count
    from processing_runs pr
    left join processing_episode_statuses pes on pes.run_id = pr.id
    group by pr.id
    order by pr.started_at desc
    limit ?
  `).all(normalizeLimit(options.limit)) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    ...row,
    episodeCount: Number(row["episode_count"] ?? 0)
  }));
}

function listInsights(db: PodcastNoteDb, options: { watchId?: string; episodeId?: string; limit?: number }): Insight[] {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.watchId) {
    conditions.push("watch_id = ?");
    params.push(options.watchId);
  }
  if (options.episodeId) {
    conditions.push("episode_id = ?");
    params.push(options.episodeId);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const rows = db.query(`
    select * from insights ${where} order by created_at desc limit ?
  `).all(...params, normalizeLimit(options.limit)) as Array<Record<string, unknown>>;
  return rows.map(insightFromRow);
}

function userFromRow(row: Record<string, unknown>): User {
  return {
    id: String(row["id"]),
    email: nullableString(row["email"]),
    name: nullableString(row["name"]),
    timezone: nullableString(row["timezone"]) ?? "Asia/Shanghai"
  };
}

function workspaceFromRow(row: Record<string, unknown>): Workspace {
  return {
    id: String(row["id"]),
    ownerUserId: String(row["owner_user_id"]),
    name: String(row["name"]),
    type: "personal"
  };
}

function sessionFromRow(row: Record<string, unknown>): Session {
  return {
    id: String(row["id"]),
    userId: String(row["user_id"]),
    workspaceId: String(row["workspace_id"]),
    token: String(row["token"]),
    createdAt: String(row["created_at"]),
    expiresAt: String(row["expires_at"]),
    revokedAt: nullableString(row["revoked_at"])
  };
}

function usageEventFromRow(row: Record<string, unknown>): UsageEvent {
  return {
    id: String(row["id"]),
    workspaceId: String(row["workspace_id"]),
    userId: String(row["user_id"]),
    sessionId: nullableString(row["session_id"]),
    eventType: String(row["event_type"]) as UsageEventType,
    entityType: String(row["entity_type"]) as UsageEntityType,
    entityId: nullableString(row["entity_id"]),
    metadata: parseJsonObject(row["metadata_json"]),
    occurredAt: String(row["occurred_at"])
  };
}

function larkBindSessionFromRow(row: Record<string, unknown>): LarkBindSession {
  return {
    id: String(row["id"]),
    workspaceId: String(row["workspace_id"]),
    agentId: String(row["agent_id"]),
    stateHash: String(row["state_hash"]),
    permissionPackage: String(row["permission_package"]),
    terminalFingerprint: nullableString(row["terminal_fingerprint"]),
    status: String(row["status"]) as LarkBindSessionStatus,
    connectionId: nullableString(row["connection_id"]),
    verificationUrl: String(row["verification_url"]),
    expiresAt: String(row["expires_at"]),
    createdAt: String(row["created_at"]),
    completedAt: nullableString(row["completed_at"]),
    error: nullableString(row["error"])
  };
}

function larkConnectionFromRow(row: Record<string, unknown>): LarkConnection {
  return {
    id: String(row["id"]),
    workspaceId: String(row["workspace_id"]),
    agentId: String(row["agent_id"]),
    tenantKey: String(row["tenant_key"]),
    openId: String(row["open_id"]),
    unionId: nullableString(row["union_id"]),
    userName: nullableString(row["user_name"]),
    permissionPackage: String(row["permission_package"]),
    encryptedAccessToken: String(row["encrypted_access_token"]),
    encryptedRefreshToken: String(row["encrypted_refresh_token"]),
    accessTokenExpiresAt: String(row["access_token_expires_at"]),
    refreshTokenExpiresAt: nullableString(row["refresh_token_expires_at"]),
    status: String(row["status"]) as LarkConnectionStatus,
    createdAt: String(row["created_at"]),
    updatedAt: String(row["updated_at"]),
    revokedAt: nullableString(row["revoked_at"])
  };
}

function larkBotInstallationFromRow(row: Record<string, unknown>): LarkBotInstallation {
  return {
    id: String(row["id"]),
    workspaceId: String(row["workspace_id"]),
    appId: String(row["app_id"]),
    tenantKey: String(row["tenant_key"]),
    chatId: String(row["chat_id"]),
    chatName: nullableString(row["chat_name"]),
    operatorOpenId: nullableString(row["operator_open_id"]),
    status: String(row["status"]) as LarkBotInstallationStatus,
    installedAt: String(row["installed_at"]),
    updatedAt: String(row["updated_at"]),
    disabledAt: nullableString(row["disabled_at"])
  };
}

function larkDeliveryRecordFromRow(row: Record<string, unknown>): LarkDeliveryRecord {
  return {
    id: String(row["id"]),
    workspaceId: String(row["workspace_id"]),
    watchId: nullableString(row["watch_id"]),
    episodeId: nullableString(row["episode_id"]),
    chatId: String(row["chat_id"]),
    deliveryType: String(row["delivery_type"]) as LarkDeliveryType,
    deliveryKey: nullableString(row["delivery_key"]),
    providerMessageId: String(row["provider_message_id"]),
    deliveredAt: String(row["delivered_at"])
  };
}

function larkPendingIntentFromRow(row: Record<string, unknown>): LarkPendingIntent {
  return {
    id: String(row["id"]),
    workspaceId: String(row["workspace_id"]),
    chatId: String(row["chat_id"]),
    senderOpenId: nullableString(row["sender_open_id"]),
    intentType: String(row["intent_type"]),
    intent: parseJsonObject(row["intent_json"]),
    status: String(row["status"]) as LarkPendingIntentStatus,
    expiresAt: String(row["expires_at"]),
    createdAt: String(row["created_at"]),
    completedAt: nullableString(row["completed_at"]),
    error: nullableString(row["error"])
  };
}

function watchPollFromRow(row: Record<string, unknown>): WatchPoll {
  return {
    id: String(row["id"]),
    watchId: String(row["watch_id"]),
    checkedAt: String(row["checked_at"]),
    status: String(row["status"]) as WatchPollStatus,
    candidateCount: Number(row["candidate_count"] ?? 0),
    queuedCount: Number(row["queued_count"] ?? 0),
    error: nullableString(row["error"])
  };
}

function episodeProcessingJobFromRow(row: Record<string, unknown>): EpisodeProcessingJob {
  return {
    id: String(row["id"]),
    workspaceId: String(row["workspace_id"]),
    watchId: String(row["watch_id"]),
    episodeId: String(row["episode_id"]),
    sourceUrl: String(row["source_url"]),
    status: String(row["status"]) as EpisodeProcessingJobStatus,
    attempts: Number(row["attempts"] ?? 0),
    relevanceScore: nullableNumber(row["relevance_score"]),
    relevanceReason: parseJsonObject(row["relevance_reason_json"]),
    processingRunId: nullableString(row["processing_run_id"]),
    error: nullableString(row["error"]),
    queuedAt: String(row["queued_at"]),
    startedAt: nullableString(row["started_at"]),
    finishedAt: nullableString(row["finished_at"])
  };
}

function dailyBriefFromRow(row: Record<string, unknown>): DailyBrief {
  return {
    id: String(row["id"]),
    workspaceId: String(row["workspace_id"]),
    userId: String(row["user_id"]),
    briefDate: String(row["brief_date"]),
    timezone: String(row["timezone"]),
    status: String(row["status"]) as DailyBriefStatus,
    insightCount: Number(row["insight_count"] ?? 0),
    subject: nullableString(row["subject"]),
    providerMessageId: nullableString(row["provider_message_id"]),
    error: nullableString(row["error"]),
    sentAt: nullableString(row["sent_at"])
  };
}

function insightFeedbackFromRow(row: Record<string, unknown>): InsightFeedback {
  return {
    id: String(row["id"]),
    workspaceId: String(row["workspace_id"]),
    userId: String(row["user_id"]),
    insightId: String(row["insight_id"]),
    action: String(row["action"]) as InsightFeedbackAction,
    note: nullableString(row["note"]),
    createdAt: String(row["created_at"])
  };
}

function wikiExportFromRow(row: Record<string, unknown>): WikiExport {
  return {
    id: String(row["id"]),
    workspaceId: String(row["workspace_id"]),
    vaultRoot: String(row["vault_root"]),
    episodeId: nullableString(row["episode_id"]),
    watchId: nullableString(row["watch_id"]),
    exportType: String(row["export_type"]) as WikiExportType,
    filePath: String(row["file_path"]),
    contentHash: String(row["content_hash"]),
    status: String(row["status"]) as WikiExportStatus,
    error: nullableString(row["error"]),
    createdAt: String(row["created_at"]),
    updatedAt: String(row["updated_at"])
  };
}

function wikiUpdateProposalFromRow(row: Record<string, unknown>): WikiUpdateProposalRecord {
  return {
    id: String(row["id"]),
    workspaceId: String(row["workspace_id"]),
    episodeId: String(row["episode_id"]),
    insightId: nullableString(row["insight_id"]),
    targetPath: String(row["target_path"]),
    proposalType: String(row["proposal_type"]) as WikiProposalType,
    title: String(row["title"]),
    rationale: String(row["rationale"]),
    patch: parseJsonObject(row["patch_json"]),
    status: String(row["status"]) as WikiProposalStatus,
    createdAt: String(row["created_at"]),
    updatedAt: String(row["updated_at"])
  };
}

function sourceFromRow(row: Record<string, unknown>): Source {
  return {
    id: String(row["id"]),
    type: String(row["type"]) as Source["type"],
    url: String(row["url"]),
    canonicalUrl: nullableString(row["canonical_url"]),
    externalId: nullableString(row["external_id"]),
    title: nullableString(row["title"]),
    author: nullableString(row["author"]),
    language: nullableString(row["language"]),
    imageUrl: nullableString(row["image_url"]),
    metadata: parseJsonObject(row["metadata_json"])
  };
}

function summaryFromRow(row: Record<string, unknown>): EpisodeSummary {
  return {
    oneLiner: String(row["one_liner"]),
    overview: String(row["overview"]),
    chapters: parseJsonArray(row["chapters_json"]),
    worthListening: parseJsonObject(row["worth_listening_json"]),
    entities: parseJsonArray(row["entities_json"])
  };
}

function watchFromRow(row: Record<string, unknown>): Watch {
  return {
    id: String(row["id"]),
    workspaceId: String(row["workspace_id"]),
    name: String(row["name"]),
    type: String(row["type"]) as Watch["type"],
    query: String(row["query"]),
    outputLanguage: String(row["output_language"]) as Watch["outputLanguage"],
    includeTerms: parseJsonArray<string>(row["include_terms_json"]),
    excludeTerms: parseJsonArray<string>(row["exclude_terms_json"]),
    expandedTerms: parseJsonArray<string>(row["expanded_terms_json"]),
    minRelevanceScore: Number(row["min_relevance_score"]),
    frequency: String(row["frequency"]) as Watch["frequency"],
    backfillDays: Number(row["backfill_days"]),
    enabled: nullableBoolean(row["enabled"]) ?? true
  };
}

function episodeFromRow(row: Record<string, unknown>): Episode {
  return {
    id: String(row["id"]),
    sourceId: nullableString(row["source_id"]),
    guid: nullableString(row["guid"]),
    title: String(row["title"]),
    description: nullableString(row["description"]),
    publishedAt: nullableString(row["published_at"]),
    durationSec: nullableNumber(row["duration_sec"]),
    audioUrl: nullableString(row["audio_url"]),
    pageUrl: String(row["page_url"]),
    language: nullableString(row["language"]),
    checksum: nullableString(row["checksum"]),
    metadata: parseJsonObject(row["metadata_json"])
  };
}

function insightFromRow(row: Record<string, unknown>): Insight {
  return {
    id: String(row["id"]),
    workspaceId: String(row["workspace_id"]),
    watchId: String(row["watch_id"]),
    episodeId: String(row["episode_id"]),
    segmentIndex: nullableNumber(row["segment_index"]),
    claim: String(row["claim"]),
    evidenceExcerpt: String(row["evidence_excerpt"]),
    reasoning: nullableString(row["reasoning"]),
    implication: nullableString(row["implication"]),
    timestampStartSec: Number(row["timestamp_start_sec"]),
    timestampEndSec: Number(row["timestamp_end_sec"]),
    entities: parseJsonArray(row["entities_json"]),
    relevanceScore: Number(row["relevance_score"]),
    confidence: Number(row["confidence"]),
    groundednessScore: nullableNumber(row["groundedness_score"]),
    outputLanguage: String(row["output_language"]) as Insight["outputLanguage"],
    status: String(row["status"]) as Insight["status"],
    promptVersion: String(row["prompt_version"]),
    model: String(row["model"])
  };
}

function transcriptFromRow(row: Record<string, unknown>): StoredTranscript {
  return {
    id: String(row["id"]),
    episodeId: String(row["episode_id"]),
    provider: String(row["provider"]),
    model: String(row["model"]),
    language: nullableString(row["language"]),
    segments: parseJsonArray<TranscriptSegment>(row["segments_json"]),
    confidence: nullableNumber(row["confidence"]),
    durationSec: nullableNumber(row["duration_sec"])
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isInteger(limit) || (limit as number) <= 0) return 50;
  return Math.min(limit as number, 500);
}

function nullableString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nullableNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function nullableBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return undefined;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  const parsed = JSON.parse(value) as unknown;
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function parseJsonArray<T = never>(value: unknown): T[] {
  if (typeof value !== "string") return [];
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed as T[] : [];
}
