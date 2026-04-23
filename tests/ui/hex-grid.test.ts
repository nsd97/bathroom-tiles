import { describe, it, expect } from 'vitest';
import {
  axialToPixel,
  pixelToAxial,
  hexVertices,
  hexesInRect,
} from '@/ui/hex-grid';
import type { HexOpts, HexShape } from '@/ui/hex-grid';

const SHAPES: HexShape[] = ['hex-pointy', 'hex-flat'];
const SIZES = [2, 3.5];

describe('axialToPixel / pixelToAxial round-trip', () => {
  for (const shape of SHAPES) {
    for (const sizeIn of SIZES) {
      it(`${shape} sizeIn=${sizeIn}: axial→pixel→axial preserves (q,r) across [-2,3]`, () => {
        const opts: HexOpts = { shape, sizeIn };
        for (let q = -2; q <= 3; q++) {
          for (let r = -2; r <= 3; r++) {
            const p = axialToPixel({ q, r }, opts);
            const a = pixelToAxial(p, opts);
            expect(a.q).toBe(q);
            expect(a.r).toBe(r);
          }
        }
      });
    }
  }
});

describe('hexVertices', () => {
  for (const shape of SHAPES) {
    for (const sizeIn of SIZES) {
      it(`${shape} sizeIn=${sizeIn}: returns 6 vertices all at distance sizeIn from center`, () => {
        const opts: HexOpts = { shape, sizeIn };
        const center = axialToPixel({ q: 1, r: -1 }, opts);
        const verts = hexVertices({ q: 1, r: -1 }, opts);
        expect(verts).toHaveLength(6);
        for (const v of verts) {
          const dx = v.x - center.x;
          const dy = v.y - center.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          expect(dist).toBeCloseTo(sizeIn, 6);
        }
      });
    }
  }
});

describe('hexesInRect', () => {
  it('hex-pointy 12x12 @ sizeIn=2 returns >0 hexes; each has a center or vertex inside rect', () => {
    const opts: HexOpts = { shape: 'hex-pointy', sizeIn: 2 };
    const rect = { widthIn: 12, heightIn: 12 };
    const list = hexesInRect(rect, opts);
    expect(list.length).toBeGreaterThan(0);
    for (const a of list) {
      const c = axialToPixel(a, opts);
      const centerInside =
        c.x >= 0 && c.x <= rect.widthIn && c.y >= 0 && c.y <= rect.heightIn;
      const verts = hexVertices(a, opts);
      const anyVertexInside = verts.some(
        (v) =>
          v.x >= 0 && v.x <= rect.widthIn && v.y >= 0 && v.y <= rect.heightIn,
      );
      expect(centerInside || anyVertexInside).toBe(true);
    }
  });

  it('hex-flat 12x12 @ sizeIn=2 returns >0 hexes; each has a center or vertex inside rect', () => {
    const opts: HexOpts = { shape: 'hex-flat', sizeIn: 2 };
    const rect = { widthIn: 12, heightIn: 12 };
    const list = hexesInRect(rect, opts);
    expect(list.length).toBeGreaterThan(0);
    for (const a of list) {
      const c = axialToPixel(a, opts);
      const centerInside =
        c.x >= 0 && c.x <= rect.widthIn && c.y >= 0 && c.y <= rect.heightIn;
      const verts = hexVertices(a, opts);
      const anyVertexInside = verts.some(
        (v) =>
          v.x >= 0 && v.x <= rect.widthIn && v.y >= 0 && v.y <= rect.heightIn,
      );
      expect(centerInside || anyVertexInside).toBe(true);
    }
  });
});
