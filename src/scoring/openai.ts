import OpenAI from 'openai';
import { ScoringError } from '../core/errors.js';
import type { Profile, Score, ScorerPort, Vacancy } from '../core/types.js';
import type { LlmConfig } from './config.js';
import { buildSystemPrompt, buildUserPrompt, parseScore } from './prompt.js';

const MAX_OUTPUT_TOKENS = 4_096;

// Covers OpenAI, Ollama and anything else that speaks the same protocol (OpenRouter, Groq, vLLM,
// LM Studio), which is why the base url is part of the configuration and not of this file.
export function createOpenAiScorer(config: LlmConfig): ScorerPort {
    const client = new OpenAI({
        apiKey: config.apiKey,
        ...(config.baseUrl === undefined ? {} : { baseURL: config.baseUrl }),
    });

    return {
        async score(vacancy: Vacancy, profile: Profile): Promise<Score> {
            const completion = await client.chat.completions.create({
                model: config.model,
                max_completion_tokens: MAX_OUTPUT_TOKENS,
                // json_object rather than json_schema: every compatible server implements it, and
                // the shape is already spelled out in the prompt and validated with zod afterwards.
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: buildSystemPrompt(profile) },
                    { role: 'user', content: buildUserPrompt(vacancy) },
                ],
            });

            const content = completion.choices[0]?.message.content;
            if (content === null || content === undefined || content.trim().length === 0) {
                throw new ScoringError(
                    `${config.provider} returned an empty answer for "${vacancy.title}".`
                );
            }

            return parseScore(content);
        },
    };
}
