import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../core/errors.js';
import { loadSources } from './loader.js';

let root: string;

const write = (content: string): Promise<void> =>
    writeFile(join(root, 'sources.yml'), content, 'utf8');

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'jobs-radar-sources-'));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('loadSources', () => {
    it('reads the board tokens', async () => {
        await write('greenhouse:\n  - gitlab\n  - cloudflare\n');

        await expect(loadSources(root)).resolves.toEqual({ greenhouse: ['gitlab', 'cloudflare'] });
    });

    it('accepts the inline form too', async () => {
        await write('greenhouse: [gitlab, cloudflare]\n');

        await expect(loadSources(root)).resolves.toEqual({ greenhouse: ['gitlab', 'cloudflare'] });
    });

    it('points at the example when the file is missing', async () => {
        await expect(loadSources(root)).rejects.toThrow(ConfigError);
        await expect(loadSources(root)).rejects.toThrow(/sources.example.yml/);
    });

    it('does not let a run start with nothing to read', async () => {
        await write('greenhouse: []\n');

        await expect(loadSources(root)).rejects.toThrow(/lists no sources/);
    });

    it('rejects a key it does not know', async () => {
        await write('greenhouse: [gitlab]\nlever: [acme]\n');

        await expect(loadSources(root)).rejects.toThrow(/lever/);
    });

    it('rejects an empty token', async () => {
        await write('greenhouse: [gitlab, "  "]\n');

        await expect(loadSources(root)).rejects.toThrow(/greenhouse/);
    });

    it('says the file is not YAML when it is not', async () => {
        await write('greenhouse: [gitlab\n  : :\n');

        await expect(loadSources(root)).rejects.toThrow(/is not valid YAML/);
    });
});
