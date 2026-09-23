import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScoringError } from '../core/errors.js';
import type { Profile, Score, Vacancy } from '../core/types.js';
import { createScorer } from './index.js';

// A stand in for the provider, so the request that really goes out over HTTP is the one under
// test, without an api key and without spending anything.
interface FakeProvider {
    url: string;
    calls: () => number;
    lastBody: () => string;
    lastPath: () => string;
    lastHeaders: () => Record<string, string | string[] | undefined>;
    answer: (body: unknown) => void;
    close: () => Promise<void>;
}

async function startProvider(): Promise<FakeProvider> {
    let calls = 0;
    let lastBody = '';
    let lastPath = '';
    let lastHeaders: Record<string, string | string[] | undefined> = {};
    let next: unknown = {};

    const server: Server = createServer((request, response) => {
        calls += 1;
        lastPath = request.url ?? '';
        lastHeaders = request.headers;
        let body = '';
        request.on('data', (chunk) => {
            body += String(chunk);
        });
        request.on('end', () => {
            lastBody = body;
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify(typeof next === 'function' ? (next as () => unknown)() : next));
        });
    });

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    return {
        url: `http://127.0.0.1:${port}`,
        calls: () => calls,
        lastBody: () => lastBody,
        lastPath: () => lastPath,
        lastHeaders: () => lastHeaders,
        answer: (body: unknown) => {
            next = body;
        },
        close: () =>
            new Promise<void>((resolve) => {
                server.close(() => resolve());
            }),
    };
}

const PROFILE: Profile = {
    cv: 'Backend developer, Node.js.',
    criteria: {
        seniorityLevels: ['senior'],
        workModes: ['remote'],
        locations: ['Remote'],
        dealBreakers: [],
        excludedKeywords: [],
        scoreThreshold: 75,
    },
};

const VACANCY: Vacancy = {
    id: 'greenhouse:1',
    source: 'greenhouse',
    sourceId: '1',
    title: 'Sr. Node.js Engineer',
    company: 'Acme',
    applyUrl: 'https://example.com/1',
    dedupKey: 'key',
    seenAt: new Date('2026-09-22T10:00:00Z'),
};

const ANSWER: Score = {
    value: 82,
    confidence: 'high',
    matchedStack: ['Node.js'],
    criticalGaps: [],
    minorGaps: [],
    redFlags: [],
    missingAtsKeywords: [],
    verdict: 'apply',
    reason: 'Strong match.',
};

const chat = (content: string): unknown => ({
    id: 'x',
    object: 'chat.completion',
    created: 1,
    model: 'fake',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
});

const message = (text: string, stopReason = 'end_turn'): unknown => ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: stopReason === 'refusal' ? [] : [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
});

let provider: FakeProvider;

beforeEach(async () => {
    provider = await startProvider();
});

afterEach(async () => {
    await provider.close();
});

describe('the OpenAI compatible path', () => {
    const scorerAt = (url: string) =>
        createScorer({ provider: 'ollama', model: 'fake', apiKey: 'x', baseUrl: `${url}/v1` });

    it('asks for a JSON object and sends both prompts', async () => {
        provider.answer(chat(JSON.stringify(ANSWER)));

        await scorerAt(provider.url).score(VACANCY, PROFILE);

        expect(provider.lastBody()).toContain('"response_format":{"type":"json_object"}');
        expect(provider.lastBody()).toContain('Backend developer, Node.js.');
        expect(provider.lastBody()).toContain('Sr. Node.js Engineer');
    });

    it('returns the score', async () => {
        provider.answer(chat(JSON.stringify(ANSWER)));

        await expect(scorerAt(provider.url).score(VACANCY, PROFILE)).resolves.toEqual(ANSWER);
    });

    it('asks again when the answer is not usable', async () => {
        let first = true;
        provider.answer(() => {
            const body = first ? chat('not json at all') : chat(JSON.stringify(ANSWER));
            first = false;
            return body;
        });

        await expect(scorerAt(provider.url).score(VACANCY, PROFILE)).resolves.toEqual(ANSWER);
        expect(provider.calls()).toBe(2);
    });

    it('gives up after three tries and names the vacancy', async () => {
        provider.answer(chat('still not json'));

        await expect(scorerAt(provider.url).score(VACANCY, PROFILE)).rejects.toThrow(ScoringError);
        expect(provider.calls()).toBe(3);
    });

    it('complains about an empty answer', async () => {
        provider.answer(chat(''));

        await expect(scorerAt(provider.url).score(VACANCY, PROFILE)).rejects.toThrow(
            /returned an empty answer/
        );
    });
});

describe('the Anthropic path', () => {
    const scorerAt = (url: string) =>
        createScorer({ provider: 'anthropic', model: 'claude-opus-5', apiKey: 'sk-test', baseUrl: url });

    it('posts to the messages endpoint with the version header', async () => {
        provider.answer(message(JSON.stringify(ANSWER)));

        await scorerAt(provider.url).score(VACANCY, PROFILE);

        expect(provider.lastPath()).toBe('/v1/messages');
        expect(provider.lastHeaders()['anthropic-version']).toBeDefined();
        expect(provider.lastHeaders()['x-api-key']).toBe('sk-test');
    });

    it('asks for a structured answer rather than prefilling one', async () => {
        provider.answer(message(JSON.stringify(ANSWER)));

        await scorerAt(provider.url).score(VACANCY, PROFILE);
        const body: { output_config?: { format?: { type?: string } } } = JSON.parse(provider.lastBody());

        expect(body.output_config?.format?.type).toBe('json_schema');
        // Assistant prefill is rejected by the current models
        expect(provider.lastBody()).not.toContain('"role":"assistant"');
    });

    it('caches the part of the prompt that does not change between vacancies', async () => {
        provider.answer(message(JSON.stringify(ANSWER)));

        await scorerAt(provider.url).score(VACANCY, PROFILE);

        expect(provider.lastBody()).toContain('"cache_control":{"type":"ephemeral"}');
    });

    it('returns the score', async () => {
        provider.answer(message(JSON.stringify(ANSWER)));

        await expect(scorerAt(provider.url).score(VACANCY, PROFILE)).resolves.toMatchObject({
            value: 82,
            verdict: 'apply',
        });
    });

    it('does not argue with a refusal', async () => {
        provider.answer(message('', 'refusal'));

        await expect(scorerAt(provider.url).score(VACANCY, PROFILE)).rejects.toThrow(/declined to score/);
        expect(provider.calls()).toBe(1);
    });
});
