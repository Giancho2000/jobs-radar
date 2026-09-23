import { ScoringError } from '../core/errors.js';
import type { Profile, Score, ScorerPort, Vacancy } from '../core/types.js';
import { createAnthropicScorer } from './anthropic.js';
import { createOpenAiScorer } from './openai.js';
import { resolveLlmConfig, type LlmConfig } from './config.js';

const ATTEMPTS = 3;
const BASE_DELAY_MS = 800;

export { resolveLlmConfig, type LlmConfig, type LlmProvider } from './config.js';
export { scoreSchema, buildSystemPrompt, buildUserPrompt, parseScore } from './prompt.js';

export function createScorer(config: LlmConfig = resolveLlmConfig()): ScorerPort {
    const scorer =
        config.provider === 'anthropic' ? createAnthropicScorer(config) : createOpenAiScorer(config);

    return {
        async score(vacancy: Vacancy, profile: Profile): Promise<Score> {
            return withRetries(() => scorer.score(vacancy, profile), vacancy);
        },
    };
}

// Only malformed answers are retried here. Rate limits, timeouts and 5xx are already retried by
// both SDKs with their own backoff, and retrying them again turns one 429 into nine requests.
async function withRetries(operation: () => Promise<Score>, vacancy: Vacancy): Promise<Score> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (!(error instanceof ScoringError) || !error.retryable || attempt === ATTEMPTS) {
                break;
            }
            await delay(BASE_DELAY_MS * 2 ** (attempt - 1));
        }
    }

    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new ScoringError(`Could not score "${vacancy.title}" at ${vacancy.company}: ${detail}`);
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}
