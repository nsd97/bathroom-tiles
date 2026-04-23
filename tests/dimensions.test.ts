import { describe, it, expect } from 'vitest';
import { parseDim, formatDim } from '@/core/dimensions';

describe('parseDim', () => {
  it('parses feet-and-inches with double quote', () => {
    expect(parseDim('14\'2"')).toBe(170);
  });
  it('parses feet-and-inches without inch unit', () => {
    expect(parseDim("14'2")).toBe(170);
  });
  it('parses plain inches with quote', () => {
    expect(parseDim('170"')).toBe(170);
  });
  it('parses plain inches without unit', () => {
    expect(parseDim('170')).toBe(170);
  });
  it('parses decimal feet', () => {
    expect(parseDim('14.5ft')).toBe(174);
  });
  it('parses with whitespace and unicode quotes', () => {
    expect(parseDim('14\u2019 2\u201D')).toBe(170);
  });
  it('returns NaN for malformed input', () => {
    expect(parseDim('nope')).toBeNaN();
    expect(parseDim('')).toBeNaN();
    expect(parseDim(null)).toBeNaN();
  });
  it('treats whitespace-only and undefined as NaN', () => {
    expect(parseDim('   ')).toBeNaN();
    expect(parseDim(undefined)).toBeNaN();
  });

  it('coerces number inputs via String()', () => {
    expect(parseDim(170)).toBe(170);
  });
});

describe('formatDim', () => {
  it('formats round feet', () => {
    expect(formatDim(168)).toBe("14'");
  });
  it('formats feet + inches', () => {
    expect(formatDim(170)).toBe('14\'2"');
  });
  it('formats pure inches when < 1 ft', () => {
    expect(formatDim(7.87)).toBe('7.87"');
  });
  it('formats integer inches without trailing zeros', () => {
    expect(formatDim(5)).toBe('5"');
    expect(formatDim(0)).toBe('0"');
  });

  it('round-trips with parseDim for representative values', () => {
    expect(parseDim(formatDim(170))).toBe(170);
    expect(parseDim(formatDim(168))).toBe(168);
    expect(parseDim(formatDim(7.87))).toBe(7.87);
  });
  it('returns empty string for NaN / null', () => {
    expect(formatDim(NaN)).toBe('');
    expect(formatDim(null)).toBe('');
  });
});
