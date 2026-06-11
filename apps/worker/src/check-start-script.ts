import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-start-script-"));
const pidFile = join(dir, "podcast-note.pid");
const logFile = join(dir, "podcast-note.log");
const dbPath = join(dir, "podcast-note.sqlite");
const port = 52000 + Math.floor(Math.random() * 1000);

try {
  const baseArgs = ["scripts/podcast-note", "--pid-file", pidFile, "--log-file", logFile, "--db", dbPath, "--port", String(port)];
  const help = run(["scripts/podcast-note", "--help"], true);
  assert(help.output.includes("Default: im.message.receive_v1"), `expected personal message event default, got ${help.output}`);

  const initialStatus = run([...baseArgs, "status"], false);
  assert(initialStatus.status !== 0, "status should fail when the service is not running");
  assert(initialStatus.output.includes("not running"), `expected not running status, got ${initialStatus.output}`);

  const start = run([...baseArgs, "start"], true);
  assert(start.output.includes("started"), `expected start output, got ${start.output}`);
  assert(existsSync(pidFile), "pid file should exist after start");

  waitForReady(`http://127.0.0.1:${port}/health`);
  const health = fetchJson(`http://127.0.0.1:${port}/health`);
  assert(health.ok === true, `expected healthy JSON, got ${JSON.stringify(health)}`);

  const startedStatus = run([...baseArgs, "status"], true);
  assert(startedStatus.output.includes("running"), `expected running status, got ${startedStatus.output}`);

  const restart = run([...baseArgs, "restart"], true);
  assert(restart.output.includes("started"), `expected restart to start service, got ${restart.output}`);
  waitForReady(`http://127.0.0.1:${port}/health`);

  const runOnce = run([...baseArgs, "run-once"], false);
  assert(runOnce.output.includes("No connector can handle input") || runOnce.output.includes('"ok": true'), `expected run-once to invoke worker pipeline, got ${runOnce.output}`);

  const stop = run([...baseArgs, "stop"], true);
  assert(stop.output.includes("stopped"), `expected stop output, got ${stop.output}`);
  assert(!existsSync(pidFile), "pid file should be removed after stop");

  const stoppedStatus = run([...baseArgs, "status"], false);
  assert(stoppedStatus.status !== 0 && stoppedStatus.output.includes("not running"), `expected stopped status, got ${stoppedStatus.output}`);

  console.log(JSON.stringify({ ok: true, port, pidFile, logFile }, null, 2));
} finally {
  spawnSync("bash", ["scripts/podcast-note", "--pid-file", pidFile, "--log-file", logFile, "--db", dbPath, "--port", String(port), "stop"], { cwd: process.cwd(), encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
}

function run(args: string[], expectSuccess: boolean): { status: number; output: string } {
  const result = spawnSync("bash", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${process.env["HOME"]}/.bun/bin:${process.env["PATH"]}`,
      PODCAST_NOTE_DISABLE_LARK_EVENTS: "1"
    }
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (expectSuccess && result.status !== 0) {
    throw new Error(`Command failed (${result.status}): bash ${args.join(" ")}\n${output}`);
  }
  return { status: result.status ?? 1, output };
}

function waitForReady(url: string): void {
  const deadline = Date.now() + 5000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = spawnSync("curl", ["-fsS", url], { encoding: "utf8" });
      if (response.status === 0) return;
      lastError = `${response.stdout ?? ""}${response.stderr ?? ""}`.trim();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  const log = existsSync(logFile) ? readFileSync(logFile, "utf8") : "<no log>";
  throw new Error(`Server did not become ready: ${lastError}\n${log}`);
}

function fetchJson(url: string): any {
  const response = spawnSync("curl", ["-fsS", url], { encoding: "utf8" });
  if (response.status !== 0) throw new Error(`GET ${url} failed: ${response.stdout}${response.stderr}`);
  return JSON.parse(response.stdout);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
