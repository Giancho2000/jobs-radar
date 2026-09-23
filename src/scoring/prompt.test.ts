import { describe, expect, it } from 'vitest';
import { ScoringError } from '../core/errors.js';
import type { Profile, Score, Vacancy } from '../core/types.js';
import { buildSystemPrompt, buildUserPrompt, parseScore } from './prompt.js';

const PROFILE: Profile = {
    cv: '# Juan\n\nBackend developer, Node.js and PostgreSQL.',
    criteria: {
        seniorityLevels: ['mid', 'senior'],
        workModes: ['remote'],
        locations: ['Colombia'],
        minimumSalaryUsd: 3500,
        dealBreakers: ['primary stack is PHP'],
        excludedKeywords: ['internship'],
        scoreThreshold: 75,
    },
};

const VACANCY: Vacancy = {
    id: 'greenhouse:4829',
    source: 'greenhouse',
    sourceId: '4829',
    title: 'Sr. Node.js Engineer',
    company: 'Nu Colombia',
    location: 'Remote - Colombia',
    applyUrl: 'https://example.com/4829',
    description: 'Node and Postgres.',
    dedupKey: 'key',
    seenAt: new Date('2026-09-22T10:00:00Z'),
    remote: true,
};

const ANSWER: Score = {
    value: 82,
    confidence: 'high',
    matchedStack: ['Node.js'],
    criticalGaps: [],
    minorGaps: [],
    redFlags: [],
    missingAtsKeywords: ['Kubernetes'],
    verdict: 'apply',
    reason: 'Strong stack match.',
};

describe('buildSystemPrompt', () => {
    const prompt = buildSystemPrompt(PROFILE);

    it('carries the resume', () => {
        expect(prompt).toContain('Backend developer, Node.js and PostgreSQL.');
    });

    it('carries what code cannot judge', () => {
        expect(prompt).toContain('primary stack is PHP');
        expect(prompt).toContain('3500 USD per month');
    });

    it('says when the candidate stated no salary', () => {
        const { minimumSalaryUsd, ...rest } = PROFILE.criteria;
        const quiet = buildSystemPrompt({ ...PROFILE, criteria: rest });

        expect(minimumSalaryUsd).toBe(3500);
        expect(quiet).toContain('not specified by the candidate');
    });

    it('tells the model not to invent what the posting does not say', () => {
        expect(prompt).toContain('Never invent a requirement');
        expect(prompt).toContain('lower confidence');
    });
});

describe('buildUserPrompt', () => {
    it('carries the vacancy', () => {
        const prompt = buildUserPrompt(VACANCY);

        expect(prompt).toContain('Sr. Node.js Engineer');
        expect(prompt).toContain('Nu Colombia');
        expect(prompt).toContain('Node and Postgres.');
    });

    it('says plainly what the source did not publish', () => {
        const { location, description, ...bare } = VACANCY;
        const prompt = buildUserPrompt(bare);

        expect(location).toBeDefined();
        expect(description).toBeDefined();

        expect(prompt).toContain('Location: not stated');
        expect(prompt).toContain('published no description');
    });

    it('cuts a description that would cost more than it is worth', () => {
        const prompt = buildUserPrompt({ ...VACANCY, description: 'x'.repeat(10_000) });

        expect(prompt).toContain('[truncated]');
        expect(prompt.length).toBeLessThan(7_000);
    });
});

describe('parseScore', () => {
    it('reads a plain object', () => {
        expect(parseScore(JSON.stringify(ANSWER))).toEqual(ANSWER);
    });

    it('reads an object a local model wrapped in a code fence', () => {
        expect(parseScore(`\`\`\`json\n${JSON.stringify(ANSWER)}\n\`\`\``)).toEqual(ANSWER);
    });

    it('rejects prose', () => {
        expect(() => parseScore('I think this is a good match!')).toThrow(ScoringError);
    });

    it('rejects a verdict that is not one of ours', () => {
        expect(() => parseScore(JSON.stringify({ ...ANSWER, verdict: 'maybe' }))).toThrow(/verdict/);
    });

    it('rejects a score outside the range', () => {
        expect(() => parseScore(JSON.stringify({ ...ANSWER, value: 160 }))).toThrow(ScoringError);
    });

    it('rejects a missing field', () => {
        const { matchedStack, ...incomplete } = ANSWER;

        expect(matchedStack).toEqual(['Node.js']);
        expect(() => parseScore(JSON.stringify(incomplete))).toThrow(/matchedStack/);
    });
});
