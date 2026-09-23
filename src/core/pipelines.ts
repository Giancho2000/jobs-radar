import { dedupeBatch } from './dedup.js';
import { applyHardFilters, type FilterRule } from './filters.js';
import { normalizeAll } from './normalize.js';
import type {
    DedupStore,
    Profile,
    RawVacancy,
    RunContext,
    ScoredVacancy,
    ScorerPort,
    SinkPort,
    SourcePort,
    Vacancy,
} from './types.js';

const MILLISECONDS_PER_DAY = 86_400_000;

// How far back sources are asked to look. It is a safety net for a run that did not happen
// yesterday, not the thing that prevents repeats: that is the dedup store.
const LOOKBACK_DAYS = 7;

// Enough to keep the wall clock down, low enough not to trip rate limits. The first few requests
// of a run all miss the prompt cache because none of them has finished writing it yet.
const SCORING_CONCURRENCY = 4;

export interface RunSummary {
    fetched: number;
    duplicatesInRun: number;
    alreadySeen: number;
    rejected: number;
    rejectedByRule: Record<FilterRule, number>;
    scored: number;
    failedToScore: number;
    emitted: number;
}

export async function run(
    sources: SourcePort[],
    scorer: ScorerPort,
    sinks: SinkPort[],
    store: DedupStore,
    profile: Profile,
    ctx: RunContext
): Promise<RunSummary> {
    const since = new Date(ctx.runAt.getTime() - LOOKBACK_DAYS * MILLISECONDS_PER_DAY);

    const raw = await ingest(sources, since);
    const vacancies = dedupeBatch(normalizeAll(raw, ctx.runAt));
    const fresh = await onlyNew(vacancies, store);
    const { kept, rejected } = applyHardFilters(fresh, profile.criteria);

    const { scored, failed } = await scoreAll(kept, scorer, profile);
    const emitted = scored.filter((item) => item.score.value >= profile.criteria.scoreThreshold);

    const delivered = await emit(sinks, emitted, ctx);

    // Only what cost an LLM call is remembered. What the hard filters rejected is cheap to judge
    // again, and forgetting it means a change in profile.yml actually brings those vacancies back
    // instead of leaving them buried under criteria the user no longer has.
    // If every sink failed, nothing is recorded and the whole batch comes back on the next run.
    if (delivered) {
        for (const item of scored) {
            await store.remember(item.vacancy);
        }
    } else if (emitted.length > 0) {
        console.warn('[pipeline] every sink failed, so nothing was recorded as seen');
    }

    return {
        fetched: raw.length,
        duplicatesInRun: raw.length - vacancies.length,
        alreadySeen: vacancies.length - fresh.length,
        rejected: rejected.length,
        rejectedByRule: countByRule(rejected.map((rejection) => rejection.rule)),
        scored: scored.length,
        failedToScore: failed,
        emitted: emitted.length,
    };
}

// One source being down is a warning, never the end of the run.
async function ingest(sources: SourcePort[], since: Date): Promise<RawVacancy[]> {
    const results = await Promise.allSettled(sources.map((source) => source.fetch(since)));

    const raw: RawVacancy[] = [];
    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            raw.push(...result.value);
        } else {
            console.warn(`[pipeline] source "${sources[index]?.name}" failed: ${asMessage(result.reason)}`);
        }
    });

    return raw;
}

async function onlyNew(vacancies: Vacancy[], store: DedupStore): Promise<Vacancy[]> {
    const fresh: Vacancy[] = [];

    for (const vacancy of vacancies) {
        if (await store.isNew(vacancy.dedupKey)) {
            fresh.push(vacancy);
        }
    }

    return fresh;
}

// A vacancy that cannot be scored is not recorded as seen, so the next run tries it again.
async function scoreAll(
    vacancies: Vacancy[],
    scorer: ScorerPort,
    profile: Profile
): Promise<{ scored: ScoredVacancy[]; failed: number }> {
    const scored: ScoredVacancy[] = [];
    let failed = 0;

    await mapWithConcurrency(vacancies, SCORING_CONCURRENCY, async (vacancy) => {
        try {
            scored.push({ vacancy, score: await scorer.score(vacancy, profile) });
        } catch (error) {
            failed += 1;
            console.warn(`[pipeline] could not score "${vacancy.title}": ${asMessage(error)}`);
        }
    });

    return { scored, failed };
}

async function emit(sinks: SinkPort[], items: ScoredVacancy[], ctx: RunContext): Promise<boolean> {
    const results = await Promise.allSettled(sinks.map((sink) => sink.emit(items, ctx)));

    let delivered = false;
    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            delivered = true;
        } else {
            console.warn(`[pipeline] sink "${sinks[index]?.name}" failed: ${asMessage(result.reason)}`);
        }
    });

    return delivered;
}

async function mapWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>
): Promise<void> {
    let next = 0;

    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        for (;;) {
            const index = next;
            next += 1;
            if (index >= items.length) {
                return;
            }
            const item = items[index];
            if (item !== undefined) {
                await worker(item);
            }
        }
    });

    await Promise.all(runners);
}

function countByRule(rules: FilterRule[]): Record<FilterRule, number> {
    const counts: Record<FilterRule, number> = {
        excludedKeyword: 0,
        seniority: 0,
        workMode: 0,
        location: 0,
    };

    for (const rule of rules) {
        counts[rule] += 1;
    }

    return counts;
}

function asMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
