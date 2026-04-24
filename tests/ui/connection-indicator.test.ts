import { describe, expect, it } from 'vitest';
import { pillStateFor } from '../../src/ui/connection-indicator';

describe('pillStateFor', () => {
  it('hides when realtime is subscribed and browser is online', () => {
    expect(pillStateFor('SUBSCRIBED', true)).toEqual({ text: null, variant: null });
  });

  it('shows Reconnecting (neutral) on CHANNEL_ERROR while online', () => {
    expect(pillStateFor('CHANNEL_ERROR', true)).toEqual({
      text: 'Reconnecting\u2026',
      variant: 'neutral',
    });
  });

  it('shows Reconnecting (neutral) on TIMED_OUT while online', () => {
    expect(pillStateFor('TIMED_OUT', true)).toEqual({
      text: 'Reconnecting\u2026',
      variant: 'neutral',
    });
  });

  it('shows Reconnecting (neutral) on CLOSED while online', () => {
    expect(pillStateFor('CLOSED', true)).toEqual({
      text: 'Reconnecting\u2026',
      variant: 'neutral',
    });
  });

  it('shows Offline (danger) when the browser is offline', () => {
    expect(pillStateFor('SUBSCRIBED', false)).toEqual({
      text: 'Offline',
      variant: 'danger',
    });
  });

  it('Offline takes precedence over Reconnecting', () => {
    expect(pillStateFor('CHANNEL_ERROR', false)).toEqual({
      text: 'Offline',
      variant: 'danger',
    });
    expect(pillStateFor('TIMED_OUT', false)).toEqual({
      text: 'Offline',
      variant: 'danger',
    });
    expect(pillStateFor('CLOSED', false)).toEqual({
      text: 'Offline',
      variant: 'danger',
    });
  });
});
