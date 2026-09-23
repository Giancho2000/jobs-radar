import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ConfigError } from '../core/errors.js';

const SOURCES_FILE = 'sources.yml';

// Board tokens, not urls: the piece of https://boards.greenhouse.io/nubank that identifies the
// company. Kept apart from profile.yml because that file describes the candidate, not the search.
const sourcesSchema = z.strictObject({
    greenhouse: z.array(z.string().trim().min(1)).default([]),
});

export interface SourcesConfig {
    greenhouse: string[];
}

export async function loadSources(root: string): Promise<SourcesConfig> {
    const path = join(root, SOURCES_FILE);

    let raw: string;
    try {
        raw = await readFile(path, 'utf8');
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            throw new ConfigError(
                `File not found: ${path}. Copy src/examples/sources.example.yml to ${SOURCES_FILE} and list the boards you want to watch.`
            );
        }
        throw error;
    }

    let document: unknown;
    try {
        document = parseYaml(raw);
    } catch (error) {
        throw new ConfigError(`${path} is not valid YAML: ${(error as Error).message}`);
    }

    const parsed = sourcesSchema.safeParse(document ?? {});
    if (!parsed.success) {
        const issues = parsed.error.issues
            .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('\n');
        throw new ConfigError(`${path} does not meet the expected format:\n${issues}`);
    }

    if (parsed.data.greenhouse.length === 0) {
        throw new ConfigError(`${path} lists no sources, so a run would have nothing to read.`);
    }

    return parsed.data;
}
