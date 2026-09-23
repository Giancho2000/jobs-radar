import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { ScoringError } from '../core/errors.js';
import type { Profile, Score, ScorerPort, Vacancy } from '../core/types.js';
import type { LlmConfig } from './config.js';
import { buildSystemPrompt, buildUserPrompt, scoreSchema } from './prompt.js';

// The answer is a small object, but on models with thinking enabled the budget is shared with the
// reasoning, so this is not the size of the JSON.
const MAX_OUTPUT_TOKENS = 16_000;

export function createAnthropicScorer(config: LlmConfig): ScorerPort {
    const client = new Anthropic({
        apiKey: config.apiKey,
        ...(config.baseUrl === undefined ? {} : { baseURL: config.baseUrl }),
    });

    return {
        async score(vacancy: Vacancy, profile: Profile): Promise<Score> {
            const response = await client.messages.parse({
                model: config.model,
                max_tokens: MAX_OUTPUT_TOKENS,
                // The resume and the criteria are identical for every vacancy of a run, so they are
                // cached and only the vacancy is billed at full price after the first call.
                system: [
                    {
                        type: 'text',
                        text: buildSystemPrompt(profile),
                        cache_control: { type: 'ephemeral' },
                    },
                ],
                messages: [{ role: 'user', content: buildUserPrompt(vacancy) }],
                output_config: { format: zodOutputFormat(scoreSchema) },
            });

            if (response.stop_reason === 'refusal') {
                throw new ScoringError(
                    `The model declined to score "${vacancy.title}" at ${vacancy.company}.`,
                    false
                );
            }

            const parsed = response.parsed_output;
            if (parsed === null || parsed === undefined) {
                throw new ScoringError(
                    `The model answered without a valid score for "${vacancy.title}".`
                );
            }

            return parsed;
        },
    };
}
