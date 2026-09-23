import { readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { isErrno, writeAtomically } from './files.js';

const MILLISECONDS_PER_DAY = 86_400_000;

const DAILY_FILE = /^(\d{4}-\d{2}-\d{2})\.md$/;
const DAY_SECTION = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/;
const DAILY_TITLE = '# Jobs radar';

export const HISTORY_FILE = 'history.md';

const HISTORY_TITLE = '# Jobs radar history';

// The working folder should hold the days still worth opening. Everything older moves into one
// history file, whole: the notes, the ticked boxes and the sections the user added themselves.
// Nothing is summarised away, because the record of what you applied to is the point of keeping it.
export async function rotate(outDir: string, today: string, retentionDays: number): Promise<string[]> {
    if (retentionDays <= 0) {
        return [];
    }

    const cutoff = daysBefore(today, retentionDays);
    const stale = (await listDays(outDir)).filter((day) => day < cutoff);
    if (stale.length === 0) {
        return [];
    }

    const history = await readHistory(join(outDir, HISTORY_FILE));

    const archived: string[] = [];
    for (const day of stale) {
        const body = bodyOf(await readFile(join(outDir, `${day}.md`), 'utf8'));
        if (body === undefined) {
            // Not a file this sink wrote, whatever its name says. Leave it where it is.
            continue;
        }
        history.set(day, body);
        archived.push(day);
    }

    if (archived.length === 0) {
        return [];
    }

    // History is written first. If the unlink below fails, the next run finds the same day again
    // and overwrites its own entry, which costs nothing.
    await writeAtomically(join(outDir, HISTORY_FILE), renderHistory(history));

    for (const day of archived) {
        await unlink(join(outDir, `${day}.md`));
    }

    return archived;
}

// ISO dates sort lexicographically in the same order they do chronologically, so the whole of this
// file compares them as strings and never builds a Date except here.
function daysBefore(day: string, days: number): string {
    const time = Date.parse(`${day}T00:00:00Z`) - days * MILLISECONDS_PER_DAY;
    return new Date(time).toISOString().slice(0, 10);
}

async function listDays(outDir: string): Promise<string[]> {
    let names: string[];
    try {
        names = await readdir(outDir);
    } catch (error) {
        if (isErrno(error) && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    return names
        .map((name) => DAILY_FILE.exec(name)?.[1])
        .filter((day): day is string => day !== undefined)
        .sort();
}

function bodyOf(content: string): string | undefined {
    const lines = content.split('\n');
    const title = lines.findIndex((line) => line.startsWith(DAILY_TITLE));
    if (title === -1) {
        return undefined;
    }

    // The day becomes a section of the history file, so its own sections drop one level.
    return lines
        .slice(title + 1)
        .map((line) => (line.startsWith('## ') ? `#${line}` : line))
        .join('\n')
        .trim();
}

async function readHistory(path: string): Promise<Map<string, string>> {
    let content: string;
    try {
        content = await readFile(path, 'utf8');
    } catch (error) {
        if (isErrno(error) && error.code === 'ENOENT') {
            return new Map();
        }
        throw error;
    }

    const days = new Map<string, string>();
    let day: string | undefined;
    let body: string[] = [];

    const close = (): void => {
        if (day !== undefined) {
            days.set(day, body.join('\n').trim());
        }
    };

    for (const line of content.split('\n')) {
        const section = DAY_SECTION.exec(line);
        if (section !== null) {
            close();
            day = section[1];
            body = [];
            continue;
        }
        if (day !== undefined) {
            body.push(line);
        }
    }
    close();

    return days;
}

function renderHistory(days: Map<string, string>): string {
    // Newest first: the reason to open this file is almost always something recent.
    const sorted = [...days.entries()].sort(([left], [right]) => right.localeCompare(left));
    const lines = [HISTORY_TITLE, ''];

    for (const [day, body] of sorted) {
        lines.push(`## ${day}`, '', body, '');
    }

    return `${lines.join('\n').trimEnd()}\n`;
}
