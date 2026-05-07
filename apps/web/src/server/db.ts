import { createRepositories, openPodcastNoteDb } from "../../../../packages/db/src/index.ts";

export function webRepositories(dbPath = process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite") {
  return createRepositories(openPodcastNoteDb(dbPath));
}
