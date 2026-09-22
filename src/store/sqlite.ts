import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { StoreError } from '../core/errors.js';
import type { DedupStore, Vacancy } from '../core/types.js';

const IN_MEMORY = ':memory:';

// Dates are stored as ISO-8601 text: SQLite has no date type and ISO strings sort
// lexicographically in the same order they do chronologically.
const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS seen_vacancies (
    dedup_key     TEXT PRIMARY KEY,
    id            TEXT NOT NULL,
    source        TEXT NOT NULL,
    company       TEXT NOT NULL,
    title         TEXT NOT NULL,
    apply_url     TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_seen_last_seen_at ON seen_vacancies (last_seen_at);

PRAGMA user_version = 1;
`;

const SELECT_SEEN = 'SELECT 1 FROM seen_vacancies WHERE dedup_key = ? LIMIT 1';

// first_seen_at survives the conflict on purpose: it is what tells how long a vacancy has been
// on the radar, which the freshness indicator needs later.
const UPSERT_SEEN = `
INSERT INTO seen_vacancies
    (dedup_key, id, source, company, title, apply_url, first_seen_at, last_seen_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(dedup_key) DO UPDATE SET last_seen_at = excluded.last_seen_at
`;

export function createSqliteStore(path: string): DedupStore & { close(): void } {
    const database = openDatabase(path);

    // prepared once, not per call
    const selectSeen = database.prepare(SELECT_SEEN);
    const upsertSeen = database.prepare(UPSERT_SEEN);

    return {
        // The port is async because another store could be remote. This one is not, and there is
        // nothing to await here.
        async isNew(dedupKey: string): Promise<boolean> {
            return selectSeen.get(dedupKey) === undefined;
        },

        async remember(vacancy: Vacancy): Promise<void> {
            const seenAt = vacancy.seenAt.toISOString();
            upsertSeen.run(
                vacancy.dedupKey,
                vacancy.id,
                vacancy.source,
                vacancy.company,
                vacancy.title,
                vacancy.applyUrl,
                seenAt,
                seenAt
            );
        },

        close(): void {
            database.close();
        },
    };
}

function openDatabase(path: string): DatabaseSync {
    try {
        if (path !== IN_MEMORY) {
            // data/ is gitignored, so on a fresh clone the directory does not exist yet and
            // DatabaseSync fails with an opaque SQLITE_CANTOPEN
            mkdirSync(dirname(path), { recursive: true });
        }

        const database = new DatabaseSync(path);
        database.exec(SCHEMA);
        return database;
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new StoreError(
            `Could not open the dedup database at ${path}: ${detail}. ` +
                'Delete that file and it will be rebuilt; the only loss is the history of already seen vacancies.'
        );
    }
}
