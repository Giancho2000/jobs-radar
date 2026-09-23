import { describe, expect, it } from 'vitest';
import { dedupeBatch } from './dedup.js';
import { normalizeVacancy } from './normalize.js';
import type { Vacancy } from './types.js';

const SEEN_AT = new Date('2026-09-22T10:00:00Z');

const vacancy = (source: string, sourceId: string, title: string, company: string): Vacancy =>
    normalizeVacancy(
        { source, sourceId, title, company, applyUrl: `https://example.com/${sourceId}` },
        SEEN_AT
    );

describe('dedupeBatch', () => {
    it('keeps the first occurrence and drops the later one', () => {
        const fromBoard = vacancy('greenhouse', '1', 'Sr. Node Engineer', 'Nu Colombia S.A.S.');
        const fromMail = vacancy('linkedin', '99', 'Senior Node Engineer (Remote)', 'Nu Colombia');

        const unique = dedupeBatch([fromBoard, fromMail]);

        expect(unique).toEqual([fromBoard]);
    });

    it('leaves different vacancies alone', () => {
        const one = vacancy('greenhouse', '1', 'Node Engineer', 'Acme');
        const two = vacancy('greenhouse', '2', 'Go Engineer', 'Acme');

        expect(dedupeBatch([one, two])).toHaveLength(2);
    });

    it('preserves the order it was given', () => {
        const one = vacancy('greenhouse', '1', 'A Engineer', 'Acme');
        const two = vacancy('greenhouse', '2', 'B Engineer', 'Acme');
        const three = vacancy('greenhouse', '3', 'C Engineer', 'Acme');

        expect(dedupeBatch([three, one, two, one])).toEqual([three, one, two]);
    });

    it('does nothing to an empty batch', () => {
        expect(dedupeBatch([])).toEqual([]);
    });
});
