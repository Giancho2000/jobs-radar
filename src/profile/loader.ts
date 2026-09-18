import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ConfigError } from '../core/errors.js';
import type { HardCriteria, Profile } from '../core/types.js';

const CV_FILE = 'cv.md';
const PROFILE_FILE = 'profile.yml';

const nonEmptyStrings = z.array(z.string().trim().min(1));

const criteriaSchema = z.object({
    seniorityLevels: nonEmptyStrings.min(1),
    workModes: z.array(z.enum(['remote', 'onsite', 'hybrid'])).min(1),
    locations: nonEmptyStrings.min(1),
    minimumSalaryUsd: z.number().positive().optional(),
    dealBreakers: nonEmptyStrings.default([]),
    excludedKeywords: nonEmptyStrings.default([]),
    scoreThreshold: z.number().min(0).max(100),
});

export async function loadProfile(root: string): Promise<Profile> {
    const cvPath = join(root, CV_FILE);
    const profilePath = join(root, PROFILE_FILE);

    const cv = (await readText(cvPath, `Crea ${CV_FILE} con tu hoja de vida en markdown.`)).trim();
    if (cv.length === 0) {
        throw new ConfigError(`${cvPath} está vacío. Pega ahí tu hoja de vida en markdown.`);
    }

    const raw = await readText(profilePath, `Copia src/examples/profile.example.yml a ${PROFILE_FILE} y ajústalo.`);
    const criteria = parseCriteria(raw, profilePath);

    return { cv, criteria };
}

function parseCriteria(raw: string, path: string): HardCriteria {
    let document: unknown;
    try {
        document = parseYaml(raw);
    } catch (error) {
        throw new ConfigError(`${path} no es YAML válido: ${(error as Error).message}`);
    }

    const parsed = criteriaSchema.safeParse(document);
    if (!parsed.success) {
        const issues = parsed.error.issues
            .map((issue) => `  - ${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
            .join('\n');
        throw new ConfigError(`${path} no cumple el formato esperado:\n${issues}`);
    }

    // exactOptionalPropertyTypes prohíbe la clave presente con valor undefined
    const { minimumSalaryUsd, ...rest } = parsed.data;
    return minimumSalaryUsd === undefined ? rest : { ...rest, minimumSalaryUsd };
}

async function readText(path: string, hint: string): Promise<string> {
    try {
        return await readFile(path, 'utf8');
    } catch (error) {
        if (isErrno(error) && error.code === 'ENOENT') {
            throw new ConfigError(`No encontré ${path}. ${hint}`);
        }
        if (isErrno(error) && error.code === 'EACCES') {
            throw new ConfigError(`No tengo permiso para leer ${path}.`);
        }
        throw error;
    }
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error;
}
