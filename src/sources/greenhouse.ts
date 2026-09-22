import { z } from 'zod';
import type { RawVacancy, SourcePort } from '../core/types.js';

const BOARDS_API = 'https://boards-api.greenhouse.io/v1/boards';
const TIMEOUTS_MS = 15_000;

const jobSchema = z.object({
    id: z.number().int().positive(),
    title: z.string().trim().min(1),
    absolute_url: z.url(),
    updated_at: z.iso.datetime({ offset: true }),
    first_published: z.iso.datetime({ offset: true }).nullish(),
    company_name: z.string().trim().min(1).nullish(),
    location: z.object({ name: z.string() }).nullish(),
    content: z.string().nullish(),
});

const boardSchema = z.object({ jobs: z.array( z.unknown()) });

type GreenhouseJob = z.infer< typeof jobSchema>;

export function createGreenhouseSource(boards: string[]): SourcePort {
    return {
        name: 'greenhouse',
        async fetch(since: Date): Promise<RawVacancy[]> {
            const results = await Promise.allSettled(boards.map( (board) => fetchBoard(board, since)));

            const vacancies: RawVacancy[] = [];
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    vacancies.push(...result.value);
                } else {
                    console.warn(`[greenhouse] board "${boards[index]}" failed: ${asMessage(result.reason)}`);
                }
            });
            return vacancies;
        },
    };
}

async function fetchBoard(board: string, since: Date): Promise<RawVacancy[]> {
    const url = `${BOARDS_API}/${encodeURIComponent(board)}/jobs?content=true`;

    const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUTS_MS),
    });

    if(!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const payload = boardSchema.safeParse( await response.json() );
    
    if(!payload.success) {
        throw new Error(`Unexpected response: no "jobs" array`);
    }

    const vacancies: RawVacancy[] = [];

    for (const item of payload.data.jobs) {
        const job =jobSchema.safeParse(item);
        if(!job.success) {
            const detail = job.error.issues[0];
            console.warn(
                `[greenhouse] board "${ board }": job skipped, ${detail?.path.join('.') ?? '(root)'} ${detail?.message ?? 'is invalid'}`
            );
            continue;
        }

         // the boards API has no "updated since" parameter, so the window is applied here
        if (new Date(job.data.updated_at) < since) {
            continue;
        }
        vacancies.push(toRawVacancy(job.data, board));
    }
    
    return vacancies;
}

function toRawVacancy(job: GreenhouseJob, board: string): RawVacancy {
    const vacancy: RawVacancy = {
        sourceId: String(job.id),
        source: 'greenhouse',
        title: job.title,
        company: job.company_name ?? board,
        applyUrl: job.absolute_url,
        postedAt: new Date(job.first_published ?? job.updated_at),
    };
    // exactOptionalPropertyTypes: the key can be absent, but never present with undefined
    const location = job.location?.name.trim();
    if (location) {
        vacancy.location = location;
    }
    if (job.content) {
        vacancy.description = job.content;
    }

    return vacancy;
};

function asMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}