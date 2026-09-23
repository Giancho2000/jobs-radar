import { z } from 'zod';
import { ScoringError } from '../core/errors.js';
import type { Profile, Score, Vacancy } from '../core/types.js';

// The description is the only unbounded field of a vacancy, and the only one that can turn a cheap
// request into an expensive one.
const MAX_DESCRIPTION_CHARS = 6000;

export const scoreSchema = z.object({
    value: z.number().min(0).max(100),
    confidence: z.enum(['high', 'medium', 'low']),
    matchedStack: z.array(z.string()),
    criticalGaps: z.array(z.string()),
    minorGaps: z.array(z.string()),
    redFlags: z.array(z.string()),
    missingAtsKeywords: z.array(z.string()),
    verdict: z.enum(['apply', 'view', 'save']),
    reason: z.string(),
});

// Written out in the prompt as well, because the OpenAI compatible path only asks for "some JSON
// object" and a local model needs to be told the shape.
const OUTPUT_CONTRACT = `{
  "value": 0-100,
  "confidence": "high" | "medium" | "low",
  "matchedStack": ["technologies present in BOTH the resume and the posting"],
  "criticalGaps": ["requirements the posting calls mandatory and the candidate does not meet"],
  "minorGaps": ["requirements the candidate does not meet but that are negotiable"],
  "redFlags": ["deal breakers that are hit, or warning signs in the posting itself"],
  "missingAtsKeywords": ["terms from the posting that the resume should contain and does not"],
  "verdict": "apply" | "view" | "save",
  "reason": "one sentence, at most 200 characters"
}`;

export function buildSystemPrompt(profile: Profile): string {
    const { criteria } = profile;
    const salary =
        criteria.minimumSalaryUsd === undefined
            ? 'not specified by the candidate'
            : `${criteria.minimumSalaryUsd} USD per month`;

    return `You score job vacancies against one candidate. You report evidence, you do not give advice.

## Candidate resume

${profile.cv}

## Hard criteria the candidate stated

- Accepted seniority: ${list(criteria.seniorityLevels)}
- Accepted work modes: ${list(criteria.workModes)}
- Accepted locations: ${list(criteria.locations)}
- Minimum salary: ${salary}
- Deal breakers: ${list(criteria.dealBreakers)}
- Excluded keywords: ${list(criteria.excludedKeywords)}
- A vacancy scoring ${criteria.scoreThreshold} or above is one the candidate wants to see.

Seniority, work mode, location and excluded keywords were already checked in code before this
request. Deal breakers and salary were not: they are prose and unpublished data, and judging them
is your job.

## Rules

1. Use only what the posting says. Never invent a requirement, a technology or a salary that is
   not written there.
2. When the posting omits something that matters, say so through a lower confidence. Do not
   compensate by guessing.
3. matchedStack only holds technologies that appear in the resume AND in the posting.
4. redFlags is for deal breakers that are actually hit and for warning signs in the posting:
   no salary at all, unpaid work, a stack that contradicts what the role claims to be.
5. The verdict follows the evidence: "apply" when the candidate clearly qualifies, "view" when it
   is worth reading in full before deciding, "save" when it is only interesting later.
6. Write every string in English, however the posting is written.

## Answer

Answer with a single JSON object and nothing else, in this shape:

${OUTPUT_CONTRACT}`;
}

export function buildUserPrompt(vacancy: Vacancy): string {
    const lines = [
        `Title: ${vacancy.title}`,
        `Company: ${vacancy.company}`,
        `Location: ${vacancy.location ?? 'not stated'}`,
        `Work mode: ${workMode(vacancy)}`,
        `Posted: ${vacancy.postedAt === undefined ? 'not stated' : vacancy.postedAt.toISOString()}`,
        `Source: ${vacancy.source}`,
        '',
        'Description:',
        truncate(vacancy.description ?? 'The source published no description.'),
    ];

    return lines.join('\n');
}

// Local models and OpenAI compatible endpoints both like to wrap the object in a fenced block.
export function parseScore(raw: string): Score {
    const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

    let document: unknown;
    try {
        document = JSON.parse(text);
    } catch {
        throw new ScoringError(`The model did not answer with JSON: ${preview(text)}`);
    }

    const parsed = scoreSchema.safeParse(document);
    if (!parsed.success) {
        const issues = parsed.error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('; ');
        throw new ScoringError(`The model answered with an unexpected shape: ${issues}`);
    }

    return parsed.data;
}

function workMode(vacancy: Vacancy): string {
    if (vacancy.remote === undefined) {
        return 'not stated';
    }
    return vacancy.remote ? 'remote' : 'on premises';
}

function truncate(description: string): string {
    if (description.length <= MAX_DESCRIPTION_CHARS) {
        return description;
    }
    return `${description.slice(0, MAX_DESCRIPTION_CHARS)}\n[truncated]`;
}

function list(values: readonly string[]): string {
    return values.length === 0 ? 'none' : values.join(', ');
}

function preview(text: string): string {
    return text.length <= 200 ? text : `${text.slice(0, 200)}...`;
}
