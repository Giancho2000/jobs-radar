import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ConfigError } from '../core/errors.js';
import type { HardCriteria, Profile } from '../core/types.js';

const CV_FILE = 'cv.md';
const PROFILE_FILE = 'profile.yml';

const nonEmptyStrings = z.array(z.string().trim().min(1));

const criteriaSchema = z.strictObject({
    seniorityLevels: nonEmptyStrings.min(1),
    workModes: z.array(z.enum(['remote', 'onsite', 'hybrid'])).min(1),
    locations: nonEmptyStrings.min(1),
    minimumSalaryUsd: z.number().positive().optional(),
    dealBreakers: nonEmptyStrings.default([]),
    excludedKeywords: nonEmptyStrings.default([]),
    scoreThreshold: z.number().min(0).max(100),
});

// read and load cv and criteria data
export async function loadProfile(root: string): Promise<Profile> {
    return { cv: await loadCv(root), criteria: await loadCriteria(root) };
}

// The two halves load on their own so that doctor can report on each without the failure of one
// hiding the state of the other.
export async function loadCv(root: string): Promise<string> {
    const path = join(root, CV_FILE);

    const cv = (await readText(path, `Create ${CV_FILE} with your markdown resume.`)).trim();
    if (cv.length === 0) {
        throw new ConfigError(`${path} is empty. Paste your resume in markdown format there.`);
    }

    return cv;
}

export async function loadCriteria(root: string): Promise<HardCriteria> {
    const path = join(root, PROFILE_FILE);
    const raw = await readText(path, `Copy src/examples/profile.example.yml to ${PROFILE_FILE} and adjust it.`);

    return parseCriteria(raw, path);
}

// load criteria data and parse it in yaml format, validating it against the expected schema
function parseCriteria(raw: string, path: string): HardCriteria {
    let document: unknown;
    try {
        document = parseYaml(raw);
    } catch (error) {
        throw new ConfigError(`${path} is not valid YAML: ${(error as Error).message}`);
    }

    const parsed = criteriaSchema.safeParse(document);
    if (!parsed.success) {
        const issues = parsed.error.issues
            .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('\n');
        throw new ConfigError(`${path} does not meet the expected format:\n${issues}`);
    }

    const { minimumSalaryUsd, ...rest } = parsed.data; // exactOptionalPropertyTypes does not allow the key to be present with a value of undefined
    return minimumSalaryUsd === undefined ? rest : { ...rest, minimumSalaryUsd };
}

async function readText(path: string, hint: string): Promise<string> {
    try {
        return await readFile(path, 'utf8');
    } catch (error) {
        if (isErrno(error) && error.code === 'ENOENT') {
            throw new ConfigError(`File not found: ${path}. ${hint}`);
        }
        if (isErrno(error) && error.code === 'EACCES') {
            throw new ConfigError(`No permission to read ${path}.`);
        }
        throw error;
    }
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error;
}
