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

## Verification

From the repository root:

```bash
bun run check:web-m15
```

The check seeds an isolated SQLite database, creates a local session, creates/pauses a Watch, hydrates inbox and episode detail, records feedback and playback usage, then asserts workspace-scoped results.

## Next product step

This slice provides the service contract for real pages. The next UI iteration can replace the placeholder `src/app/page.tsx` with React/Next.js components that call these server helpers, then add CSS/layout and browser-level tests.
