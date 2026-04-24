import { describe, expect, it } from 'vitest';
import { timeAgo, authorLabel } from '@/ui/versions';

// Pure-function tests — no DOM. Vitest runs in `environment: 'node'`.

describe('timeAgo', () => {
  const now = Date.parse('2026-04-23T12:00:00Z');

  it('shows "just now" for deltas under 45 seconds', () => {
    const iso = new Date(now - 10_000).toISOString();
    expect(timeAgo(iso, now)).toBe('just now');
  });

  it('shows minutes for deltas under an hour', () => {
    const iso = new Date(now - 5 * 60_000).toISOString();
    expect(timeAgo(iso, now)).toBe('5m ago');
  });

  it('shows hours for deltas under a day', () => {
    const iso = new Date(now - 3 * 3600_000).toISOString();
    expect(timeAgo(iso, now)).toBe('3h ago');
  });

  it('shows days for deltas over a day', () => {
    const iso = new Date(now - 4 * 86_400_000).toISOString();
    expect(timeAgo(iso, now)).toBe('4d ago');
  });

  it('clamps future timestamps to "just now"', () => {
    const iso = new Date(now + 60_000).toISOString();
    expect(timeAgo(iso, now)).toBe('just now');
  });

  it('falls back to the raw input when the date cannot be parsed', () => {
    expect(timeAgo('not-a-date', now)).toBe('not-a-date');
  });
});

describe('authorLabel', () => {
  it('returns "you" when createdBy matches the current user', () => {
    expect(authorLabel('abc-123', 'abc-123')).toBe('you');
  });

  it('returns a 6-char shortened uuid when a different user created the row', () => {
    expect(authorLabel('abc1234-5678', 'def-999')).toBe('abc123\u2026');
  });

  it('returns an em-dash when createdBy is null', () => {
    expect(authorLabel(null, 'abc-123')).toBe('\u2014');
  });

  it('returns a shortened uuid when no current user is known', () => {
    expect(authorLabel('xyz1234', null)).toBe('xyz123\u2026');
  });
});
