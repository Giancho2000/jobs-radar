import { describe, expect, it } from 'vitest';
import { companyKey, dedupKeyOf, normalizeAll, normalizeVacancy, titleKey } from './normalize.js';
import type { RawVacancy } from './types.js';

const SEEN_AT = new Date('2026-09-22T10:00:00Z');

function raw(partial: Partial<RawVacancy> = {}): RawVacancy {
    return {
        sourceId: '4829',
        source: 'greenhouse',
        title: 'Backend Engineer',
        company: 'Acme',
        applyUrl: 'https://example.com/4829',
        ...partial,
    };
}

describe('companyKey', () => {
    it('drops the legal suffix', () => {
        expect(companyKey('Nu Colombia S.A.S.')).toBe('nu colombia');
        expect(companyKey('Nu Colombia')).toBe('nu colombia');
    });

    it('drops more than one suffix', () => {
        expect(companyKey('Acme Ltda. S.A.S.')).toBe('acme');
        expect(companyKey('Globant S.A. de C.V.')).toBe('globant');
    });

    it('keeps the name of a company that is only a suffix', () => {
        expect(companyKey('SAS')).toBe('sas');
        expect(companyKey('Inc.')).toBe('inc');
    });

    it('ignores accents and case', () => {
        expect(companyKey('Compañía Nacional')).toBe(companyKey('COMPANIA NACIONAL'));
    });
});

describe('titleKey', () => {
    it('expands the seniority abbreviations instead of deleting them', () => {
        expect(titleKey('Sr. Java Developer')).toBe('senior java developer');
        expect(titleKey('Ssr. Backend Dev')).toBe('semi senior backend dev');
        expect(titleKey('Jr Backend Dev')).toBe('junior backend dev');
    });

    it('removes bracketed noise', () => {
        expect(titleKey('Java Developer (m/f/d) [Hybrid]')).toBe('java developer');
    });

    it('removes a tail that describes the posting', () => {
        expect(titleKey('Backend Engineer - Remote')).toBe('backend engineer');
        expect(titleKey('Dev, Remote, LATAM')).toBe('dev');
    });

    it('keeps a tail that describes the role', () => {
        expect(titleKey('Backend Engineer - Payments Team')).toBe('backend engineer payments team');
        expect(titleKey('Engineer / Developer')).toBe('engineer developer');
    });
});

describe('dedupKeyOf', () => {
    it('collides for the same job written two ways', () => {
        expect(dedupKeyOf('Nu Colombia S.A.S.', 'Sr. Java Developer')).toBe(
            dedupKeyOf('Nu Colombia', 'Senior Java Developer')
        );
    });

    it('does not collide across seniority', () => {
        expect(dedupKeyOf('Nu', 'Sr. Java Developer')).not.toBe(dedupKeyOf('Nu', 'Java Developer'));
    });

    it('does not depend on the source, so the same job from two sources collides', () => {
        const fromBoard = normalizeVacancy(
            raw({ source: 'greenhouse', title: 'Sr. Node Engineer', company: 'Nu Colombia S.A.S.' }),
            SEEN_AT
        );
        const fromMail = normalizeVacancy(
            raw({ source: 'linkedin', title: 'Senior Node Engineer (Remote)', company: 'Nu Colombia' }),
            SEEN_AT
        );

        expect(fromBoard.dedupKey).toBe(fromMail.dedupKey);
        expect(fromBoard.id).not.toBe(fromMail.id);
    });
});

describe('normalizeVacancy', () => {
    it('builds the id the daily file uses as an anchor', () => {
        expect(normalizeVacancy(raw(), SEEN_AT).id).toBe('greenhouse:4829');
    });

    it('takes seenAt from the caller so a run is reproducible', () => {
        expect(normalizeVacancy(raw(), SEEN_AT).seenAt).toBe(SEEN_AT);
    });

    it('keeps the title readable and only collapses whitespace', () => {
        expect(normalizeVacancy(raw({ title: '  Sr. Java   Developer  (Remote) ' }), SEEN_AT).title).toBe(
            'Sr. Java Developer (Remote)'
        );
    });

    it('turns the escaped description into text', () => {
        const vacancy = normalizeVacancy(raw({ description: '&lt;p&gt;Node &amp;amp; TS&lt;/p&gt;' }), SEEN_AT);

        expect(vacancy.description).toBe('Node & TS');
    });

    it('infers remote work from the location', () => {
        expect(normalizeVacancy(raw({ location: 'Remote - Colombia' }), SEEN_AT).remote).toBe(true);
        expect(normalizeVacancy(raw({ location: 'Cali (Presencial)' }), SEEN_AT).remote).toBe(false);
    });

    it('lets the source override the guess', () => {
        expect(normalizeVacancy(raw({ location: 'Remote', remote: false }), SEEN_AT).remote).toBe(false);
    });

    it('leaves the key out entirely when it cannot tell', () => {
        expect('remote' in normalizeVacancy(raw(), SEEN_AT)).toBe(false);
        expect('location' in normalizeVacancy(raw(), SEEN_AT)).toBe(false);
    });
});

describe('normalizeAll', () => {
    it('normalises every vacancy with the same timestamp', () => {
        const vacancies = normalizeAll([raw({ sourceId: '1' }), raw({ sourceId: '2' })], SEEN_AT);

        expect(vacancies.map((vacancy) => vacancy.id)).toEqual(['greenhouse:1', 'greenhouse:2']);
        expect(new Set(vacancies.map((vacancy) => vacancy.seenAt))).toHaveProperty('size', 1);
    });
});
