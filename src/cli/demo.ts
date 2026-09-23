import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { run } from '../core/pipelines.js';
import type { Profile, RawVacancy, Score, ScorerPort, SourcePort, Vacancy } from '../core/types.js';
import { createMarkdownSink, formatDay } from '../sinks/markdown.js';
import { createSqliteStore } from '../store/sqlite.js';
import type { Settings } from './settings.js';
import { report } from './run.js';

// Everything here is made up on purpose. demo answers one question, "what does this thing actually
// produce", and it has to answer it on a fresh clone: no api key, no network, no configuration.
const SAMPLE_PROFILE: Profile = {
    cv: '# Sample candidate\n\nBackend developer, six years. Node.js, TypeScript, PostgreSQL, AWS.',
    criteria: {
        seniorityLevels: ['mid', 'senior'],
        workModes: ['remote', 'hybrid'],
        locations: ['Colombia', 'LATAM', 'Remote'],
        minimumSalaryUsd: 3500,
        dealBreakers: ['primary stack is PHP'],
        excludedKeywords: ['internship'],
        scoreThreshold: 75,
    },
};

const SAMPLE_VACANCIES: RawVacancy[] = [
    {
        sourceId: '4829',
        source: 'greenhouse',
        title: 'Sr. Node.js Engineer',
        company: 'Nu Colombia S.A.S.',
        location: 'Remote - Colombia',
        applyUrl: 'https://example.com/jobs/4829',
        description: 'Node.js and PostgreSQL on AWS. Salary not published.',
        postedAt: new Date(),
        remote: true,
    },
    {
        sourceId: '5511',
        source: 'greenhouse',
        title: 'Platform Engineer (Remote)',
        company: 'Globant',
        location: 'LATAM',
        applyUrl: 'https://example.com/jobs/5511',
        description: 'Kubernetes, Terraform, some Go.',
        postedAt: new Date(Date.now() - 3 * 86_400_000),
    },
    {
        sourceId: '77',
        source: 'greenhouse',
        title: 'Backend Internship',
        company: 'Acme Ltda.',
        location: 'Bogota, Colombia',
        applyUrl: 'https://example.com/jobs/77',
    },
    {
        sourceId: '91',
        source: 'greenhouse',
        title: 'Staff Architect',
        company: 'Acme Ltda.',
        location: 'Remote',
        applyUrl: 'https://example.com/jobs/91',
    },
    // The same vacancy as 4829, arriving through another source under another spelling
    {
        sourceId: '10021',
        source: 'linkedin',
        title: 'Senior Node.js Engineer (m/f/d)',
        company: 'Nu Colombia',
        applyUrl: 'https://example.com/linkedin/10021',
    },
];

export async function demo(settings: Settings): Promise<void> {
    const outDir = join(settings.outDir, 'demo');

    console.log('Demo run: made up vacancies, no network, no model, nothing recorded.\n');

    const summary = await run(
        [sampleSource()],
        sampleScorer(),
        [createMarkdownSink({ retentionDays: 0 })],
        // In memory, so a demo never teaches the real database that these vacancies were seen
        createSqliteStore(':memory:'),
        SAMPLE_PROFILE,
        { runAt: new Date(), outDir, timezone: settings.timezone }
    );

    report(summary, { ...settings, outDir });

    const path = join(outDir, `${formatDay(new Date(), settings.timezone)}.md`);
    console.log(`\n--- ${relative(process.cwd(), path)} ---\n`);
    console.log(await readFile(path, 'utf8'));
}

function sampleSource(): SourcePort {
    return {
        name: 'demo',
        fetch: async (): Promise<RawVacancy[]> => SAMPLE_VACANCIES,
    };
}

// A fixed opinion rather than a random one, so that two demo runs produce the same file.
function sampleScorer(): ScorerPort {
    return {
        score: async (vacancy: Vacancy): Promise<Score> => {
            const node = vacancy.title.toLowerCase().includes('node');

            return node
                ? {
                      value: 91,
                      confidence: 'high',
                      matchedStack: ['Node.js', 'PostgreSQL', 'AWS'],
                      criticalGaps: [],
                      minorGaps: ['No Kubernetes experience listed'],
                      redFlags: ['No salary published'],
                      missingAtsKeywords: ['Kubernetes', 'Terraform'],
                      verdict: 'apply',
                      reason: 'The stack is the one on the resume and the role is remote in Colombia.',
                  }
                : {
                      value: 78,
                      confidence: 'medium',
                      matchedStack: ['AWS'],
                      criticalGaps: [],
                      minorGaps: ['Go is not on the resume', 'No Terraform experience listed'],
                      redFlags: [],
                      missingAtsKeywords: ['Kubernetes', 'Terraform', 'Go'],
                      verdict: 'view',
                      reason: 'Adjacent to the resume, worth reading the posting in full.',
                  };
        },
    };
}
