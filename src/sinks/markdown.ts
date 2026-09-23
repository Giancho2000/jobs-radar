import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunContext, ScoredVacancy, SinkPort, Verdict } from '../core/types.js';

const MILLISECONDS_PER_DAY = 86_400_000;

const SECTIONS: Array<readonly [Verdict, string]> = [
    ['apply', 'Apply'],
    ['view', 'Worth a look'],
    ['save', 'Keep for later'],
];

// "- [x] `91` **Title** ... <!-- greenhouse:4829 -->"
const ENTRY_LINE = /^- \[([ xX])\] `(\d+)`.*<!--\s*([^\s>]+)\s*-->/;
const HEADING_LINE = /^##\s+(.*?)(?:\s+\(\d+\))?\s*$/;

interface Entry {
    id: string;
    verdict: Verdict;
    value: number;
    checked: boolean;
    // Kept verbatim so that anything written under an entry by hand survives the next run.
    block: string[];
}

interface PreviousFile {
    entries: Entry[];
    // Headings this sink did not write are the user's own, and they are kept.
    foreign: string[];
}

export function createMarkdownSink(): SinkPort {
    return {
        name: 'markdown',

        async emit(items: ScoredVacancy[], ctx: RunContext): Promise<void> {
            const day = formatDay(ctx.runAt, ctx.timezone);
            const path = join(ctx.outDir, `${day}.md`);

            const previous = await readPrevious(path);
            const entries = merge(previous, items, ctx);

            await mkdir(ctx.outDir, { recursive: true });
            await writeAtomically(path, render(entries, day, previous?.foreign ?? []));
        },
    };
}

// The file of the day is rewritten on every run, so a run that finds nothing new must not erase
// what an earlier run found. Everything already in the file is read back first.
function merge(previous: PreviousFile | undefined, items: ScoredVacancy[], ctx: RunContext): Entry[] {
    const entries = new Map<string, Entry>();

    for (const entry of previous?.entries ?? []) {
        entries.set(entry.id, entry);
    }

    for (const item of items) {
        const existing = entries.get(item.vacancy.id);
        if (existing !== undefined) {
            // Already delivered. Rewriting it could only destroy a note or a ticked box.
            continue;
        }
        entries.set(item.vacancy.id, {
            id: item.vacancy.id,
            verdict: item.score.verdict,
            value: item.score.value,
            checked: false,
            block: renderItem(item, ctx),
        });
    }

    return [...entries.values()];
}

function render(entries: Entry[], day: string, foreign: string[]): string {
    const sorted = [...entries].sort((left, right) => right.value - left.value);
    const lines: string[] = [`# Jobs radar ${day}`, '', headline(sorted), ''];

    for (const [verdict, heading] of SECTIONS) {
        const section = sorted.filter((entry) => entry.verdict === verdict);
        if (section.length === 0) {
            continue;
        }

        lines.push(`## ${heading} (${section.length})`, '');
        for (const entry of section) {
            lines.push(...withCheckbox(entry), '');
        }
    }

    if (foreign.length > 0) {
        lines.push(...foreign);
    }

    return `${lines.join('\n').trimEnd()}\n`;
}

function withCheckbox(entry: Entry): string[] {
    const [head, ...rest] = entry.block;
    if (head === undefined) {
        return [];
    }

    const box = entry.checked ? '- [x]' : '- [ ]';
    return [head.replace(/^- \[[ xX]\]/, box), ...rest];
}

function headline(entries: Entry[]): string {
    if (entries.length === 0) {
        return 'Nothing new made it through today.';
    }

    const best = entries[0]?.value ?? 0;
    const noun = entries.length === 1 ? 'vacancy' : 'vacancies';
    const done = entries.filter((entry) => entry.checked).length;
    const ticked = done === 0 ? '' : `, ${done} ticked off`;

    return `${entries.length} ${noun}, best score ${best}${ticked}.`;
}

async function readPrevious(path: string): Promise<PreviousFile | undefined> {
    let content: string;
    try {
        content = await readFile(path, 'utf8');
    } catch (error) {
        if (isErrno(error) && error.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }

    // Never overwrite a file this sink did not write. Failing the run is recoverable; silently
    // replacing something the user put there is not.
    const title = content.split('\n').find((line) => line.trim().length > 0);
    if (title !== undefined && !title.startsWith('# Jobs radar')) {
        throw new Error(`${path} exists but was not written by jobs-radar, so it was left alone.`);
    }

    return parse(content);
}

export function parse(content: string): PreviousFile {
    const entries: Entry[] = [];
    const foreign: string[] = [];

    let verdict: Verdict | undefined;
    let outsideOurSections = false;
    let current: Entry | undefined;

    for (const line of content.split('\n')) {
        const heading = HEADING_LINE.exec(line);
        if (heading !== null) {
            current = undefined;
            verdict = verdictOf(heading[1] ?? '');
            outsideOurSections = verdict === undefined;
            if (outsideOurSections) {
                foreign.push(line);
            }
            continue;
        }

        if (outsideOurSections) {
            foreign.push(line);
            continue;
        }

        const entry = ENTRY_LINE.exec(line);
        if (entry !== null && verdict !== undefined) {
            current = {
                id: entry[3] ?? '',
                verdict,
                value: Number.parseInt(entry[2] ?? '0', 10),
                checked: (entry[1] ?? ' ').toLowerCase() === 'x',
                block: [line],
            };
            entries.push(current);
            continue;
        }

        // A block runs until the next entry or heading, not until the next blank line: a note
        // written under an entry usually has blank lines around it.
        current?.block.push(line);
    }

    for (const entry of entries) {
        trimTrailingBlanks(entry.block);
    }

    return { entries, foreign: trimmedForeign(foreign) };
}

function verdictOf(heading: string): Verdict | undefined {
    return SECTIONS.find(([, name]) => name === heading.trim())?.[0];
}

function trimTrailingBlanks(lines: string[]): void {
    while (lines.length > 1 && (lines[lines.length - 1] ?? '').trim() === '') {
        lines.pop();
    }
}

function trimmedForeign(lines: string[]): string[] {
    const copy = [...lines];
    trimTrailingBlanks(copy);
    return copy;
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
    ].filter((detail) => detail.length > 0);

    return [head, ...details.map((detail) => `    - ${detail}`)];
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

// A half written file is worse than an old one: this is the file the user reads every morning.
async function writeAtomically(path: string, content: string): Promise<void> {
    const temporary = `${path}.tmp`;
    await writeFile(temporary, content, 'utf8');
    await rename(temporary, path);
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

function isErrno(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error;
}
