import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from './pipelines.js';
import type {
    DedupStore,
    Profile,
    RawVacancy,
    RunContext,
    Score,
    ScoredVacancy,
    ScorerPort,
    SinkPort,
    SourcePort,
    Vacancy,
} from './types.js';

const RUN_AT = new Date('2026-09-22T14:00:00Z');

const PROFILE: Profile = {
    cv: 'Backend developer. Node.js, TypeScript, PostgreSQL.',
    criteria: {
        seniorityLevels: ['mid', 'senior'],
        workModes: ['remote', 'hybrid'],
        locations: ['Colombia', 'Cali', 'LATAM', 'Remote'],
        dealBreakers: [],
        excludedKeywords: ['internship'],
        scoreThreshold: 75,
    },
};

const ago = (days: number): Date => new Date(RUN_AT.getTime() - days * 86_400_000);

const BOARD: RawVacancy[] = [
    { sourceId: '1', source: 'greenhouse', title: 'Sr. Node.js Engineer', company: 'Nu Colombia S.A.S.', location: 'Remote - Colombia', applyUrl: 'https://example.com/1', postedAt: ago(0) },
    { sourceId: '2', source: 'greenhouse', title: 'Backend Engineer', company: 'Acme Ltda.', location: 'Bogota, Colombia', applyUrl: 'https://example.com/2', postedAt: ago(3) },
    { sourceId: '3', source: 'greenhouse', title: 'Backend Internship', company: 'Acme Ltda.', location: 'Cali', applyUrl: 'https://example.com/3' },
    { sourceId: '4', source: 'greenhouse', title: 'Node Developer', company: 'Berlin GmbH', location: 'Berlin, Germany', applyUrl: 'https://example.com/4' },
    { sourceId: '99', source: 'linkedin', title: 'Senior Node.js Engineer (Remote)', company: 'Nu Colombia', applyUrl: 'https://example.com/99' },
];

function sourceOf(name: string, vacancies: RawVacancy[]): SourcePort {
    return { name, fetch: async () => vacancies };
}

const brokenSource: SourcePort = {
    name: 'lever',
    fetch: async () => {
        throw new Error('503 Service Unavailable');
    },
};

function scorerThat(decide: (vacancy: Vacancy) => number): ScorerPort & { calls: () => number } {
    let calls = 0;
    return {
        calls: () => calls,
        score: async (vacancy: Vacancy): Promise<Score> => {
            calls += 1;
            if (vacancy.title.includes('Berlin')) {
                throw new Error('the model is on fire');
            }
            const value = decide(vacancy);
            return {
                value,
                confidence: 'high',
                matchedStack: ['Node.js'],
                criticalGaps: [],
                minorGaps: [],
                redFlags: [],
                missingAtsKeywords: [],
                verdict: value >= 75 ? 'apply' : 'save',
                reason: 'Because.',
            };
        },
    };
}

function memoryStore(): DedupStore & { size: () => number } {
    const seen = new Set<string>();
    return {
        size: () => seen.size,
        isNew: async (key: string) => !seen.has(key),
        remember: async (vacancy: Vacancy) => {
            seen.add(vacancy.dedupKey);
        },
    };
}

function collectingSink(): SinkPort & { received: () => ScoredVacancy[] } {
    let received: ScoredVacancy[] = [];
    return {
        name: 'collector',
        received: () => received,
        emit: async (items) => {
            received = items;
        },
    };
}

const failingSink: SinkPort = {
    name: 'broken',
    emit: async () => {
        throw new Error('disk full');
    },
};

let outDir: string;
let ctx: RunContext;

beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'jobs-radar-pipeline-'));
    ctx = { runAt: RUN_AT, outDir, timezone: 'America/Bogota' };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
    vi.restoreAllMocks();
    await rm(outDir, { recursive: true, force: true });
});

