import { rename, writeFile } from 'node:fs/promises';

// A half written file is worse than an old one: these are files the user reads every morning.
export async function writeAtomically(path: string, content: string): Promise<void> {
    const temporary = `${path}.tmp`;
    await writeFile(temporary, content, 'utf8');
    await rename(temporary, path);
}

export function isErrno(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error;
}
