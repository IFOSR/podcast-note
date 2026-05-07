import type {
  EpisodeDetail,
  HydratedSession,
  InboxItem,
  InsightFeedback,
  InsightFeedbackAction
} from "../../../../packages/db/src/repositories.ts";
import type { OutputLanguage, User, Watch, WatchType } from "../../../../packages/core/src/types.ts";
import type { createRepositories } from "../../../../packages/db/src/repositories.ts";

type Repositories = ReturnType<typeof createRepositories>;

export type SessionContext = {
  session: HydratedSession;
  user: User;
  workspace: HydratedSession["workspace"];
};

export type LocalSessionInput = {
  repositories: Repositories;
  user: {
    id: string;
    email?: string;
    name?: string;
    timezone?: string;
  };
  token: string;
  now?: string;
  expiresAt: string;
};

export type WatchFormInput = {
  name: string;
  type?: WatchType;
  query: string;
  outputLanguage?: OutputLanguage;
  includeTerms?: string[] | string;
  excludeTerms?: string[] | string;
  expandedTerms?: string[] | string;
  minRelevanceScore?: number;
  frequency?: Watch["frequency"];
  backfillDays?: number;
  enabled?: boolean;
};

export type WatchCard = Watch & {
  statusLabel: "Active" | "Paused";
  includeTermText: string;
  excludeTermText: string;
};

export type InboxView = {
  workspaceId: string;
  items: InboxItem[];
};

export type EpisodeDetailView = EpisodeDetail & {
  pageTitle: string;
};

export function createLocalSession(input: LocalSessionInput): HydratedSession {
  const user = input.repositories.upsertUser(input.user);
  const workspace = input.repositories.ensurePersonalWorkspaceForUser(user.id);
  input.repositories.createSession({
    userId: user.id,
    workspaceId: workspace.id,
    token: input.token,
    createdAt: input.now,
    expiresAt: input.expiresAt
  });
  const session = input.repositories.getSessionByToken(input.token, input.now);
  if (!session) {
    throw new Error(`Failed to create local session for user: ${user.id}`);
  }
  return session;
}

export function getSessionContext(input: { repositories: Repositories; token?: string; now?: string }): SessionContext | undefined {
  if (!input.token) return undefined;
  const session = input.repositories.getSessionByToken(input.token, input.now);
  if (!session) return undefined;
  return { session, user: session.user, workspace: session.workspace };
}

export function requireSessionContext(input: { repositories: Repositories; token?: string; now?: string }): SessionContext {
  const context = getSessionContext(input);
  if (!context) throw new Error("A valid session is required.");
  return context;
}

export function createWatch(input: { repositories: Repositories; context: SessionContext; input: WatchFormInput }): Watch {
  return input.repositories.createWatchForWorkspace(input.context.workspace.id, normalizeWatchInput(input.input));
}

export function updateWatch(input: {
  repositories: Repositories;
  context: SessionContext;
  watchId: string;
  input: Partial<WatchFormInput>;
}): Watch {
  const patch = normalizeWatchPatch(input.input);
  const updated = input.repositories.updateWatchForWorkspace(input.context.workspace.id, input.watchId, patch);
  if (!updated) throw new Error(`Watch not found in workspace ${input.context.workspace.id}: ${input.watchId}`);
  return updated;
}

export function listWatchCards(input: { repositories: Repositories; context: SessionContext }): WatchCard[] {
  return input.repositories.listWatchesForWorkspace(input.context.workspace.id).map((watch) => ({
    ...watch,
    statusLabel: watch.enabled ? "Active" : "Paused",
    includeTermText: watch.includeTerms.join(", "),
    excludeTermText: watch.excludeTerms.join(", ")
  }));
}

export function getInboxView(input: { repositories: Repositories; context: SessionContext; limit?: number; occurredAt?: string }): InboxView {
  const items = input.repositories.listInboxItems({
    workspaceId: input.context.workspace.id,
    limit: input.limit ?? 50
  });
  input.repositories.recordUsageEvent({
    workspaceId: input.context.workspace.id,
    userId: input.context.user.id,
    sessionId: input.context.session.id,
    eventType: "view",
    entityType: "inbox",
    occurredAt: input.occurredAt ?? new Date().toISOString()
  });
  return { workspaceId: input.context.workspace.id, items };
}

