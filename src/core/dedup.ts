import type { Vacancy } from './types.js';

// Two sources can return the same vacancy inside a single run, and at that point none of them is
// in the store yet, so isNew() answers true for both. The first occurrence wins.
export function dedupeBatch(vacancies: Vacancy[]): Vacancy[] {
    const seen = new Set<string>();
    const unique: Vacancy[] = [];

    for (const vacancy of vacancies) {
        if (seen.has(vacancy.dedupKey)) {
            continue;
        }
        seen.add(vacancy.dedupKey);
        unique.push(vacancy);
    }

    return unique;
}
