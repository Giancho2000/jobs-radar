import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunContext, ScoredVacancy, SinkPort, Verdict } from '../core/types.js';

const MILLISECONDS_PER_DAY = 86_400_000;

const SECTIONS: Array<readonly [Verdict, string]> = [
    ['apply', 'Apply'],
    ['view', 'Worth a look'],
    ['save', 'Keep for later'],
];

export function createMarkdownSink(): SinkPort {
    return {
        name: 'markdown',

        async emit(items: ScoredVacancy[], ctx: RunContext): Promise<void> {
            const day = formatDay(ctx.runAt, ctx.timezone);

            await mkdir(ctx.outDir, { recursive: true });
            await writeFile(join(ctx.outDir, `${day}.md`), render(items, ctx, day), 'utf8');
        },
    };
}

export function render(items: ScoredVacancy[], ctx: RunContext, day: string): string {
    const sorted = [...items].sort((left, right) => right.score.value - left.score.value);
    const lines: string[] = [`# Jobs radar ${day}`, '', headline(sorted), ''];

    for (const [verdict, heading] of SECTIONS) {
        const section = sorted.filter((item) => item.score.verdict === verdict);
        if (section.length === 0) {
            continue;
        }

        lines.push(`## ${heading} (${section.length})`, '');
        for (const item of section) {
            lines.push(...renderItem(item, ctx));
        }
    }

    return `${lines.join('\n').trimEnd()}\n`;
}

function headline(items: ScoredVacancy[]): string {
    if (items.length === 0) {
        return 'Nothing new made it through today.';
    }

    const best = items[0]?.score.value ?? 0;
    const noun = items.length === 1 ? 'vacancy' : 'vacancies';
    return `${items.length} ${noun}, best score ${best}.`;
}

function renderItem(item: ScoredVacancy, ctx: RunContext): string[] {
    const { vacancy, score } = item;

    // The id comment is what lets the next run find this line again and restore a ticked box.
    // Obsidian does not render it, and it survives a change of title.
    const head =
        `- [ ] \`${score.value}\` **${escape(vacancy.title)}** at ${escape(vacancy.company)} ` +
        `- [apply](${vacancy.applyUrl}) <!-- ${vacancy.id} -->`;

    const details = [
        score.reason.trim(),
        labelled('Matched', score.matchedStack),
        labelled('Critical gaps', score.criticalGaps),
        labelled('Minor gaps', score.minorGaps),
        labelled('Red flags', score.redFlags),
        labelled('Missing for ATS', score.missingAtsKeywords),
        context(item, ctx),
    ].filter((detail): detail is string => detail.length > 0);

    return [head, ...details.map((detail) => `    - ${detail}`), ''];
}

function context(item: ScoredVacancy, ctx: RunContext): string {
    const { vacancy, score } = item;

    return [
        workMode(vacancy.remote),
        vacancy.location ?? 'location not stated',
        freshness(vacancy.postedAt, ctx.runAt),
        `via ${vacancy.source}`,
        `confidence ${score.confidence}`,
    ].join(' - ');
}

function workMode(remote: boolean | undefined): string {
    if (remote === undefined) {
        return 'work mode not stated';
    }
    return remote ? 'remote' : 'on premises';
}

// Every vacancy says how old it is. The LinkedIn alerts this project reads are daily, so a line
// that hides its age would be misleading.
function freshness(postedAt: Date | undefined, runAt: Date): string {
    if (postedAt === undefined) {
        return 'posted date unknown';
    }

    const days = Math.floor((runAt.getTime() - postedAt.getTime()) / MILLISECONDS_PER_DAY);
    if (days <= 0) {
        return 'posted today';
    }
    if (days === 1) {
        return 'posted yesterday';
    }
    return `posted ${days} days ago`;
}

function labelled(label: string, values: string[]): string {
    return values.length === 0 ? '' : `${label}: ${values.map(escape).join(', ')}`;
}

// Titles like "C++ / C# Developer" or "Node_js" would otherwise turn into emphasis or worse.
function escape(value: string): string {
    return value.replace(/([\\`*_[\]<>])/g, '\\$1');
}

// The day the file is named after is the day where the user lives, not where the process runs.
// en-CA is the shortest way to an ISO date out of Intl without pulling in a date library.
export function formatDay(runAt: Date, timezone: string): string {
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(runAt);
    } catch {
        // An invalid timezone is not worth losing a run over
        return runAt.toISOString().slice(0, 10);
    }
}
