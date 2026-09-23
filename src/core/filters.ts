import { collapse, deaccent } from './text.js';
import { titleKey } from './normalize.js';
import type { HardCriteria, Vacancy } from './types.js';

// Only the criteria that a machine can decide on its own live here. dealBreakers and
// minimumSalaryUsd are prose and unpublished data respectively: they belong to the scoring prompt,
// not to this file. Rejecting on a guess is worse than paying for one LLM call.
export type FilterRule = 'excludedKeyword' | 'seniority' | 'workMode' | 'location';

export interface Rejection {
    vacancy: Vacancy;
    rule: FilterRule;
    detail: string;
}

export interface HardFilterResult {
    kept: Vacancy[];
    rejected: Rejection[];
}

type SeniorityLevel = 'intern' | 'junior' | 'mid' | 'senior' | 'staff' | 'director';

// Ordered from the lowest rank up, and read in this order: "semi senior" has to be caught by the
// mid entry before the senior one sees it.
const SENIORITY_WORDS: Array<readonly [SeniorityLevel, RegExp]> = [
    ['intern', /\b(intern|internship|trainee|apprentice|becario|practicante|pasante)\b/],
    ['junior', /\b(junior|entry level|entry|graduate)\b/],
    ['mid', /\b(mid|middle|mid level|midlevel|semi senior|semisenior|intermediate)\b/],
    ['senior', /\b(senior)\b/],
    ['staff', /\b(staff|principal|lead|architect)\b/],
    ['director', /\b(director|head of|vp|vice president|chief|cto)\b/],
];

const SENIORITY_RANK: Record<SeniorityLevel, number> = {
    intern: 0,
    junior: 1,
    mid: 2,
    senior: 3,
    staff: 4,
    director: 5,
};

const REMOTE_LOCATION = /\b(remote|remoto|anywhere|worldwide|distributed)\b/;

// Regions get spelled in several ways and that is not the user's fault. City names are a different
// story: they go in the locations list of profile.yml, they are not hardcoded here.
const LOCATION_ALIASES: string[][] = [
    ['latam', 'latin america', 'latinoamerica', 'america latina', 'south america', 'sudamerica'],
    ['emea', 'europe', 'europa'],
    ['apac', 'asia pacific', 'asia-pacific'],
    ['usa', 'united states', 'us only'],
    ['uk', 'united kingdom', 'england'],
];

const CHECKS: Array<(vacancy: Vacancy, criteria: HardCriteria) => Rejection | undefined> = [
    excludedKeywordCheck,
    seniorityCheck,
    workModeCheck,
    locationCheck,
];

export function applyHardFilters(vacancies: Vacancy[], criteria: HardCriteria): HardFilterResult {
    const kept: Vacancy[] = [];
    const rejected: Rejection[] = [];

    for (const vacancy of vacancies) {
        const rejection = rejectionOf(vacancy, criteria);
        if (rejection === undefined) {
            kept.push(vacancy);
        } else {
            rejected.push(rejection);
        }
    }

    return { kept, rejected };
}

export function rejectionOf(vacancy: Vacancy, criteria: HardCriteria): Rejection | undefined {
    for (const check of CHECKS) {
        const rejection = check(vacancy, criteria);
        if (rejection !== undefined) {
            return rejection;
        }
    }
    return undefined;
}

// The description is deliberately out of this check: a posting that says "this is not an
// internship" would be dropped by the word "internship". Blunt rules only get the title.
function excludedKeywordCheck(vacancy: Vacancy, criteria: HardCriteria): Rejection | undefined {
    const title = plain(vacancy.title);

    for (const keyword of criteria.excludedKeywords) {
        const needle = plain(keyword);
        if (needle.length > 0 && title.includes(needle)) {
            return { vacancy, rule: 'excludedKeyword', detail: `title contains "${keyword}"` };
        }
    }

    return undefined;
}

// A title that states no seniority is kept: unknown is not a reason to reject.
function seniorityCheck(vacancy: Vacancy, criteria: HardCriteria): Rejection | undefined {
    const accepted = acceptedRanks(criteria.seniorityLevels);
    if (accepted === undefined) {
        return undefined;
    }

    const level = detectSeniority(titleKey(vacancy.title));
    if (level === undefined) {
        return undefined;
    }

    const rank = SENIORITY_RANK[level];
    if (rank < accepted.min) {
        return { vacancy, rule: 'seniority', detail: `"${level}" is below the profile range` };
    }
    if (rank > accepted.max) {
        return { vacancy, rule: 'seniority', detail: `"${level}" is above the profile range` };
    }

    return undefined;
}

function workModeCheck(vacancy: Vacancy, criteria: HardCriteria): Rejection | undefined {
    if (vacancy.remote === true && !criteria.workModes.includes('remote')) {
        return { vacancy, rule: 'workMode', detail: 'remote is not in the profile work modes' };
    }

    // remote === false cannot tell onsite from hybrid, so it only loses against a remote-only profile
    const acceptsOnPremises = criteria.workModes.includes('onsite') || criteria.workModes.includes('hybrid');
    if (vacancy.remote === false && !acceptsOnPremises) {
        return { vacancy, rule: 'workMode', detail: 'the profile only accepts remote work' };
    }

    return undefined;
}

function locationCheck(vacancy: Vacancy, criteria: HardCriteria): Rejection | undefined {
    if (vacancy.location === undefined) {
        return undefined;
    }

    const location = plain(vacancy.location);

    // a remote vacancy is not tied to the location it was posted under
    if (criteria.workModes.includes('remote') && (vacancy.remote === true || REMOTE_LOCATION.test(location))) {
        return undefined;
    }

    const accepted = criteria.locations.some((candidate) =>
        aliasesOf(candidate).some((needle) => matchesWord(location, needle))
    );

    return accepted
        ? undefined
        : { vacancy, rule: 'location', detail: `"${vacancy.location}" is not in the profile locations` };
}

function detectSeniority(title: string): SeniorityLevel | undefined {
    for (const [level, pattern] of SENIORITY_WORDS) {
        if (pattern.test(title)) {
            return level;
        }
    }
    return undefined;
}

// The profile carries free text, so anything that maps to no known level is ignored. When nothing
// maps at all the whole check is skipped instead of rejecting everything.
function acceptedRanks(levels: string[]): { min: number; max: number } | undefined {
    const ranks: number[] = [];

    for (const level of levels) {
        const detected = detectSeniority(plain(level));
        if (detected !== undefined) {
            ranks.push(SENIORITY_RANK[detected]);
        }
    }

    return ranks.length === 0 ? undefined : { min: Math.min(...ranks), max: Math.max(...ranks) };
}

function aliasesOf(location: string): string[] {
    const needle = plain(location);
    return LOCATION_ALIASES.find((aliases) => aliases.includes(needle)) ?? [needle];
}

// Whole words only: "uk" must not match "ukraine" and "cali" must not match "california".
// Written by hand instead of with a RegExp so the needle, which comes from user config, needs no
// escaping.
function matchesWord(haystack: string, needle: string): boolean {
    if (needle.length === 0) {
        return false;
    }

    for (let from = 0; ; from += 1) {
        const index = haystack.indexOf(needle, from);
        if (index === -1) {
            return false;
        }
        if (!isWordChar(haystack[index - 1]) && !isWordChar(haystack[index + needle.length])) {
            return true;
        }
        from = index;
    }
}

function isWordChar(char: string | undefined): boolean {
    return char !== undefined && /[a-z0-9]/.test(char);
}

function plain(value: string): string {
    return collapse(deaccent(value.toLowerCase()));
}
