# Lark Natural Language Bot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users control Podcast Note from the Feishu/Lark bot input box: process a specific episode, create podcast monitors, query status, and retry or pause tasks through natural language.

**Architecture:** Reuse the existing `im.message.receive_v1` WebSocket consumer as the entry point. Add a small command-understanding layer that turns message text into safe structured intents, executes only deterministic backend actions, and replies through the existing Lark bot client. Keep processing asynchronous by creating watches or episode-processing jobs instead of blocking the message event handler.

**Tech Stack:** Bun TypeScript, SQLite repositories, existing Lark WebSocket event consumer, existing watch and episode-processing queue, smoke-check scripts under `apps/worker/src/check-*.ts`.

---

### Task 1: URL Commands

**Files:**
- Create: `apps/worker/src/lark-command-router.ts`
- Create: `apps/worker/src/check-lark-command-url.ts`
- Modify: `apps/worker/src/lark-bot-events.ts`

**Steps:**
1. Write a failing smoke test where a p2p Lark message with a Xiaoyuzhou episode URL creates a queued episode-processing job and replies that processing started.
2. Write a failing smoke test where a p2p Lark message with a Xiaoyuzhou podcast URL creates or reuses a monitor watch and replies with the watch status.
3. Implement `parseLarkBotIntent()` for URL-first command detection.
4. Implement `handleLarkBotCommand()` to record the personal chat, create the watch/job, and return reply text.
5. Wire `handleLarkMessageReceivedEvent()` to call the command router before the generic bind/help reply.
6. Run the URL smoke test and existing Lark consumer checks.

### Task 2: Confirmation Sessions

**Files:**
- Modify: `packages/db/src/sqlite.ts`
- Modify: `packages/db/sqlite/0001_initial.sql`
- Modify: `packages/db/src/repositories.ts`
- Create: `apps/worker/src/check-lark-command-confirmation.ts`
- Modify: `apps/worker/src/lark-command-router.ts`

**Steps:**
1. Add `lark_pending_intents` with workspace/chat/sender, intent JSON, status, expiry, and completion timestamps.
2. Add repository methods to create, fetch latest pending, complete, cancel, and expire pending intents.
3. Write failing smoke tests for ambiguous monitor text requiring confirmation.
4. Implement text confirmation: `确认` executes the pending intent, `取消` cancels it.
5. Run confirmation smoke tests and DB import checks.

### Task 3: Natural Language Monitor Creation

**Files:**
- Create: `apps/worker/src/check-lark-command-natural-watch.ts`
- Modify: `apps/worker/src/lark-command-router.ts`

**Steps:**
1. Write failing smoke tests for messages like `监控硅谷101` and `帮我关注 AI炼金术，每天检查`.
2. Implement deterministic natural language parsing for monitor verbs, frequency words, and channel names.
3. Resolve known existing channels from `sources` and `episodes` before falling back to a search-style pending confirmation.
4. Ensure duplicate monitors are reused, not duplicated.
5. Run natural-watch smoke tests.

### Task 4: Operations Commands

**Files:**
- Create: `apps/worker/src/check-lark-command-ops.ts`
- Modify: `apps/worker/src/lark-command-router.ts`

**Steps:**
1. Write failing smoke tests for `状态`, `重试失败`, `暂停 硅谷101`, and `恢复 硅谷101`.
2. Implement watch lookup by display name or URL.
3. Implement safe status summary, failed job requeue, pause, and resume.
4. Require confirmation for destructive delete; do not implement delete in the first pass.
5. Run ops smoke tests.

### Task 5: Final Integration

**Files:**
- Modify: `apps/worker/src/check-lark-message-consumer.ts`
- Modify: `apps/worker/src/check-lark-bot-events.ts`
- Modify: `README.md`

**Steps:**
1. Extend the existing fake `lark-cli` consumer smoke to send a real command and assert the backend action.
2. Document supported Feishu bot messages.
3. Run all Lark command smoke tests plus import and no-mock checks.
4. Commit and push.
