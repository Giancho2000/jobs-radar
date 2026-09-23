import { describe, expect, it } from 'vitest';
import { ConfigError } from '../core/errors.js';
import { resolveLlmConfig } from './config.js';

describe('resolveLlmConfig', () => {
    it('takes the provider it was told to take', () => {
        const config = resolveLlmConfig({
            JOBS_RADAR_LLM_PROVIDER: 'openai',
            OPENAI_API_KEY: 'k',
            ANTHROPIC_API_KEY: 'a',
        });

        expect(config.provider).toBe('openai');
    });

    it('infers the provider from the key that exists', () => {
        expect(resolveLlmConfig({ ANTHROPIC_API_KEY: 'a' }).provider).toBe('anthropic');
        expect(resolveLlmConfig({ OPENAI_API_KEY: 'k' }).provider).toBe('openai');
    });

    it('falls back to a local model when there is no key at all', () => {
        const config = resolveLlmConfig({});

        expect(config.provider).toBe('ollama');
        expect(config.baseUrl).toBe('http://localhost:11434/v1');
    });

    it('respects an Ollama on another host', () => {
        expect(resolveLlmConfig({ OLLAMA_HOST: 'http://box:9999' }).baseUrl).toBe('http://box:9999/v1');
    });

    it('has a default model per provider', () => {
        expect(resolveLlmConfig({ ANTHROPIC_API_KEY: 'a' }).model).toBe('claude-opus-5');
        expect(resolveLlmConfig({ OPENAI_API_KEY: 'k' }).model).toBe('gpt-4.1-mini');
        expect(resolveLlmConfig({}).model).toBe('llama3.1');
    });

    it('lets the model be overridden', () => {
        const config = resolveLlmConfig({
            ANTHROPIC_API_KEY: 'a',
            JOBS_RADAR_LLM_MODEL: 'claude-haiku-4-5',
        });

        expect(config.model).toBe('claude-haiku-4-5');
    });

    it('lets the endpoint be overridden, which is what a gateway needs', () => {
        const config = resolveLlmConfig({
            JOBS_RADAR_LLM_PROVIDER: 'openai',
            OPENAI_API_KEY: 'k',
            JOBS_RADAR_LLM_BASE_URL: 'https://openrouter.ai/api/v1',
        });

        expect(config.baseUrl).toBe('https://openrouter.ai/api/v1');
    });

    it('says which variable is missing, and how to run without one', () => {
        expect(() => resolveLlmConfig({ JOBS_RADAR_LLM_PROVIDER: 'anthropic' })).toThrow(ConfigError);
        expect(() => resolveLlmConfig({ JOBS_RADAR_LLM_PROVIDER: 'anthropic' })).toThrow(
            /ANTHROPIC_API_KEY is not set.*JOBS_RADAR_LLM_PROVIDER=ollama/s
        );
    });

    it('rejects a provider that does not exist', () => {
        expect(() => resolveLlmConfig({ JOBS_RADAR_LLM_PROVIDER: 'gemini' })).toThrow(
            /Use anthropic, openai or ollama/
        );
    });

    it('treats an empty variable as absent', () => {
        expect(resolveLlmConfig({ ANTHROPIC_API_KEY: '   ' }).provider).toBe('ollama');
    });
});
