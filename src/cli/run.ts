import { setTimeout as delay } from 'node:timers/promises';
import { join, relative } from 'node:path';
import { ConfigError } from '../core/errors.js';
import { run, type RunSummary } from '../core/pipelines.js';
import { loadProfile } from '../profile/loader.js';
import { createScorer } from '../scoring/index.js';
import { createGreenhouseSource } from '../sources/greenhouse.js';
import { loadSources } from '../sources/loader.js';
import { createMarkdownSink } from '../sinks/markdown.js';
import { formatDay } from '../sinks/markdown.js';
import { createSqliteStore } from '../store/sqlite.js';
import type { Settings } from './settings.js';

const MILLISECONDS_PER_MINUTE = 60_000;

// The composition root: the only place that knows which adapters this program is built from.
export async function runOnce(settings: Settings): Promise<RunSummary> {
    const profile = await loadProfile(settings.root);
    const sources = await loadSources(settings.root);
    const store = createSqliteStore(settings.databasePath);

    try {
        return await run(
            [createGreenhouseSource(sources.greenhouse)],
            createScorer(),
            [createMarkdownSink({ retentionDays: settings.retentionDays })],
            store,
            profile,
            { runAt: new Date(), outDir: settings.outDir, timezone: settings.timezone },
            { lookbackDays: settings.lookbackDays, maxScored: settings.maxScored }
        );
    } finally {
        store.close();
    }
}

export async function watch(settings: Settings): Promise<void> {
    const every = settings.watchMinutes;
    console.log(`Running every ${every} minute(s). Press Ctrl+C to stop.`);

    const stopping = new AbortController();
    let asked = false;
    process.on('SIGINT', () => {
        asked = true;
        stopping.abort();
        console.log('\nStopping.');
    });

    let first = true;
    while (!asked) {
        try {
            report(await runOnce(settings), settings);
        } catch (error) {
            // Broken configuration will not fix itself between two runs of the same process, and
            // an unattended loop that logs the same error every five minutes helps nobody.
            if (error instanceof ConfigError && first) {
                throw error;
            }
            console.error(`Run failed: ${error instanceof Error ? error.message : String(error)}`);
        }

        first = false;
        if (asked) {
            return;
        }

        await delay(every * MILLISECONDS_PER_MINUTE, undefined, { signal: stopping.signal }).catch(
            () => undefined
        );
    }
}

export function report(summary: RunSummary, settings: Settings): void {
    const day = formatDay(new Date(), settings.timezone);
    const file = relative(process.cwd(), join(settings.outDir, `${day}.md`));

    const lines = [
        `Fetched ${summary.fetched}` +
            detail([
                [summary.duplicatesInRun, 'duplicate in this run', 'duplicates in this run'],
                [summary.alreadySeen, 'already seen', 'already seen'],
            ]),
        `Rejected ${summary.rejected} by the hard filters${byRule(summary)}`,
        `Scored ${summary.scored}` +
            (summary.failedToScore > 0 ? `, ${summary.failedToScore} could not be scored` : '') +
            (summary.heldForNextRun > 0
                ? `, ${summary.heldForNextRun} held for the next run by the budget of ${settings.maxScored}`
                : ''),
        summary.emitted > 0
            ? `Wrote ${summary.emitted} to ${file}`
            : 'Nothing reached the threshold, so the file of the day is unchanged',
    ];

    console.log(lines.join('\n'));
}

function byRule(summary: RunSummary): string {
    const parts = Object.entries(summary.rejectedByRule)
        .filter(([, count]) => count > 0)
        .map(([rule, count]) => `${rule} ${count}`);

    return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}

function detail(parts: Array<[number, string, string]>): string {
    const written = parts
        .filter(([count]) => count > 0)
        .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);

    return written.length === 0 ? '' : `, ${written.join(', ')}`;
}
