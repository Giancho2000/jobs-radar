import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../core/errors.js';
import { loadCriteria, loadCv, loadProfile } from './loader.js';

const VALID = `seniorityLevels: [mid, senior]
workModes: [remote, hybrid]
locations: [Colombia, Remote]
minimumSalaryUsd: 3500
dealBreakers:
  - primary stack is PHP
excludedKeywords: [internship]
scoreThreshold: 75
`;

let root: string;

const write = (name: string, content: string): Promise<void> =>
    writeFile(join(root, name), content, 'utf8');

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'jobs-radar-profile-'));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('loadCv', () => {
    it('reads the resume', async () => {
        await write('cv.md', '# Juan\n\nBackend developer.\n');

        await expect(loadCv(root)).resolves.toBe('# Juan\n\nBackend developer.');
    });

    it('says what to do when it is missing', async () => {
        await expect(loadCv(root)).rejects.toThrow(ConfigError);
        await expect(loadCv(root)).rejects.toThrow(/Create cv.md with your markdown resume/);
    });

    it('does not accept an empty one', async () => {
        await write('cv.md', '   \n\n');

        await expect(loadCv(root)).rejects.toThrow(/is empty/);
    });
});

describe('loadCriteria', () => {
    it('reads the criteria', async () => {
        await write('profile.yml', VALID);

        await expect(loadCriteria(root)).resolves.toEqual({
            seniorityLevels: ['mid', 'senior'],
            workModes: ['remote', 'hybrid'],
            locations: ['Colombia', 'Remote'],
            minimumSalaryUsd: 3500,
            dealBreakers: ['primary stack is PHP'],
            excludedKeywords: ['internship'],
            scoreThreshold: 75,
        });
    });

    it('points at the example when the file is missing', async () => {
        await expect(loadCriteria(root)).rejects.toThrow(/profile.example.yml/);
    });

    it('leaves the optional salary out rather than setting it to undefined', async () => {
        await write('profile.yml', VALID.replace('minimumSalaryUsd: 3500\n', ''));
        const criteria = await loadCriteria(root);

        expect('minimumSalaryUsd' in criteria).toBe(false);
    });

    it('defaults the lists that may be left out', async () => {
        await write(
            'profile.yml',
            'seniorityLevels: [senior]\nworkModes: [remote]\nlocations: [Remote]\nscoreThreshold: 70\n'
        );
        const criteria = await loadCriteria(root);

        expect(criteria.dealBreakers).toEqual([]);
        expect(criteria.excludedKeywords).toEqual([]);
    });

    it('rejects a key it does not know, so a typo is not a silent loss', async () => {
        await write('profile.yml', `${VALID}scoreTreshold: 80\n`);

        await expect(loadCriteria(root)).rejects.toThrow(/scoreTreshold/);
    });

    it('rejects a work mode that is not one of the three', async () => {
        await write('profile.yml', VALID.replace('[remote, hybrid]', '[remote, telepathy]'));

        await expect(loadCriteria(root)).rejects.toThrow(/workModes/);
    });

    it('rejects a threshold outside the scale', async () => {
        await write('profile.yml', VALID.replace('scoreThreshold: 75', 'scoreThreshold: 900'));

        await expect(loadCriteria(root)).rejects.toThrow(/scoreThreshold/);
    });

    it('says the file is not YAML when it is not', async () => {
        await write('profile.yml', 'seniorityLevels: [mid\n  broken: : :\n');

        await expect(loadCriteria(root)).rejects.toThrow(/is not valid YAML/);
    });
});

describe('loadProfile', () => {
    it('puts both halves together', async () => {
        await write('cv.md', '# Juan\n');
        await write('profile.yml', VALID);

        const profile = await loadProfile(root);

        expect(profile.cv).toBe('# Juan');
        expect(profile.criteria.scoreThreshold).toBe(75);
    });
});
