import { resolve } from 'node:path';

export interface Settings {
    root: string;
    outDir: string;
    dataDir: string;
    databasePath: string;
    timezone: string;
    retentionDays: number;
    watchMinutes: number;
    lookbackDays: number;
    maxScored: number;
}

const DEFAULTS = {
    outDir: 'out',
    dataDir: 'data',
    retentionDays: 14,
    watchMinutes: 5,
    lookbackDays: 30,
    maxScored: 40,
};

// Paths and cadence come from the environment so that a cron entry can point the same install at a
// different folder without editing a file.
export function resolveSettings(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): Settings {
    const root = resolve(env['JOBS_RADAR_ROOT'] ?? cwd);
    const outDir = resolve(root, env['JOBS_RADAR_OUT_DIR'] ?? DEFAULTS.outDir);
    const dataDir = resolve(root, env['JOBS_RADAR_DATA_DIR'] ?? DEFAULTS.dataDir);

    return {
        root,
        outDir,
        dataDir,
        databasePath: resolve(dataDir, 'seen.sqlite'),
        // The daily file is named after the day where the user lives, so their timezone is the
        // default and the variable is only for a server that runs somewhere else.
        timezone: env['JOBS_RADAR_TIMEZONE'] ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        retentionDays: positiveNumber(env['JOBS_RADAR_RETENTION_DAYS'], DEFAULTS.retentionDays),
        watchMinutes: positiveNumber(env['JOBS_RADAR_WATCH_MINUTES'], DEFAULTS.watchMinutes),
        lookbackDays: positiveNumber(env['JOBS_RADAR_SINCE_DAYS'], DEFAULTS.lookbackDays),
        // The ceiling on how many vacancies one run may send to the model, which is the ceiling
        // on what one run may cost. Zero means no ceiling.
        maxScored: positiveNumber(env['JOBS_RADAR_MAX_SCORED'], DEFAULTS.maxScored),
    };
}

function positiveNumber(value: string | undefined, fallback: number): number {
    if (value === undefined) {
        return fallback;
    }

    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
