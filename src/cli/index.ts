#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { ConfigError, ScoringError, StoreError } from '../core/errors.js';
import { demo } from './demo.js';
import { doctor } from './doctor.js';
import { report, runOnce, watch } from './run.js';
import { resolveSettings } from './settings.js';

const USAGE = `jobs-radar

  run       read the sources once, score what is new and write the file of the day
  watch     the same, every JOBS_RADAR_WATCH_MINUTES minutes, until Ctrl+C
  demo      produce a file from made up vacancies: no key, no network, nothing recorded
  doctor    check the configuration without spending anything

  --every <minutes>   watch only, overrides JOBS_RADAR_WATCH_MINUTES
  --help              this text
`;

async function main(argv: string[]): Promise<number> {
    const { values, positionals } = parseArgs({
        args: argv,
        options: {
            every: { type: 'string' },
            help: { type: 'boolean', short: 'h' },
        },
        allowPositionals: true,
    });

    const command = positionals[0] ?? 'help';
    if (values.help === true || command === 'help') {
        console.log(USAGE);
        return 0;
    }

    const settings = resolveSettings();

    switch (command) {
        case 'run': {
            report(await runOnce(settings), settings);
            return 0;
        }
        case 'watch': {
            const every = values.every === undefined ? settings.watchMinutes : Number.parseInt(values.every, 10);
            if (!Number.isFinite(every) || every <= 0) {
                throw new ConfigError(`--every expects a number of minutes, got "${values.every}".`);
            }
            await watch({ ...settings, watchMinutes: every });
            return 0;
        }
        case 'demo': {
            await demo(settings);
            return 0;
        }
        case 'doctor': {
            return (await doctor(settings)) ? 0 : 1;
        }
        default: {
            console.error(`Unknown command "${command}".\n`);
            console.log(USAGE);
            return 1;
        }
    }
}

try {
    process.exitCode = await main(process.argv.slice(2));
} catch (error) {
    // These three carry a message written for the person reading it, so no stack is printed.
    if (error instanceof ConfigError || error instanceof StoreError || error instanceof ScoringError) {
        console.error(error.message);
    } else {
        console.error(error);
    }
    process.exitCode = 1;
}
