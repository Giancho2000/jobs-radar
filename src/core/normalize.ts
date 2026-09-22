import { createHash } from 'node:crypto';
import { collapse, deaccent, htmlToText } from './text.js';
import type { RawVacancy, Vacancy } from './types.js';

const LEGAL_SUFFIXES = [
    'sas', 'sa', 'sa de cv', 's de rl', 'srl', 'ltda', 'ltd', 'limited', 'inc', 'incorporated',
    'llc', 'corp', 'corporation', 'co', 'gmbh', 'ag', 'bv', 'nv', 'plc', 'pty', 'ab', 'oy',
];

// longest first, so "acme sa de cv" does not get cut down to "acme sa de"
const SUFFIX_PATTERN = new RegExp(
    `\\s+(?:${[...LEGAL_SUFFIXES].sort((a, b) => b.length - a.length).join('|')})$`
);

// tail segments that describe the posting, not the role
const TITLE_TAIL_NOISE = new Set([
    'remote', 'hybrid', 'onsite', 'on site', 'full time', 'part time', 'contract',
    'latam', 'emea', 'apac', 'usa', 'us',
]);

// abbreviations are expanded, never dropped: "sr java dev" must not collide with "java dev"
const SENIORITY_ABBREVIATIONS: Array<[RegExp, string]> = [
    [/\bssr\b/g, 'semi senior'],
    [/\bsr\b/g, 'senior'],
    [/\bjr\b/g, 'junior'],
];

const REMOTE_HINTS = /\b(remote|remoto|anywhere|teletrabajo|work from home|wfh)\b/;
const ONSITE_HINTS = /\b(on-?site|presencial)\b/;

export function normalizeVacancy(raw: RawVacancy, seenAt: Date): Vacancy {
    const title = collapse(raw.title);
    const company = collapse(raw.company);
    const location = raw.location === undefined ? '' : collapse(raw.location);
    const description = raw.description === undefined ? '' : htmlToText(raw.description);

    const vacancy: Vacancy = {
        id: `${raw.source}:${raw.sourceId}`,
        source: raw.source,
        sourceId: raw.sourceId,
        title,
        company,
        applyUrl: raw.applyUrl,
        dedupKey: dedupKeyOf(company, title),
        seenAt,
    };

    // exactOptionalPropertyTypes: the key is absent or it carries a value, never present with undefined
    if (location.length > 0) {
        vacancy.location = location;
    }
    if (description.length > 0) {
        vacancy.description = description;
    }
    if (raw.postedAt !== undefined) {
        vacancy.postedAt = raw.postedAt;
    }

    // a flag set by the source wins; guessing is only for when it is missing
    const remote = raw.remote ?? inferRemote(title, location);
    if (remote !== undefined) {
        vacancy.remote = remote;
    }

    return vacancy;
};

export function normalizeAll(raws: RawVacancy[], seenAt: Date): Vacancy[] {
    return raws.map((raw) => normalizeVacancy(raw, seenAt));
};

export function companyKey(company: string): string {
    let key = collapse(deaccent(company.toLowerCase()).replace(/[.,]/g, ''));

    for (;;) {
        const stripped = collapse(key.replace(SUFFIX_PATTERN, ''));
        // a company whose entire name is a suffix ("SAS", "Inc") keeps it
        if (stripped === key || stripped.length === 0) {
            break;
        }
        key = stripped;
    }

    return collapse(key.replace(/[^a-z0-9 ]+/g, ' '));
};

export function titleKey(title: string): string {
    // "(Remote)", "(m/f/d)" and friends carry no role information
    let key = deaccent(title.toLowerCase()).replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');

    key = dropTailNoise(key);

    for (const [pattern, expansion] of SENIORITY_ABBREVIATIONS) {
        key = key.replace(pattern, expansion);
    }

    return collapse(key.replace(/[^a-z0-9 ]+/g, ' '));
}
;
export function dedupKeyOf(company:string, title: string): string{
    // the source is deliberately out of the key: the same vacancy from greenhouse and from a
    // linkedin alert has to collide
    return createHash('sha1').update(`${companyKey(company)}|${titleKey(title)}`).digest('hex');
};

function dropTailNoise(title: string): string {
    let result = title;

    for (;;) {
        const match = /\s*[-–—|,]\s*([^-–—|,]+)$/.exec(result);
        if (match === null) {
            return result;
        }

        const tail = collapse((match[1] ?? '').replace(/[^a-z0-9 ]+/g, ' '));
        if (!TITLE_TAIL_NOISE.has(tail)) {
            return result;
        }

        result = result.slice(0, match.index);
    }
}

function inferRemote(title: string, location: string): boolean | undefined {
    const haystack = deaccent(`${title} ${location}`.toLowerCase());

    if (REMOTE_HINTS.test(haystack)) {
        return true;
    }
    if (ONSITE_HINTS.test(haystack)) {
        return false;
    }
    return undefined;
}