# Web App

M1.5 adds the first product-facing Web App slice for Podcast Note. The code is intentionally server-first so it can be tested deterministically with Bun while remaining compatible with a future Next.js App Router UI.

## Implemented in M1.5

- Minimal app scaffold under `src/app/`.
- Server-side app service in `src/server/m1-app.ts`.
- Local session/context helpers backed by the shared SQLite repositories.
- Workspace-scoped Watch create/update/list helpers for the Watch management screen.
- Inbox hydration for published insights with episode/watch metadata.
- Episode detail hydration with player metadata, transcript, summary and feedback state.
- Feedback and usage-event recording for save/irrelevant/wrong/archive, inbox/detail views, and playback.
- A local Bun HTTP preview server in `src/server/preview.ts`, launched by `scripts/podcast-note`, for immediate hands-on trial without a full Next.js runtime.

## Verification

From the repository root:

```bash
bun run check:web-m15
bun run check:preview-ui
```

`check:web-m15` seeds an isolated SQLite database, creates a local session, creates/pauses a Watch, hydrates inbox and episode detail, records feedback and playback usage, then asserts workspace-scoped results.

`check:preview-ui` starts the Bun preview server against an isolated SQLite database and verifies the actual trial workflow: homepage guidance, Watch form submit, one-click demo data, readable Inbox card, source link, and save feedback.

## Local preview

From the repository root:

```bash
scripts/podcast-note start
```

Open `http://127.0.0.1:3000` and use the page in this order: add a Watch, click `生成示例数据` if you do not have real source data yet, review the Inbox insight, then click `保存` or `没用` to confirm feedback works. Use `运行一次` when you want to run the M1 worker loop against the local database.

Manage the process with `scripts/podcast-note status`, `scripts/podcast-note restart`, `scripts/podcast-note run-once`, `scripts/podcast-note logs`, and `scripts/podcast-note stop`.

## Next product step

This slice provides the service contract for real pages. The next UI iteration can replace the placeholder `src/app/page.tsx` with React/Next.js components that call these server helpers, then add CSS/layout and browser-level tests.
