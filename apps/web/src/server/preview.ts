import { createRepositories, openPodcastNoteDb } from "../../../../packages/db/src/index.ts";
import { createLocalSession, createWatch, getInboxView, getSessionContext, listWatchCards, type SessionContext } from "./m1-app.ts";

const options = parseArgs(process.argv.slice(2));
const port = Number(options["port"] ?? process.env["PORT"] ?? 3000);
const host = options["host"] ?? process.env["HOST"] ?? "127.0.0.1";
const dbPath = options["db"] ?? process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite";
const token = options["token"] ?? process.env["PODCAST_NOTE_SESSION_TOKEN"] ?? "local-dev-token";
const now = new Date().toISOString();
const repos = createRepositories(openPodcastNoteDb(dbPath));
const session = createLocalSession({
  repositories: repos,
  user: {
    id: "user_local_preview",
    email: "local-preview@example.invalid",
    name: "Local Preview",
    timezone: "Asia/Shanghai"
  },
  token,
  now,
  expiresAt: "2099-01-01T00:00:00.000Z"
});
const context = getSessionContext({ repositories: repos, token, now }) ?? { session, user: session.user, workspace: session.workspace };
seedDefaultWatch(context);

const server = Bun.serve({
  hostname: host,
  port,
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") {
        return json({ ok: true, app: "podcast-note", dbPath, workspaceId: context.workspace.id });
      }
      if (url.pathname === "/api/summary") {
        return json(summary(context));
      }
      if (url.pathname === "/api/run-once" && request.method === "POST") {
        const { runM1Once } = await import("../../../worker/src/m1-run-once.ts");
        const result = await runM1Once({ repositories: repos, workspaceId: context.workspace.id });
        return json({ ok: true, ...result });
      }
      if (url.pathname === "/") {
        return html(renderHome(context));
      }
      return html(renderNotFound(url.pathname), 404);
    } catch (error) {
      return html(`<h1>Podcast Note error</h1><pre>${escapeHtml(error instanceof Error ? error.stack ?? error.message : String(error))}</pre>`, 500);
    }
  }
});

console.log(JSON.stringify({ ok: true, message: "Podcast Note preview server started", url: `http://${host}:${server.port}`, dbPath, workspaceId: context.workspace.id }, null, 2));

function seedDefaultWatch(context: SessionContext): void {
  const watches = listWatchCards({ repositories: repos, context });
  if (watches.length > 0) return;
  createWatch({
    repositories: repos,
    context,
    input: {
      name: "AI Agent Workflow",
      type: "topic",
      query: "AI agent workflow",
      outputLanguage: "zh-CN",
      includeTerms: "AI agent, workflow",
      excludeTerms: "sports",
      minRelevanceScore: 0.6,
      frequency: "daily",
      backfillDays: 30
    }
  });
}

function summary(context: SessionContext) {
  const watches = listWatchCards({ repositories: repos, context });
  const inbox = getInboxView({ repositories: repos, context, limit: 20 });
  const usageEvents = repos.listUsageEvents({ workspaceId: context.workspace.id, userId: context.user.id, limit: 20 });
  return {
    ok: true,
    workspace: context.workspace,
    user: context.user,
    watches,
    inbox: inbox.items,
    usageEventCount: usageEvents.length
  };
}

function renderHome(context: SessionContext): string {
  const data = summary(context);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Podcast Note Local Preview</title>
  <style>
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e2e8f0; }
    main { max-width: 1040px; margin: 0 auto; padding: 40px 24px; }
    h1 { font-size: 40px; margin: 0 0 8px; }
    h2 { margin-top: 32px; color: #93c5fd; }
    .muted { color: #94a3b8; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
    .card { border: 1px solid #334155; background: #111827; border-radius: 16px; padding: 18px; box-shadow: 0 20px 60px rgba(0,0,0,.25); }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #1d4ed8; color: white; font-size: 12px; }
    code, pre { background: #020617; border: 1px solid #1e293b; border-radius: 10px; padding: 12px; overflow: auto; }
    button { border: 0; border-radius: 10px; padding: 10px 14px; background: #2563eb; color: white; cursor: pointer; }
    a { color: #93c5fd; }
  </style>
</head>
<body>
<main>
  <span class="badge">M1.5 local preview</span>
  <h1>Podcast Note</h1>
  <p class="muted">Workspace: ${escapeHtml(data.workspace.id)} · User: ${escapeHtml(data.user.id)}</p>
  <div class="grid">
    <section class="card"><h2>Watches</h2>${data.watches.map((watch) => `<p><strong>${escapeHtml(watch.name)}</strong><br/><span class="muted">${escapeHtml(watch.query)} · ${watch.statusLabel}</span></p>`).join("") || "<p>No watches yet.</p>"}</section>
    <section class="card"><h2>Inbox</h2>${data.inbox.map((item) => `<p><strong>${escapeHtml(item.claim)}</strong><br/><span class="muted">${escapeHtml(item.episodeTitle)} · score ${item.relevanceScore}</span></p>`).join("") || "<p>No insights yet. Run the worker once after configuring real sources.</p>"}</section>
    <section class="card"><h2>Actions</h2><p><button onclick="runOnce()">Run M1 once</button></p><p class="muted">Equivalent to <code>scripts/podcast-note run-once</code></p><pre id="result"></pre></section>
  </div>
  <h2>CLI</h2>
  <pre>scripts/podcast-note status
scripts/podcast-note run-once
scripts/podcast-note stop</pre>
</main>
<script>
async function runOnce() {
  const el = document.getElementById('result');
  el.textContent = 'Running...';
  const res = await fetch('/api/run-once', { method: 'POST' });
  el.textContent = JSON.stringify(await res.json(), null, 2);
}
</script>
</body>
</html>`;
}

function renderNotFound(pathname: string): string {
  return `<!doctype html><h1>Not found</h1><p>${escapeHtml(pathname)}</p><p><a href="/">Back home</a></p>`;
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    parsed[arg.slice(2)] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
  }
  return parsed;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
