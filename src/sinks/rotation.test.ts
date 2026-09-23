import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HISTORY_FILE, rotate } from './rotation.js';

let outDir: string;

const TODAY = '2026-09-22';

async function dayFile(day: string, body: string): Promise<void> {
    await writeFile(join(outDir, `${day}.md`), `# Jobs radar ${day}\n\n${body}\n`, 'utf8');
}

const entry = (id: string, checked = false): string =>
    `## Apply (1)\n\n- [${checked ? 'x' : ' '}] \`90\` **Engineer** at Acme - [apply](https://example.com) <!-- ${id} -->\n    - Stack matches.`;

beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'jobs-radar-rotation-'));
});

afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
});

describe('rotate', () => {
    it('moves the days older than the retention and leaves the rest', async () => {
        await dayFile('2026-09-01', entry('greenhouse:1'));
        await dayFile('2026-09-20', entry('greenhouse:2'));
        await dayFile(TODAY, entry('greenhouse:3'));

        const archived = await rotate(outDir, TODAY, 14);

        expect(archived).toEqual(['2026-09-01']);
        expect((await readdir(outDir)).sort()).toEqual([
            '2026-09-20.md',
            `${TODAY}.md`,
            HISTORY_FILE,
        ]);
    });

    it('moves the day whole, with the ticked boxes and the notes', async () => {
        await dayFile('2026-09-01', `${entry('greenhouse:1', true)}\n\n    Sent the referral.`);

        await rotate(outDir, TODAY, 14);
        const history = await readFile(join(outDir, HISTORY_FILE), 'utf8');

        expect(history).toContain('- [x] `90`');
        expect(history).toContain('Sent the referral.');
        expect(history).toContain('<!-- greenhouse:1 -->');
    });

    it('drops the sections of the day one heading level', async () => {
        await dayFile('2026-09-01', `${entry('greenhouse:1')}\n\n## My own notes\n\nCall the referral.`);

        await rotate(outDir, TODAY, 14);
        const history = await readFile(join(outDir, HISTORY_FILE), 'utf8');

        expect(history).toContain('### Apply (1)');
        expect(history).toContain('### My own notes');
        expect(history).not.toMatch(/\n## Apply/);
    });

    it('puts the newest day first', async () => {
        await dayFile('2026-09-01', entry('greenhouse:1'));
        await dayFile('2026-09-02', entry('greenhouse:2'));

        await rotate(outDir, TODAY, 14);
        const history = await readFile(join(outDir, HISTORY_FILE), 'utf8');

        expect(history.indexOf('## 2026-09-02')).toBeLessThan(history.indexOf('## 2026-09-01'));
    });

    it('does not duplicate a day when it runs again', async () => {
        await dayFile('2026-09-01', entry('greenhouse:1'));

        await rotate(outDir, TODAY, 14);
        const once = await readFile(join(outDir, HISTORY_FILE), 'utf8');
        await rotate(outDir, TODAY, 14);

        expect(await readFile(join(outDir, HISTORY_FILE), 'utf8')).toBe(once);
    });

    it('adds later days to a history that already exists', async () => {
        await dayFile('2026-09-01', entry('greenhouse:1'));
        await rotate(outDir, TODAY, 14);

        await dayFile('2026-09-05', entry('greenhouse:2'));
        await rotate(outDir, TODAY, 14);
        const history = await readFile(join(outDir, HISTORY_FILE), 'utf8');

        expect(history).toContain('## 2026-09-01');
        expect(history).toContain('## 2026-09-05');
    });

    it('never archives a file it did not write', async () => {
        const mine = '# Someone else\n\nnot a jobs-radar file\n';
        await writeFile(join(outDir, '2026-08-15.md'), mine, 'utf8');

        const archived = await rotate(outDir, TODAY, 14);

        expect(archived).toEqual([]);
        expect(await readFile(join(outDir, '2026-08-15.md'), 'utf8')).toBe(mine);
    });

    it('ignores files that are not a day', async () => {
        await writeFile(join(outDir, 'notes.md'), '# Notes\n', 'utf8');

        expect(await rotate(outDir, TODAY, 14)).toEqual([]);
    });

    it('does nothing when the retention is off', async () => {
        await dayFile('2020-01-01', entry('greenhouse:1'));

        expect(await rotate(outDir, TODAY, 0)).toEqual([]);
        expect(await readdir(outDir)).toEqual(['2020-01-01.md']);
    });

    it('does nothing when the directory is not there yet', async () => {
        expect(await rotate(join(outDir, 'nope'), TODAY, 14)).toEqual([]);
    });
});
