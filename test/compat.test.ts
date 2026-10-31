import { describe, expect, it } from 'vitest';
import {
  buildAnthropicHeaders,
  detectAuthScheme,
  hasXApiKey,
} from '../src/compat/index.js';

describe('anthropic auth scheme detection', () => {
  it('detects the official Anthropic endpoint', () => {
    expect(detectAuthScheme('https://api.anthropic.com/v1')).toBe('x-api-key');
  });

  it('detects MiniMax anthropic-compat endpoints', () => {
    expect(detectAuthScheme('https://api.minimaxi.com/anthropic')).toBe('x-api-key');
    expect(detectAuthScheme('https://api.minimax.io/anthropic')).toBe('x-api-key');
  });

  it('falls back to bearer for self-hosted proxies', () => {
    expect(detectAuthScheme('https://proxy.example.com/v1')).toBe('bearer');
  });
});

describe('anthropic header construction', () => {
  it('uses X-Api-Key when the scheme demands it', () => {
    const headers = buildAnthropicHeaders({
      apiKey: 'secret-key',
      baseUrl: 'https://api.minimaxi.com/anthropic',
    });

    expect(headers['X-Api-Key']).toBe('secret-key');
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['content-type']).toBe('application/json');
    expect(hasXApiKey(headers)).toBe(true);
  });

  it('uses Authorization Bearer when the scheme demands it', () => {
    const headers = buildAnthropicHeaders({
      apiKey: 'secret-key',
      baseUrl: 'https://proxy.example.com/v1',
    });

    expect(headers['Authorization']).toBe('Bearer secret-key');
    expect(headers['X-Api-Key']).toBeUndefined();
    expect(hasXApiKey(headers)).toBe(false);
  });

  it('honours an explicit auth scheme over URL detection', () => {
    const headers = buildAnthropicHeaders({
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      authScheme: 'bearer',
    });
    expect(headers['Authorization']).toBe('Bearer k');
  });

  it('defaults to x-api-key when no base url is supplied', () => {
    const headers = buildAnthropicHeaders({ apiKey: 'k' });
    expect(headers['X-Api-Key']).toBe('k');
  });

  it('allows overriding the anthropic-version header', () => {
    const headers = buildAnthropicHeaders({
      apiKey: 'k',
      version: '2024-01-01',
    });
    expect(headers['anthropic-version']).toBe('2024-01-01');
  });

  it('merges extra headers last so they can win', () => {
    const headers = buildAnthropicHeaders({
      apiKey: 'k',
      extraHeaders: { 'X-Trace-Id': 'abc123' },
    });
    expect(headers['X-Trace-Id']).toBe('abc123');
  });

  it('never leaks the api key into a non-auth header', () => {
    const headers = buildAnthropicHeaders({
      apiKey: 'super-secret',
      baseUrl: 'https://api.minimaxi.com/anthropic',
    });
    const nonAuthEntries = Object.entries(headers).filter(
      ([key]) => key.toLowerCase() !== 'x-api-key' && key.toLowerCase() !== 'authorization',
    );
    for (const [, value] of nonAuthEntries) {
      expect(value).not.toContain('super-secret');
    }
  });
});