export function getEpisodeDetailView(input: { repositories: Repositories; context: SessionContext; episodeId: string; occurredAt?: string }): EpisodeDetailView | undefined {
  const detail = input.repositories.getEpisodeDetailForWorkspace({
    workspaceId: input.context.workspace.id,
    userId: input.context.user.id,
    episodeId: input.episodeId
  });
  if (!detail) return undefined;
  input.repositories.recordUsageEvent({
    workspaceId: input.context.workspace.id,
    userId: input.context.user.id,
    sessionId: input.context.session.id,
    eventType: "view",
    entityType: "episode",
    entityId: input.episodeId,
    occurredAt: input.occurredAt ?? new Date().toISOString()
  });
  return {
    ...detail,
    pageTitle: `${detail.episode.title} · Podcast Note`
  };
}

export function recordInsightFeedback(input: {
  repositories: Repositories;
  context: SessionContext;
  insightId: string;
  action: InsightFeedbackAction;
  note?: string;
}): InsightFeedback {
  const feedback = input.repositories.recordInsightFeedback({
    workspaceId: input.context.workspace.id,
    userId: input.context.user.id,
    insightId: input.insightId,
    action: input.action,
    note: input.note
  });
  input.repositories.recordUsageEvent({
    workspaceId: input.context.workspace.id,
    userId: input.context.user.id,
    sessionId: input.context.session.id,
    eventType: feedbackActionToUsageEvent(input.action),
    entityType: "insight",
    entityId: input.insightId,
    metadata: { action: input.action },
    occurredAt: feedback.createdAt
  });
  return feedback;
}

export function recordEpisodePlayback(input: {
  repositories: Repositories;
  context: SessionContext;
  episodeId: string;
  positionSec?: number;
  occurredAt?: string;
}): void {
  input.repositories.recordUsageEvent({
    workspaceId: input.context.workspace.id,
    userId: input.context.user.id,
    sessionId: input.context.session.id,
    eventType: "playback",
    entityType: "episode",
    entityId: input.episodeId,
    metadata: { positionSec: input.positionSec ?? 0 },
    occurredAt: input.occurredAt ?? new Date().toISOString()
  });
}

function normalizeWatchInput(input: WatchFormInput): Parameters<Repositories["createWatchForWorkspace"]>[1] {
  if (!input.name.trim()) throw new Error("Watch name is required.");
  if (!input.query.trim()) throw new Error("Watch query is required.");
  return {
    name: input.name.trim(),
    type: input.type ?? "topic",
    query: input.query.trim(),
    outputLanguage: input.outputLanguage ?? "zh-CN",
    includeTerms: normalizeTerms(input.includeTerms),
    excludeTerms: normalizeTerms(input.excludeTerms),
    expandedTerms: normalizeTerms(input.expandedTerms),
    minRelevanceScore: input.minRelevanceScore ?? 0.6,
    frequency: input.frequency ?? "daily",
    backfillDays: input.backfillDays ?? 30,
    enabled: input.enabled ?? true
  };
}

function normalizeWatchPatch(input: Partial<WatchFormInput>): Parameters<Repositories["updateWatchForWorkspace"]>[2] {
  const patch: Parameters<Repositories["updateWatchForWorkspace"]>[2] = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.type !== undefined) patch.type = input.type;
  if (input.query !== undefined) patch.query = input.query.trim();
  if (input.outputLanguage !== undefined) patch.outputLanguage = input.outputLanguage;
  if (input.includeTerms !== undefined) patch.includeTerms = normalizeTerms(input.includeTerms);
  if (input.excludeTerms !== undefined) patch.excludeTerms = normalizeTerms(input.excludeTerms);
  if (input.expandedTerms !== undefined) patch.expandedTerms = normalizeTerms(input.expandedTerms);
  if (input.minRelevanceScore !== undefined) patch.minRelevanceScore = input.minRelevanceScore;
  if (input.frequency !== undefined) patch.frequency = input.frequency;
  if (input.backfillDays !== undefined) patch.backfillDays = input.backfillDays;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  return patch;
}

function normalizeTerms(value?: string[] | string): string[] {
  if (!value) return [];
  const terms = Array.isArray(value) ? value : value.split(",");
  return [...new Set(terms.map((term) => term.trim()).filter(Boolean))];
}

function feedbackActionToUsageEvent(action: InsightFeedbackAction): "save" | "irrelevant" | "wrong" | "view" {
  if (action === "saved") return "save";
  if (action === "irrelevant") return "irrelevant";
  if (action === "wrong") return "wrong";
  return "view";
}
