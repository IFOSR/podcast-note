import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openPodcastNoteDb, createRepositories } from "../../../packages/db/src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-watch-crud-"));
const dbPath = join(dir, "check.sqlite");

try {
  const db = openPodcastNoteDb(dbPath);
  const repos = createRepositories(db);

  const user = repos.upsertUser({
    id: "user_m1_watch_crud_smoke",
    email: "watch-crud@example.com",
    name: "M1 Watch CRUD Smoke User"
  });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);

  const created = repos.createWatchForWorkspace(workspace.id, {
    name: "AI Agent Weekly",
    type: "topic",
    query: "AI agents in podcast operations",
    outputLanguage: "zh-CN",
    includeTerms: ["agent", "podcast"],
    excludeTerms: ["crypto"],
    minRelevanceScore: 0.7,
    frequency: "daily",
    backfillDays: 14
  });

  if (!created.id.startsWith("watch_")) {
    throw new Error(`expected generated watch id, got ${created.id}`);
  }
  if (created.workspaceId !== workspace.id) {
    throw new Error(`watch workspace mismatch: ${created.workspaceId} !== ${workspace.id}`);
  }
  if (created.enabled !== true) {
    throw new Error("new watches should be enabled by default");
  }

  const loaded = repos.getWatchForWorkspace(workspace.id, created.id);
  if (!loaded || loaded.query !== created.query) {
    throw new Error("created watch could not be loaded within workspace scope");
  }

  const updated = repos.updateWatchForWorkspace(workspace.id, created.id, {
    name: "AI Agent Daily",
    includeTerms: ["agent", "podcast", "workflow"],
    excludeTerms: [],
    enabled: false,
    frequency: "weekly"
  });

  if (!updated) {
    throw new Error("watch update returned undefined");
  }
  if (updated.name !== "AI Agent Daily" || updated.enabled !== false || updated.frequency !== "weekly") {
    throw new Error("watch update did not persist mutable fields");
  }
  if (!updated.includeTerms.includes("workflow") || updated.excludeTerms.length !== 0) {
    throw new Error("watch update did not persist term changes");
  }

  const otherUser = repos.upsertUser({ id: "user_m1_watch_crud_other", email: "other@example.com" });
  const otherWorkspace = repos.ensurePersonalWorkspaceForUser(otherUser.id);
  if (repos.getWatchForWorkspace(otherWorkspace.id, created.id) !== undefined) {
    throw new Error("watch leaked across workspace boundary");
  }
  if (repos.updateWatchForWorkspace(otherWorkspace.id, created.id, { name: "Hijacked" }) !== undefined) {
    throw new Error("cross-workspace update should not be allowed");
  }

  const listedBeforeDelete = repos.listWatchesForWorkspace(workspace.id);
  if (!listedBeforeDelete.some((watch) => watch.id === created.id && watch.enabled === false)) {
    throw new Error("updated watch was not listed before delete");
  }

  const deleted = repos.deleteWatchForWorkspace(workspace.id, created.id);
  if (!deleted) {
    throw new Error("watch delete should return true for existing scoped watch");
  }
  if (repos.getWatchForWorkspace(workspace.id, created.id) !== undefined) {
    throw new Error("deleted watch should no longer load");
  }
  if (repos.deleteWatchForWorkspace(workspace.id, created.id) !== false) {
    throw new Error("second delete should return false");
  }

  console.log(JSON.stringify({
    ok: true,
    workspaceId: workspace.id,
    watchId: created.id,
    scoped: true,
    deleted
  }, null, 2));

  db.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
