import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-preview-ui-"));
const dbPath = join(dir, "preview.sqlite");
const port = 3400 + Math.floor(Math.random() * 1000);
const url = `http://127.0.0.1:${port}`;
const repoRoot = process.cwd();

let server: ReturnType<typeof Bun.spawn> | undefined;
try {
  server = Bun.spawn({
    cmd: ["bun", "apps/web/src/server/preview.ts", "--port", String(port), "--db", dbPath],
    cwd: repoRoot,
    env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ""}` },
    stdout: "pipe",
    stderr: "pipe"
  });

  if (server.stderr) {
    server.stderr.pipeTo(new WritableStream({
      write(chunk) {
        process.stderr.write(chunk);
      }
    })).catch(() => {});
  }
  server.stdout.pipeTo(new WritableStream({
    write(chunk) {
      process.stderr.write(chunk);
    }
  })).catch(() => {});

  waitForHealth(url);

  const home = fetchText(url);
  assertIncludes(home, "<form", "首页必须提供可直接操作的 Watch 表单，而不是只展示空卡片。");
  assertIncludes(home, "name=\"name\"", "Watch 表单需要 name 输入框。未找到 name 字段。");
  assertIncludes(home, "name=\"query\"", "Watch 表单需要 query 输入框。未找到 query 字段。");
  assertIncludes(home, "添加 Watch", "首页必须用中文清楚标注添加入口。未找到“添加 Watch”。");
  assertIncludes(home, "立即试用：添加关注主题", "首页必须给出明确首步。未找到新手引导标题。");
  assertIncludes(home, "示例数据", "空 Inbox 时必须提供可一键生成的示例数据入口。未找到“示例数据”。");
  assertIncludes(home, "保存", "Insight 卡片必须提供保存反馈按钮。未找到“保存”。");
  assertIncludes(home, "没用", "Insight 卡片必须提供负反馈按钮。未找到“没用”。");
  assertNotIncludes(home, "<h2>CLI</h2>", "普通用户试用页不应直接暴露 CLI 区块，容易误以为页面里出现 terminal。");
  assertNotIncludes(home, "<pre>scripts/podcast-note", "普通用户试用页不应显示大块终端命令，避免遮挡正文和造成困惑。");
  assertNotIncludes(home, "运行一次等价于", "运行一次说明不应以 terminal 命令作为用户解释，避免用户困惑。");
  assertIncludes(home, "状态与辅助命令", "CLI 信息应降级为折叠的辅助说明，默认不干扰主流程。");
  assertIncludes(home, "页面操作不需要打开终端", "辅助说明需要明确普通试用不需要终端。");
  assertNotIncludes(home, "No insights yet. Run the worker once after configuring real sources.", "首页不能再显示旧的不可操作空态文案。");

  const createResponse = postForm(`${url}/api/watches`, {
    name: "试用主题",
    query: "AI agent workflow",
    includeTerms: "AI agent, workflow",
    excludeTerms: "sports",
    minRelevanceScore: "0.65",
    frequency: "realtime",
    backfillDays: "14"
  });
  if (!createResponse.includes("/")) {
    throw new Error(`创建 Watch 后应重定向回首页，got ${createResponse}`);
  }

  const seededResponse = postForm(`${url}/api/demo`, {});
  if (!seededResponse.includes("/")) {
    throw new Error(`生成示例数据后应重定向回首页，got ${seededResponse}`);
  }

  const refreshed = fetchText(url);
  assertIncludes(refreshed, "试用主题", "创建 Watch 后首页应显示新主题。未找到“试用主题”。");
  assertIncludes(refreshed, "实时（M1 本地预览会按每天运行）", "选择实时频率时，首页应明确说明本地预览降级为每天运行。未找到降级提示。");
  assertIncludes(refreshed, "AI Agent 产品团队", "生成示例数据后 Inbox 应出现可读的中文示例 insight。未找到示例标题。待修复 UI 空态。 ");
  assertIncludes(refreshed, "为什么重要", "Insight 卡片应说明价值/影响，不只是原始 JSON 字段。未找到“为什么重要”。");
  assertIncludes(refreshed, "证据", "Insight 卡片应展示证据摘录，方便判断可信度。未找到“证据”。");
  assertIncludes(refreshed, "打开原文", "Insight 卡片应提供打开原文链接。未找到“打开原文”。");
  assertIncludes(refreshed, "运行一次", "首页需要保留 worker 手动运行入口。未找到“运行一次”。");

  const summaryBeforeFeedback = JSON.parse(fetchText(`${url}/api/summary`));
  const insightId = summaryBeforeFeedback.inbox?.[0]?.id;
  if (!insightId) {
    throw new Error(`生成示例数据后 /api/summary 应返回 inbox insight，got ${JSON.stringify(summaryBeforeFeedback)}`);
  }
  const feedbackResponse = postForm(`${url}/api/feedback`, { insightId, action: "saved" });
  if (!feedbackResponse.includes("/")) {
    throw new Error(`保存反馈后应重定向回首页，got ${feedbackResponse}`);
  }
  const afterFeedback = fetchText(url);
  assertIncludes(afterFeedback, "已保存", "提交保存反馈后 Insight 卡片应显示已保存状态。");

  console.log(JSON.stringify({ ok: true, port, dbPath }, null, 2));
} finally {
  if (server) server.kill();
  rmSync(dir, { recursive: true, force: true });
}

function waitForHealth(baseUrl: string): void {
  const deadline = Date.now() + 10_000;
  let lastError = "";
  while (Date.now() < deadline) {
    const result = spawnSync("curl", ["-fsS", `${baseUrl}/health`], { encoding: "utf8" });
    if (result.status === 0) return;
    lastError = result.stderr || result.stdout;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  throw new Error(`Preview server did not become healthy: ${lastError}`);
}

function fetchText(targetUrl: string): string {
  const result = spawnSync("curl", ["-fsS", targetUrl], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`GET ${targetUrl} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function postForm(targetUrl: string, fields: Record<string, string>): string {
  const args = ["-fsS", "-X", "POST"];
  for (const [key, value] of Object.entries(fields)) {
    args.push("--data-urlencode", `${key}=${value}`);
  }
  args.push("-D", "-", "-o", "/dev/null", targetUrl);
  const result = spawnSync("curl", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`POST ${targetUrl} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function assertIncludes(haystack: string, needle: string, message: string): void {
  if (!haystack.includes(needle)) throw new Error(message);
}

function assertNotIncludes(haystack: string, needle: string, message: string): void {
  if (haystack.includes(needle)) throw new Error(message);
}
