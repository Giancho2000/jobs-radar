import { afterEach, describe, expect, it, vi } from 'vitest';
import board from '../__fixtures__/greenhouse-board.json' with { type: 'json' };
import { createGreenhouseSource } from './greenhouse.js';

const SINCE = new Date('2026-09-01T00:00:00Z');

function answerWith(payload: unknown, status = 200): typeof fetch {
    return vi.fn(async () =>
        new Response(JSON.stringify(payload), {
            status,
            headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('createGreenhouseSource', () => {
    it('asks for the content of each board', async () => {
        const fetcher = answerWith(board);
        vi.stubGlobal('fetch', fetcher);

        await createGreenhouseSource(['wise']).fetch(SINCE);

        const [url] = vi.mocked(fetcher).mock.calls[0] ?? [];
        expect(url).toBe('https://boards-api.greenhouse.io/v1/boards/wise/jobs?content=true');
    });

    it('keeps the jobs inside the window and drops the older ones', async () => {
        vi.stubGlobal('fetch', answerWith(board));

        const vacancies = await createGreenhouseSource(['wise']).fetch(SINCE);

        expect(vacancies.map((vacancy) => vacancy.sourceId)).toEqual(['6145567004', '6146524004']);
    });

    it('skips a malformed job instead of losing the board', async () => {
        vi.stubGlobal('fetch', answerWith(board));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const vacancies = await createGreenhouseSource(['wise']).fetch(SINCE);

        expect(vacancies).toHaveLength(2);
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0]?.[0]).toContain('job skipped');
    });

    it('maps a job to the fields the core expects', async () => {
        vi.stubGlobal('fetch', answerWith(board));

        const [first] = await createGreenhouseSource(['wise']).fetch(SINCE);

        expect(first).toMatchObject({
            source: 'greenhouse',
            sourceId: '6145567004',
            title: 'Supplemental Sales Agent - Chicago, IL',
            // zod trims it: the API really does send a trailing space
            company: 'Wise Worksite Field Sales',
            location: 'Chicago, IL',
            applyUrl: 'https://job-boards.greenhouse.io/wise/jobs/6145567004',
        });
        // first_published, not updated_at, when the API sends both
        expect(first?.postedAt?.toISOString()).toBe('2026-08-17T18:19:00.000Z');
    });

    it('falls back to the board token when the API sends no company name', async () => {
        vi.stubGlobal('fetch', answerWith(board));

        const vacancies = await createGreenhouseSource(['wise']).fetch(SINCE);

        expect(vacancies[1]?.company).toBe('wise');
        expect(vacancies[1]?.postedAt?.toISOString()).toBe('2026-09-18T18:49:29.000Z');
    });

    it('leaves the description escaped for the normalisation step', async () => {
        vi.stubGlobal('fetch', answerWith(board));

        const [first] = await createGreenhouseSource(['wise']).fetch(SINCE);

        expect(first?.description).toContain('&lt;p&gt;');
    });

    it('warns about a board that answers with an error and keeps the others', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string | URL) =>
                String(url).includes('broken')
                    ? new Response('nope', { status: 404, statusText: 'Not Found' })
                    : new Response(JSON.stringify(board), { status: 200 })
            )
        );

        const vacancies = await createGreenhouseSource(['broken', 'wise']).fetch(SINCE);

        expect(vacancies).toHaveLength(2);
        expect(warn.mock.calls.map(String).join()).toContain('board "broken" failed: HTTP 404');
    });

    it('warns when the answer is not a board at all', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.stubGlobal('fetch', answerWith({ something: 'else' }));

        const vacancies = await createGreenhouseSource(['wise']).fetch(SINCE);

        expect(vacancies).toEqual([]);
        expect(warn.mock.calls.map(String).join()).toContain('no "jobs" array');
    });

    it('asks every board it was given', async () => {
        const fetcher = answerWith({ jobs: [] });
        vi.stubGlobal('fetch', fetcher);

        await createGreenhouseSource(['one', 'two', 'three']).fetch(SINCE);

        expect(vi.mocked(fetcher).mock.calls.map(([url]) => String(url))).toEqual([
            'https://boards-api.greenhouse.io/v1/boards/one/jobs?content=true',
            'https://boards-api.greenhouse.io/v1/boards/two/jobs?content=true',
            'https://boards-api.greenhouse.io/v1/boards/three/jobs?content=true',
        ]);
    });
});
