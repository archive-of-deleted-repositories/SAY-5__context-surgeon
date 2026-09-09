import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { count } from '../src/tokens/index.js';
import { resetExactClientForTests } from '../src/tokens/exact.js';
import { haikuClassifier } from '../src/analyze/conflicts.js';

describe('installed Anthropic SDK compatibility', () => {
  beforeEach(() => {
    resetExactClientForTests();
    vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-offline-sdk-key');
  });

  afterEach(() => {
    resetExactClientForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('serializes countTokens through the real SDK and returns its token count', async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(new URL(request.url).pathname).toBe('/v1/messages/count_tokens');
      expect(request.method).toBe('POST');
      expect(await request.json()).toEqual({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'Synthetic counting fixture.' }],
      });
      return Response.json({ input_tokens: 17 });
    });
    vi.stubGlobal('fetch', fetch);

    await expect(count('Synthetic counting fixture.', { force: 'exact' })).resolves.toEqual({ tokens: 17, mode: 'exact' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('serializes messages.create through the real SDK and parses the classifier verdict', async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(new URL(request.url).pathname).toBe('/v1/messages');
      expect(request.method).toBe('POST');
      const body = await request.json() as { model: string; max_tokens: number; messages: Array<{ role: string; content: string }> };
      expect(body.model).toBe('claude-haiku-4-5');
      expect(body.max_tokens).toBe(200);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0]?.role).toBe('user');
      expect(body.messages[0]?.content).toContain('Use tabs.');
      expect(body.messages[0]?.content).toContain('Use spaces.');
      return Response.json({
        id: 'synthetic-message', type: 'message', role: 'assistant', model: body.model,
        content: [{ type: 'text', text: JSON.stringify({ contradicts: true, why: 'The indentation rules conflict.' }) }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 20, output_tokens: 10 },
      });
    });
    vi.stubGlobal('fetch', fetch);

    await expect(haikuClassifier(
      { path: '/synthetic/a.md', line: 1, text: 'Use tabs.' },
      { path: '/synthetic/b.md', line: 1, text: 'Use spaces.' },
    )).resolves.toEqual({ contradicts: true, why: 'The indentation rules conflict.' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
