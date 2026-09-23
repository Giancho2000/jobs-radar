import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMarkdownSink, formatDay } from './markdown.js';
import type { RunContext, ScoredVacancy, Verdict } from '../core/types.js';

const RUN_AT = new Date('2026-09-22T14:00:00Z');

let outDir: string;
let ctx: RunContext;
let path: string;

const sink = createMarkdownSink({ retentionDays: 0 });

function item(id: string, title: string, value: number, verdict: Verdict = 'apply'): ScoredVacancy {
    return {
        vacancy: {
            id,
            source: 'greenhouse',
            sourceId: id.split(':')[1] ?? '0',
            title,
            company: 'Acme',
            applyUrl: `https://example.com/${id}`,
            dedupKey: id,
            seenAt: RUN_AT,
            remote: true,
            postedAt: RUN_AT,
        },
        score: {
            value,
            confidence: 'high',
            matchedStack: ['Node.js'],
            criticalGaps: [],
            minorGaps: [],
            redFlags: [],
            missingAtsKeywords: ['Kubernetes'],
            verdict,
            reason: 'Stack matches.',
        },
    };
}

beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'jobs-radar-markdown-'));
    ctx = { runAt: RUN_AT, outDir, timezone: 'America/Bogota' };
    path = join(outDir, '2026-09-22.md');
});

afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
});

describe('formatDay', () => {
    it('uses the day where the user lives, not where the process runs', () => {
        // 00:30 UTC is still the previous day in Bogota
        expect(formatDay(new Date('2026-09-23T00:30:00Z'), 'America/Bogota')).toBe('2026-09-22');
        expect(formatDay(new Date('2026-09-23T00:30:00Z'), 'UTC')).toBe('2026-09-23');
    });

    it('does not lose a run over an invalid timezone', () => {
        expect(formatDay(RUN_AT, 'Not/AZone')).toBe('2026-09-22');
    });
});

describe('the file of the day', () => {
    it('names the file after the local day', async () => {
        await sink.emit([item('greenhouse:1', 'Engineer', 91)], ctx);

        await expect(readFile(path, 'utf8')).resolves.toContain('# Jobs radar 2026-09-22');
    });

    it('anchors each entry with an id the next run can find', async () => {
        await sink.emit([item('greenhouse:1', 'Engineer', 91)], ctx);

        await expect(readFile(path, 'utf8')).resolves.toContain('<!-- greenhouse:1 -->');
    });

    it('groups by verdict and sorts by score inside the group', async () => {
        await sink.emit(
            [
                item('greenhouse:1', 'Lower', 78),
                item('greenhouse:2', 'Higher', 91),
                item('greenhouse:3', 'Other', 84, 'view'),
            ],
            ctx
        );
        const file = await readFile(path, 'utf8');

        expect(file).toContain('## Apply (2)');
        expect(file).toContain('## Worth a look (1)');
        expect(file.indexOf('greenhouse:2')).toBeLessThan(file.indexOf('greenhouse:1'));
    });

    it('escapes markdown in a title so a C++ role does not break the file', async () => {
        await sink.emit([item('greenhouse:1', 'Backend Engineer (C++ / C#) *urgent*', 91)], ctx);

        await expect(readFile(path, 'utf8')).resolves.toContain(String.raw`\*urgent\*`);
    });

    it('says so when nothing came through', async () => {
        await sink.emit([], ctx);

        await expect(readFile(path, 'utf8')).resolves.toContain('Nothing new made it through today.');
    });

    it('leaves no temporary file behind', async () => {
        await sink.emit([item('greenhouse:1', 'Engineer', 91)], ctx);

        await expect(readFile(`${path}.tmp`, 'utf8')).rejects.toThrow();
    });
});

describe('what the user writes into the file', () => {
    beforeEach(async () => {
        await sink.emit([item('greenhouse:1', 'First', 91), item('greenhouse:2', 'Second', 78)], ctx);

        const edited = (await readFile(path, 'utf8'))
            .replace('- [ ] `91`', '- [x] `91`')
            .replace('    - Stack matches.', '    - Stack matches.\n\n    Applied, recruiter is Ana.\n');
        await writeFile(path, `${edited}\n## My own notes\n\nCall the referral.\n`, 'utf8');
    });

    it('survives a run that finds nothing new', async () => {
        await sink.emit([], ctx);
        const file = await readFile(path, 'utf8');

        expect(file).toContain('<!-- greenhouse:1 -->');
        expect(file).toContain('<!-- greenhouse:2 -->');
        expect(file).toContain('- [x] `91`');
        expect(file).toContain('recruiter is Ana');
        expect(file).toContain('## My own notes');
    });

    it('survives a run that adds a vacancy', async () => {
        await sink.emit([item('greenhouse:3', 'Third', 84, 'view')], ctx);
        const file = await readFile(path, 'utf8');

        expect(file).toContain('<!-- greenhouse:3 -->');
        expect(file).toContain('- [x] `91`');
        expect(file).toContain('recruiter is Ana');
        expect(file).toContain('## Apply (2)');
        expect(file.lastIndexOf('## My own notes')).toBeGreaterThan(file.lastIndexOf('greenhouse:3'));
    });

    it('never writes the same vacancy twice', async () => {
        await sink.emit([item('greenhouse:1', 'First', 91)], ctx);
        const file = await readFile(path, 'utf8');

        expect(file.split('<!-- greenhouse:1 -->')).toHaveLength(2);
    });

    it('counts what is already ticked off', async () => {
        await sink.emit([], ctx);

        await expect(readFile(path, 'utf8')).resolves.toContain('1 ticked off');
    });
});

describe('a file this sink did not write', () => {
    it('is left alone and fails the run instead', async () => {
        const mine = '# My shopping list\n\n- milk\n';
        await writeFile(path, mine, 'utf8');

        await expect(sink.emit([item('greenhouse:1', 'Engineer', 91)], ctx)).rejects.toThrow(
            /was not written by jobs-radar/
        );
        await expect(readFile(path, 'utf8')).resolves.toBe(mine);
    });
});
