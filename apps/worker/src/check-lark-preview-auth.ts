import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = await mkdtemp(join(tmpdir(), "podcast-note-lark-preview-"));
const dbPath = join(root, "preview.sqlite");
const port = 3927;
const proc = Bun.spawn({
  cmd: [
    process.execPath,
    "apps/web/src/server/preview.ts",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--db",
    dbPath,
    "--scheduler",
    "false"
  ],
  env: {
    ...process.env,
    LARK_APP_ID: "cli_a_preview_check",
    LARK_OAUTH_REDIRECT_URI: "https://podcast-note.example.com/api/lark/oauth/callback"
  },
  stdout: "pipe",
  stderr: "pipe"
});

try {
  await waitForHealth(port);
  const page = await fetchText(`http://127.0.0.1:${port}/integrations/feishu`);
  if (!page.includes("扫码接入 Podcast Note 机器人") || !page.includes("生成接入二维码")) {
    throw new Error("Feishu integration page did not render the robot onboarding entry.");
  }

  const createResponse = await fetch(`http://127.0.0.1:${port}/api/lark/bind-sessions`, { method: "POST" });
  if (!createResponse.ok) {
    throw new Error(`Bind session API failed: ${createResponse.status} ${await createResponse.text()}`);
  }
  const created = await createResponse.json() as {
    bind_session_id?: string;
    verification_url?: string;
  };
  if (!created.bind_session_id?.startsWith("lbs_")) {
    throw new Error(`Unexpected bind session API response: ${JSON.stringify(created)}`);
  }
  if (!created.verification_url?.includes("client_id=cli_a_preview_check")) {
    throw new Error(`Verification URL missed configured app id: ${created.verification_url}`);
  }
  if (created.verification_url.includes("domain:")) {
    throw new Error(`Verification URL leaked internal domain aliases as OAuth scopes: ${created.verification_url}`);
  }
  const authUrl = new URL(created.verification_url);
  const state = authUrl.searchParams.get("state");
  if (!state) throw new Error("Verification URL missed state.");

  const pendingResponse = await fetch(`http://127.0.0.1:${port}/api/lark/bind-sessions/${created.bind_session_id}`);
  const pending = await pendingResponse.json() as { status?: string };
  if (pending.status !== "pending") {
    throw new Error(`Expected pending status before callback, got ${JSON.stringify(pending)}`);
  }

  const bindPage = await fetchText(`http://127.0.0.1:${port}/integrations/feishu?bind_session_id=${encodeURIComponent(created.bind_session_id)}`);
  if (!bindPage.includes("飞书扫码接入 Podcast Note 机器人") || !bindPage.includes("data:image/svg+xml;base64")) {
    throw new Error("Bind session page did not render a real QR image.");
  }

  const callbackResponse = await fetch(`http://127.0.0.1:${port}/api/lark/oauth/callback?code=preview_code&state=${encodeURIComponent(state)}`);
  const callbackHtml = await callbackResponse.text();
  if (!callbackResponse.ok || !callbackHtml.includes("飞书授权成功")) {
    throw new Error(`OAuth callback did not complete: ${callbackResponse.status} ${callbackHtml.slice(0, 200)}`);
  }

  const completedResponse = await fetch(`http://127.0.0.1:${port}/api/lark/bind-sessions/${created.bind_session_id}`);
  const completed = await completedResponse.json() as { status?: string; connectionId?: string };
  if (completed.status !== "completed" || !completed.connectionId?.startsWith("lark_conn_")) {
    throw new Error(`Expected completed auth status, got ${JSON.stringify(completed)}`);
  }

  const integrationResponse = await fetch(`http://127.0.0.1:${port}/api/integrations/feishu`);
  const integration = await integrationResponse.json() as { integration?: { connected?: boolean } };
  if (integration.integration?.connected !== true) {
    throw new Error(`Expected connected integration status, got ${JSON.stringify(integration)}`);
  }

  console.log("Lark preview auth check passed.");
} finally {
  proc.kill();
  await proc.exited;
}

async function waitForHealth(inputPort: number): Promise<void> {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < 5000) {
    try {
      const response = await fetch(`http://127.0.0.1:${inputPort}/health`);
      if (response.ok) return;
      lastError = `${response.status} ${await response.text()}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Preview server did not become healthy: ${lastError}`);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${text.slice(0, 200)}`);
  return text;
}
