import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRepositories } from "../../../packages/db/src/repositories.ts";
import { openPodcastNoteDb } from "../../../packages/db/src/sqlite.ts";

const tempDir = mkdtempSync(join(tmpdir(), "podcast-note-auth-usage-"));
const dbPath = join(tempDir, "test.sqlite");

try {
  const db = openPodcastNoteDb(dbPath);
  const repos = createRepositories(db);

  const user = repos.upsertUser({
    id: "user_auth_usage",
    email: "auth@example.invalid",
    name: "Auth User",
    timezone: "Asia/Shanghai"
  });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);

  const session = repos.createSession({
    userId: user.id,
    workspaceId: workspace.id,
    token: "test-session-token",
    expiresAt: "2026-05-08T00:00:00.000Z",
    createdAt: "2026-05-07T00:00:00.000Z"
  });
  if (!session.id || session.revokedAt) throw new Error("session should be active after create");

  const active = repos.getSessionByToken("test-session-token", "2026-05-07T12:00:00.000Z");
  if (!active) throw new Error("active session should resolve by token before expiry");
  if (active.user.id !== user.id || active.workspace.id !== workspace.id) {
    throw new Error("session should hydrate user and workspace");
  }

  const expired = repos.getSessionByToken("test-session-token", "2026-05-09T00:00:00.000Z");
  if (expired) throw new Error("expired session should not resolve");

  const event = repos.recordUsageEvent({
    workspaceId: workspace.id,
    userId: user.id,
    sessionId: session.id,
    eventType: "view",
    entityType: "inbox",
    entityId: "inbox-root",
    metadata: { source: "check" },
    occurredAt: "2026-05-07T01:00:00.000Z"
  });
  if (event.eventType !== "view" || event.metadata["source"] !== "check") {
    throw new Error("usage event should preserve type and metadata");
  }

  repos.recordUsageEvent({
    workspaceId: workspace.id,
    userId: user.id,
    sessionId: session.id,
    eventType: "playback",
    entityType: "episode",
    entityId: "ep_auth_usage",
    metadata: { positionSec: 120 },
    occurredAt: "2026-05-07T01:05:00.000Z"
  });

  const events = repos.listUsageEvents({ workspaceId: workspace.id, userId: user.id, limit: 10 });
  if (events.length !== 2) throw new Error(`expected 2 usage events, got ${events.length}`);
  if (events[0]?.eventType !== "playback") throw new Error("usage events should be newest first");

  repos.revokeSession(session.id, "2026-05-07T02:00:00.000Z");
  const revoked = repos.getSessionByToken("test-session-token", "2026-05-07T02:01:00.000Z");
  if (revoked) throw new Error("revoked session should not resolve");

  console.log(JSON.stringify({
    ok: true,
    sessionId: session.id,
    workspaceId: active.workspace.id,
    usageEventCount: events.length,
    firstEventType: events[0]?.eventType
  }, null, 2));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
