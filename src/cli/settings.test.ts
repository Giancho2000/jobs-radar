import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSettings } from './settings.js';

const CWD = resolve('/tmp/project');

describe('resolveSettings', () => {
    it('puts everything under the working directory by default', () => {
        const settings = resolveSettings({}, CWD);

        expect(settings.root).toBe(CWD);
        expect(settings.outDir).toBe(resolve(CWD, 'out'));
        expect(settings.databasePath).toBe(resolve(CWD, 'data', 'seen.sqlite'));
    });

    it('lets a cron entry point one install at another folder', () => {
        const settings = resolveSettings({ JOBS_RADAR_ROOT: resolve('/srv/radar') }, CWD);

        expect(settings.root).toBe(resolve('/srv/radar'));
        expect(settings.outDir).toBe(resolve('/srv/radar/out'));
    });

    it('resolves the output directory against the root', () => {
        const settings = resolveSettings({ JOBS_RADAR_OUT_DIR: 'notes/jobs' }, CWD);

        expect(settings.outDir).toBe(resolve(CWD, 'notes/jobs'));
    });

    it('accepts an absolute output directory', () => {
        const elsewhere = resolve('/home/me/vault');
        const settings = resolveSettings({ JOBS_RADAR_OUT_DIR: elsewhere }, CWD);

        expect(settings.outDir).toBe(elsewhere);
    });

    it('has the defaults the README promises', () => {
        const settings = resolveSettings({}, CWD);

        expect(settings).toMatchObject({
            retentionDays: 14,
            watchMinutes: 5,
            lookbackDays: 30,
            maxScored: 40,
        });
    });

    it('reads the numbers from the environment', () => {
        const settings = resolveSettings(
            {
                JOBS_RADAR_RETENTION_DAYS: '30',
                JOBS_RADAR_WATCH_MINUTES: '15',
                JOBS_RADAR_SINCE_DAYS: '7',
                JOBS_RADAR_MAX_SCORED: '5',
            },
            CWD
        );

        expect(settings).toMatchObject({
            retentionDays: 30,
            watchMinutes: 15,
            lookbackDays: 7,
            maxScored: 5,
        });
    });

    it('takes zero, which is how the ceilings are turned off', () => {
        const settings = resolveSettings(
            { JOBS_RADAR_RETENTION_DAYS: '0', JOBS_RADAR_MAX_SCORED: '0' },
            CWD
        );

        expect(settings.retentionDays).toBe(0);
        expect(settings.maxScored).toBe(0);
    });

    it('ignores a number that is not one', () => {
        const settings = resolveSettings(
            { JOBS_RADAR_MAX_SCORED: 'plenty', JOBS_RADAR_WATCH_MINUTES: '-3' },
            CWD
        );

        expect(settings.maxScored).toBe(40);
        expect(settings.watchMinutes).toBe(5);
    });

    it('defaults the timezone to the one this machine is in', () => {
        const settings = resolveSettings({}, CWD);

        expect(settings.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    });

    it('lets a server run in another timezone than its user', () => {
        expect(resolveSettings({ JOBS_RADAR_TIMEZONE: 'America/Bogota' }, CWD).timezone).toBe(
            'America/Bogota'
        );
    });
});
