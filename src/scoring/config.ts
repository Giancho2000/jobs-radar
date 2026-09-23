import { ConfigError } from '../core/errors.js';

export type LlmProvider = 'anthropic' | 'openai' | 'ollama';

export interface LlmConfig {
    provider: LlmProvider;
    model: string;
    apiKey: string;
    baseUrl?: string;
}

const DEFAULT_MODEL: Record<LlmProvider, string> = {
    anthropic: 'claude-opus-5',
    openai: 'gpt-4.1-mini',
    ollama: 'llama3.1',
};

const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';

// Reads the environment instead of profile.yml on purpose: profile.yml describes the candidate and
// gets shared as an example, while these values are credentials and machine setup.
export function resolveLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
    const provider = resolveProvider(env);
    const model = trimmed(env['JOBS_RADAR_LLM_MODEL']) ?? DEFAULT_MODEL[provider];
    const baseUrl = trimmed(env['JOBS_RADAR_LLM_BASE_URL']);

    if (provider === 'ollama') {
        const host = baseUrl ?? `${trimmed(env['OLLAMA_HOST']) ?? DEFAULT_OLLAMA_HOST}/v1`;
        // Ollama speaks the OpenAI protocol and ignores the key, but the client demands one
        return { provider, model, apiKey: 'ollama', baseUrl: host };
    }

    const variable = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
    const apiKey = trimmed(env[variable]);
    if (apiKey === undefined) {
        throw new ConfigError(
            `${variable} is not set and the LLM provider is "${provider}". ` +
                'Export the key, or set JOBS_RADAR_LLM_PROVIDER=ollama to score with a local model.'
        );
    }

    const config: LlmConfig = { provider, model, apiKey };
    return baseUrl === undefined ? config : { ...config, baseUrl };
}

// An explicit provider always wins. Without one, the key that exists decides: a machine that has
// only one of them has already answered the question.
function resolveProvider(env: NodeJS.ProcessEnv): LlmProvider {
    const declared = trimmed(env['JOBS_RADAR_LLM_PROVIDER'])?.toLowerCase();

    if (declared !== undefined) {
        if (declared !== 'anthropic' && declared !== 'openai' && declared !== 'ollama') {
            throw new ConfigError(
                `JOBS_RADAR_LLM_PROVIDER is "${declared}". Use anthropic, openai or ollama.`
            );
        }
        return declared;
    }

    if (trimmed(env['ANTHROPIC_API_KEY']) !== undefined) {
        return 'anthropic';
    }
    if (trimmed(env['OPENAI_API_KEY']) !== undefined) {
        return 'openai';
    }
    return 'ollama';
}

function trimmed(value: string | undefined): string | undefined {
    const result = value?.trim();
    return result === undefined || result.length === 0 ? undefined : result;
}
