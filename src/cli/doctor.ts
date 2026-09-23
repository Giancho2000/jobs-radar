import { access, constants, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { loadCriteria, loadCv } from '../profile/loader.js';
import { loadSources } from '../sources/loader.js';
import { resolveLlmConfig } from '../scoring/index.js';
import { createSqliteStore } from '../store/sqlite.js';
import type { Settings } from './settings.js';

const REQUIRED_NODE = [22, 5] as const;
const GREENHOUSE_PROBE = 'https://boards-api.greenhouse.io/v1/boards';
const PROBE_TIMEOUT_MS = 10_000;

type Level = 'ok' | 'warn' | 'fail';

interface Check {
    level: Level;
    title: string;
    detail: string;
}

// Only checks that cost nothing. A paid provider is reported as configured or not, never tested:
// a doctor that quietly spends money is not a doctor.
export async function doctor(settings: Settings): Promise<boolean> {
    const checks: Check[] = [
        nodeVersion(),
        await resume(settings),
        await criteria(settings),
        ...(await sources(settings)),
        provider(),
        await writable(settings.outDir, 'Output directory'),
        await database(settings),
    ];

    for (const check of checks) {
        console.log(`${badge(check.level)} ${check.title}: ${check.detail}`);
    }

    const failed = checks.filter((check) => check.level === 'fail').length;
    console.log(
        failed === 0
            ? '\nEverything needed for a run is in place.'
            : `\n${failed} problem(s) to fix before a run will work.`
    );

    return failed === 0;
}

function badge(level: Level): string {
    return level === 'ok' ? '[ ok ]' : level === 'warn' ? '[warn]' : '[fail]';
}

function nodeVersion(): Check {
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
    const enough = major > REQUIRED_NODE[0] || (major === REQUIRED_NODE[0] && minor >= REQUIRED_NODE[1]);

    return {
        level: enough ? 'ok' : 'fail',
        title: 'Node',
        detail: enough
            ? process.versions.node
            : `${process.versions.node}, and node:sqlite needs ${REQUIRED_NODE.join('.')} or newer`,
    };
}

async function resume(settings: Settings): Promise<Check> {
    const path = join(settings.root, 'cv.md');

    try {
        const content = await loadCv(settings.root);
        return {
            level: content.length < 400 ? 'warn' : 'ok',
            title: 'Resume',
            detail:
                content.length < 400
                    ? `${short(path)} is only ${content.length} characters, which is thin for a match`
                    : `${short(path)}, ${content.length} characters`,
        };
    } catch (error) {
        return { level: 'fail', title: 'Resume', detail: message(error) };
    }
}

async function criteria(settings: Settings): Promise<Check> {
    try {
        const hard = await loadCriteria(settings.root);
        return {
            level: 'ok',
            title: 'Criteria',
            detail: `threshold ${hard.scoreThreshold}, ${hard.locations.length} location(s), ${hard.dealBreakers.length} deal breaker(s)`,
        };
    } catch (error) {
        return { level: 'fail', title: 'Criteria', detail: message(error) };
    }
}

async function sources(settings: Settings): Promise<Check[]> {
    let boards: string[];
    try {
        boards = (await loadSources(settings.root)).greenhouse;
    } catch (error) {
        return [{ level: 'fail', title: 'Sources', detail: message(error) }];
    }

    const checks: Check[] = [
        { level: 'ok', title: 'Sources', detail: `${boards.length} Greenhouse board(s)` },
    ];

    // The boards API is public and free, so asking it about one board costs nothing and catches
    // the most common mistake, which is a board token that does not exist.
    const first = boards[0];
    if (first !== undefined) {
        checks.push(await probeBoard(first));
    }

    return checks;
}

async function probeBoard(board: string): Promise<Check> {
    try {
        const response = await fetch(`${GREENHOUSE_PROBE}/${encodeURIComponent(board)}/jobs`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });

        if (!response.ok) {
            return {
                level: 'warn',
                title: `Board "${board}"`,
                detail: `HTTP ${response.status}, so that token is probably wrong`,
            };
        }

        const payload: unknown = await response.json();
        const jobs = (payload as { jobs?: unknown[] }).jobs?.length ?? 0;

        // An unknown token answers 404, but a token that belongs to a board nobody publishes to
        // answers 200 with nothing in it, which looks like success and is almost never what the
        // user meant.
        return jobs === 0
            ? {
                  level: 'warn',
                  title: `Board "${board}"`,
                  detail: 'it exists but publishes no open position right now',
              }
            : { level: 'ok', title: `Board "${board}"`, detail: `${jobs} open position(s)` };
    } catch (error) {
        return { level: 'warn', title: `Board "${board}"`, detail: `unreachable: ${message(error)}` };
    }
}

function provider(): Check {
    try {
        const config = resolveLlmConfig();
        const where = config.baseUrl === undefined ? '' : ` at ${config.baseUrl}`;

        return {
            level: 'ok',
            title: 'Model',
            detail:
                config.provider === 'ollama'
                    ? `${config.provider}, model ${config.model}${where}, nothing leaves this machine`
                    : `${config.provider}, model ${config.model}, key found (not tested, a test call costs money)`,
        };
    } catch (error) {
        return { level: 'fail', title: 'Model', detail: message(error) };
    }
}

async function writable(path: string, title: string): Promise<Check> {
    try {
        await mkdir(path, { recursive: true });
        await access(path, constants.W_OK);
        return { level: 'ok', title, detail: short(path) };
    } catch (error) {
        return { level: 'fail', title, detail: `${short(path)}: ${message(error)}` };
    }
}

async function database(settings: Settings): Promise<Check> {
    try {
        const store = createSqliteStore(settings.databasePath);
        await store.isNew('doctor');
        store.close();
        return { level: 'ok', title: 'Dedup store', detail: short(settings.databasePath) };
    } catch (error) {
        return { level: 'fail', title: 'Dedup store', detail: message(error) };
    }
}

function short(path: string): string {
    const relatively = relative(process.cwd(), path);
    return relatively.length === 0 || relatively.startsWith('..') ? path : relatively;
}

function message(error: unknown): string {
    return error instanceof Error ? error.message.split('\n')[0] ?? error.message : String(error);
}
