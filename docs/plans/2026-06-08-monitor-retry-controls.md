# Monitor Retry Controls Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make monitor episode processing recoverable without manual database edits or code changes.

**Architecture:** Add repository helpers for stale/failed job recovery, cap automatic retries at three attempts, and expose manual retry actions from the monitor UI. Scheduler ticks run watchdog recovery before normal queue processing.

**Tech Stack:** Bun, TypeScript, SQLite, existing preview server and worker check scripts.

---

### Task 1: Retry Repository Semantics

**Files:**
- Modify: `packages/db/src/repositories.ts`
- Test: `apps/worker/src/check-stale-episode-processing-jobs.ts`

**Steps:**
1. Extend stale job recovery to fail the old processing run and episode status.
2. Requeue stale running jobs only when attempts are below the automatic retry cap.
3. Keep jobs at or above the cap failed with a clear error.
4. Verify with `bun apps/worker/src/check-stale-episode-processing-jobs.ts`.

### Task 2: Scheduler Retry Policy

**Files:**
- Modify: `apps/web/src/server/preview.ts`
- Test: `apps/worker/src/check-monitor-requeue-patterns.ts`

**Steps:**
1. Add max automatic retry configuration, default 3.
2. Apply the cap to transient failed job requeue.
3. Verify transient network patterns are covered.

### Task 3: Manual Retry UI

**Files:**
- Modify: `apps/web/src/server/preview.ts`
- Test: `apps/worker/src/check-preview-ui.ts`

**Steps:**
1. Add monitor action `retry-failed` for all failed items under one watch.
2. Add episode action `retry-episode` for one failed/stale episode.
3. Render buttons in monitor progress when failures exist.
4. Verify through preview UI check.
