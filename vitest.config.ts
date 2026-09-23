import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        // node:sqlite is still flagged experimental on Node 22 and warns on every import
        pool: 'forks',
        poolOptions: { forks: { execArgv: ['--disable-warning=ExperimentalWarning'] } },
    },
});