describe('run', () => {
    it('reports every stage of the run', async () => {
        const summary = await run(
            [sourceOf('greenhouse', BOARD.filter((v) => v.source === 'greenhouse')), sourceOf('linkedin', BOARD.filter((v) => v.source === 'linkedin')), brokenSource],
            scorerThat((vacancy) => (vacancy.title.includes('Node') ? 91 : 48)),
            [collectingSink()],
            memoryStore(),
            PROFILE,
            ctx
        );

        expect(summary).toMatchObject({
            fetched: 5,
            duplicatesInRun: 1,
            alreadySeen: 0,
            rejected: 2,
            rejectedByRule: { excludedKeyword: 1, seniority: 0, workMode: 0, location: 1 },
            scored: 2,
            emitted: 1,
        });
    });

    it('keeps going when a source is down', async () => {
        const summary = await run([brokenSource, sourceOf('greenhouse', BOARD)], scorerThat(() => 91), [collectingSink()], memoryStore(), PROFILE, ctx);

        expect(summary.fetched).toBe(5);
    });

    it('only sends what is above the threshold to the sinks', async () => {
        const sink = collectingSink();

        await run([sourceOf('greenhouse', BOARD)], scorerThat((vacancy) => (vacancy.title.includes('Sr.') ? 91 : 10)), [sink], memoryStore(), PROFILE, ctx);

        expect(sink.received().map((item) => item.vacancy.sourceId)).toEqual(['1']);
    });

    it('does not record a vacancy that could not be scored, so the next run tries it again', async () => {
        const store = memoryStore();
        const scorer = scorerThat(() => 91);
        const germany: RawVacancy[] = [{ sourceId: '9', source: 'greenhouse', title: 'Berlin Engineer', company: 'Acme', location: 'Remote', applyUrl: 'https://example.com/9' }];

        const first = await run([sourceOf('greenhouse', germany)], scorer, [collectingSink()], store, PROFILE, ctx);
        const second = await run([sourceOf('greenhouse', germany)], scorer, [collectingSink()], store, PROFILE, ctx);

        expect(first.failedToScore).toBe(1);
        expect(second.alreadySeen).toBe(0);
        expect(scorer.calls()).toBe(2);
    });

    it('records nothing when every sink failed', async () => {
        const store = memoryStore();

        const summary = await run([sourceOf('greenhouse', BOARD)], scorerThat(() => 91), [failingSink], store, PROFILE, ctx);

        expect(summary.emitted).toBeGreaterThan(0);
        expect(store.size()).toBe(0);
    });

    it('forgets what the hard filters rejected, so a change of criteria brings it back', async () => {
        const store = memoryStore();
        const scorer = scorerThat(() => 91);

        await run([sourceOf('greenhouse', BOARD)], scorer, [collectingSink()], store, PROFILE, ctx);
        const second = await run([sourceOf('greenhouse', BOARD)], scorer, [collectingSink()], store, PROFILE, ctx);

        expect(second.rejected).toBe(2);
        expect(second.alreadySeen).toBe(2);
    });

    it('does not pay to score the same vacancy twice', async () => {
        const store = memoryStore();
        const scorer = scorerThat(() => 91);

        await run([sourceOf('greenhouse', BOARD)], scorer, [collectingSink()], store, PROFILE, ctx);
        const before = scorer.calls();
        await run([sourceOf('greenhouse', BOARD)], scorer, [collectingSink()], store, PROFILE, ctx);

        expect(scorer.calls()).toBe(before);
    });

    it('stops at the budget and holds the rest for the next run', async () => {
        const store = memoryStore();
        const scorer = scorerThat(() => 91);

        const summary = await run([sourceOf('greenhouse', BOARD)], scorer, [collectingSink()], store, PROFILE, ctx, { maxScored: 1 });

        expect(summary.scored).toBe(1);
        expect(summary.heldForNextRun).toBe(1);
        // newest first: the vacancy posted today, not the one posted three days ago
        expect(scorer.calls()).toBe(1);

        const second = await run([sourceOf('greenhouse', BOARD)], scorer, [collectingSink()], store, PROFILE, ctx, { maxScored: 1 });
        expect(second.scored).toBe(1);
        expect(second.heldForNextRun).toBe(0);
    });

    it('asks the sources for the window it was given', async () => {
        const fetch = vi.fn(async (_since: Date): Promise<RawVacancy[]> => []);

        await run([{ name: 'spy', fetch }], scorerThat(() => 0), [collectingSink()], memoryStore(), PROFILE, ctx, { lookbackDays: 10 });

        expect(fetch.mock.calls[0]?.[0]).toEqual(new Date('2026-09-12T14:00:00Z'));
    });

    it('writes a real file through a real sink', async () => {
        const { createMarkdownSink } = await import('../sinks/markdown.js');

        await run([sourceOf('greenhouse', BOARD)], scorerThat(() => 91), [createMarkdownSink({ retentionDays: 0 })], memoryStore(), PROFILE, ctx);

        const file = await readFile(join(outDir, '2026-09-22.md'), 'utf8');
        expect(file).toContain('<!-- greenhouse:1 -->');
    });
});
