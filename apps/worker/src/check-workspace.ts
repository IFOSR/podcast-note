import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openPodcastNoteDb, createRepositories } from "../../../packages/db/src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-workspace-"));
const dbPath = join(dir, "check.sqlite");

try {
  const db = openPodcastNoteDb(dbPath);
  const repos = createRepositories(db);

  const user = repos.upsertUser({
    id: "user_m1_workspace_smoke",
    email: "m1@example.com",
    name: "M1 Workspace Smoke User"
  });

  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const again = repos.ensurePersonalWorkspaceForUser(user.id);

  if (workspace.id !== again.id) {
    throw new Error(`personal workspace is not idempotent: ${workspace.id} !== ${again.id}`);
  }

  if (workspace.ownerUserId !== user.id) {
    throw new Error(`workspace owner mismatch: ${workspace.ownerUserId} !== ${user.id}`);
  }

  if (workspace.type !== "personal") {
    throw new Error(`expected personal workspace, got ${workspace.type}`);
  }

  const watch = repos.upsertWatch({
    id: "watch_m1_workspace_smoke",
    workspaceId: workspace.id,
    name: "M1 Workspace Watch",
    type: "topic",
    query: "AI podcast workflow",
    outputLanguage: "zh-CN",
    includeTerms: ["agent"],
    excludeTerms: [],
    expandedTerms: [],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 30
  });

  const watches = repos.listWatchesForWorkspace(workspace.id);
  if (!watches.some((item) => item.id === watch.id && item.workspaceId === workspace.id)) {
    throw new Error("workspace watch was not listed under its personal workspace");
  }

  const loadedUser = repos.getUser(user.id);
  if (!loadedUser || loadedUser.email !== user.email) {
    throw new Error("stored user could not be loaded");
  }

  console.log(JSON.stringify({
    ok: true,
    userId: user.id,
    workspaceId: workspace.id,
    watchCount: watches.length
  }, null, 2));

  db.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
