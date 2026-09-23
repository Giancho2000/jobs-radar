import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreError } from '../core/errors.js';
import type { Vacancy } from '../core/types.js';
import { createSqliteStore } from './sqlite.js';

let dir: string;

const vacancy = (seenAt: string): Vacancy => ({
    id: 'greenhouse:4829',
    source: 'greenhouse',
    sourceId: '4829',
    title: 'Sr. Node.js Engineer',
    company: 'Nu Colombia S.A.S.',
    applyUrl: 'https://example.com/4829',
    dedupKey: 'the-key',
    seenAt: new Date(seenAt),
});

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jobs-radar-store-'));
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe('createSqliteStore', () => {
    it('creates the directory it was pointed at', async () => {
        const store = createSqliteStore(join(dir, 'nested', 'deeper', 'seen.sqlite'));

        await expect(store.isNew('anything')).resolves.toBe(true);
        store.close();
    });

    it('works in memory, which is what the tests need', async () => {
        const store = createSqliteStore(':memory:');

        await expect(store.isNew('anything')).resolves.toBe(true);
        store.close();
    });

    it('explains itself when the file cannot be opened', () => {
        expect(() => createSqliteStore(dir)).toThrow(StoreError);
        expect(() => createSqliteStore(dir)).toThrow(/Delete that file and it will be rebuilt/);
    });
});

describe('isNew and remember', () => {
    it('answers true until the vacancy is remembered', async () => {
        const store = createSqliteStore(':memory:');

        await expect(store.isNew('the-key')).resolves.toBe(true);
        await store.remember(vacancy('2026-09-22T10:00:00Z'));
        await expect(store.isNew('the-key')).resolves.toBe(false);

        store.close();
    });

    it('does not confuse one key with another', async () => {
        const store = createSqliteStore(':memory:');

        await store.remember(vacancy('2026-09-22T10:00:00Z'));

        await expect(store.isNew('another-key')).resolves.toBe(true);
        store.close();
    });

    it('survives closing and opening the file again', async () => {
        const path = join(dir, 'seen.sqlite');

        const first = createSqliteStore(path);
        await first.remember(vacancy('2026-09-22T10:00:00Z'));
        first.close();

        const second = createSqliteStore(path);
        await expect(second.isNew('the-key')).resolves.toBe(false);
        second.close();
    });

    it('keeps the first sighting and moves the last one', async () => {
        const path = join(dir, 'seen.sqlite');
        const store = createSqliteStore(path);

        await store.remember(vacancy('2026-09-22T10:00:00Z'));
        await store.remember(vacancy('2026-09-25T08:00:00Z'));
        store.close();

        const database = new DatabaseSync(path);
        const rows = database.prepare('SELECT first_seen_at, last_seen_at FROM seen_vacancies').all();
        database.close();

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            first_seen_at: '2026-09-22T10:00:00.000Z',
            last_seen_at: '2026-09-25T08:00:00.000Z',
        });
    });
});
