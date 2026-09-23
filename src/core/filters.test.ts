import { describe, expect, it } from 'vitest';
import { applyHardFilters, rejectionOf } from './filters.js';
import { normalizeVacancy } from './normalize.js';
import type { HardCriteria, RawVacancy, Vacancy } from './types.js';

const SEEN_AT = new Date('2026-09-22T10:00:00Z');

const CRITERIA: HardCriteria = {
    seniorityLevels: ['mid', 'senior'],
    workModes: ['remote', 'hybrid'],
    locations: ['Colombia', 'Cali', 'LATAM', 'Remote'],
    minimumSalaryUsd: 3500,
    dealBreakers: ['onsite outside Valle del Cauca'],
    excludedKeywords: ['internship', 'trainee'],
    scoreThreshold: 75,
};

let counter = 0;
function vacancy(partial: Partial<RawVacancy> = {}): Vacancy {
    counter += 1;
    return normalizeVacancy(
        {
            sourceId: String(counter),
            source: 'greenhouse',
            title: 'Backend Engineer',
            company: 'Acme',
            applyUrl: `https://example.com/${counter}`,
            ...partial,
        },
        SEEN_AT
    );
}

const ruleFor = (partial: Partial<RawVacancy>, criteria = CRITERIA): string | undefined =>
    rejectionOf(vacancy(partial), criteria)?.rule;

describe('excluded keywords', () => {
    it('rejects on the title', () => {
        expect(ruleFor({ title: 'Backend Internship' })).toBe('excludedKeyword');
    });

    it('ignores the description, so a posting can say what it is not', () => {
        expect(ruleFor({ description: 'This is not an internship.' })).toBeUndefined();
    });
});

describe('seniority', () => {
    it('rejects below the range', () => {
        expect(ruleFor({ title: 'Junior Backend Engineer' })).toBe('seniority');
        expect(ruleFor({ title: 'Jr. Backend Engineer' })).toBe('seniority');
    });

    it('rejects above the range', () => {
        expect(ruleFor({ title: 'Staff Engineer' })).toBe('seniority');
        expect(ruleFor({ title: 'Tech Lead Backend' })).toBe('seniority');
    });

    it('accepts inside the range, including the abbreviation', () => {
        expect(ruleFor({ title: 'Ssr. Backend Engineer' })).toBeUndefined();
        expect(ruleFor({ title: 'Sr. Backend Engineer', location: 'Remote' })).toBeUndefined();
    });

    it('never rejects a title that states no seniority', () => {
        expect(ruleFor({ title: 'Backend Engineer' })).toBeUndefined();
    });

    it('skips the whole check when no configured level can be read', () => {
        const nonsense = { ...CRITERIA, seniorityLevels: ['ninja', 'rockstar'] };

        expect(ruleFor({ title: 'Junior Backend Engineer' }, nonsense)).toBeUndefined();
    });
});

describe('work mode', () => {
    it('rejects a remote vacancy when the profile does not take remote work', () => {
        const onsiteOnly = { ...CRITERIA, workModes: ['onsite' as const] };

        expect(ruleFor({ location: 'Remote' }, onsiteOnly)).toBe('workMode');
    });

    it('rejects an on premises vacancy when the profile is remote only', () => {
        const remoteOnly = { ...CRITERIA, workModes: ['remote' as const] };

        expect(ruleFor({ location: 'Cali (Presencial)' }, remoteOnly)).toBe('workMode');
    });
});

describe('location', () => {
    it('accepts a city that the profile lists', () => {
        expect(ruleFor({ location: 'Cali (Presencial)' })).toBeUndefined();
    });

    it('rejects a city that the profile does not list', () => {
        expect(ruleFor({ location: 'Berlin, Germany' })).toBe('location');
    });

    it('matches whole words only, so Cali does not match California', () => {
        expect(ruleFor({ location: 'California, USA' })).toBe('location');
    });

    it('knows that LATAM and Latin America are the same place', () => {
        expect(ruleFor({ location: 'Latin America' })).toBeUndefined();
    });

    it('ignores the location of a remote vacancy', () => {
        expect(ruleFor({ location: 'Berlin, Germany (Remote)' })).toBeUndefined();
    });

    it('never rejects a vacancy with no location', () => {
        expect(ruleFor({})).toBeUndefined();
    });
});

describe('applyHardFilters', () => {
    it('splits the batch and says which rule rejected each one', () => {
        const { kept, rejected } = applyHardFilters(
            [
                vacancy({ title: 'Sr. Backend Engineer', location: 'Remote - Colombia' }),
                vacancy({ title: 'Backend Internship', location: 'Cali' }),
                vacancy({ title: 'Junior Backend Engineer', location: 'Cali' }),
            ],
            CRITERIA
        );

        expect(kept).toHaveLength(1);
        expect(rejected.map((rejection) => rejection.rule)).toEqual(['excludedKeyword', 'seniority']);
        expect(rejected[0]?.detail).toContain('internship');
    });
});
