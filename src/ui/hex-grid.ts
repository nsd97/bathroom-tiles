/**
 * Axial hex-grid geometry. Coordinates in inches; scale to pixels at the
 * render layer. Formulas follow the standard axial model
 * (https://www.redblobgames.com/grids/hexagons/), with `sizeIn` representing
 * the hex's edge length (= distance from center to any vertex).
 */

export type HexShape = 'hex-pointy' | 'hex-flat';
export interface HexOpts {
  shape: HexShape;
  sizeIn: number;
}
export interface Axial {
  q: number;
  r: number;
}
export interface Point {
  x: number;
  y: number;
}

const SQRT3 = Math.sqrt(3);

export function axialToPixel({ q, r }: Axial, opts: HexOpts): Point {
  const s = opts.sizeIn;
  if (opts.shape === 'hex-pointy') {
    return { x: s * SQRT3 * (q + r / 2), y: s * (3 / 2) * r };
  }
  return { x: s * (3 / 2) * q, y: s * SQRT3 * (r + q / 2) };
}

export function pixelToAxial({ x, y }: Point, opts: HexOpts): Axial {
  const s = opts.sizeIn;
  let qf: number;
  let rf: number;
  if (opts.shape === 'hex-pointy') {
    qf = ((x * SQRT3) / 3 - y / 3) / s;
    rf = ((y * 2) / 3) / s;
  } else {
    qf = ((x * 2) / 3) / s;
    rf = (-x / 3 + (y * SQRT3) / 3) / s;
  }
  return hexRound(qf, rf);
}

function hexRound(qf: number, rf: number): Axial {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

export function hexVertices(a: Axial, opts: HexOpts): Point[] {
  const c = axialToPixel(a, opts);
  const s = opts.sizeIn;
  // Pointy-top: first vertex at top (−30° offset from 0° = −π/6).
  // Flat-top:   first vertex at right (0°).
  const startAngle = opts.shape === 'hex-pointy' ? -Math.PI / 6 : 0;
  const pts: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const ang = startAngle + (i * Math.PI) / 3;
    pts.push({ x: c.x + s * Math.cos(ang), y: c.y + s * Math.sin(ang) });
  }
  return pts;
}

/**
 * Enumerate every axial (q, r) whose hex overlaps the given rect — i.e. whose
 * center is inside OR any of whose vertices is inside. The envelope is taken
 * from the rect's four corners with a +/-1 margin to catch hexes that
 * straddle the envelope boundary.
 */
export function hexesInRect(
  rect: { widthIn: number; heightIn: number },
  opts: HexOpts,
): Axial[] {
  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: rect.widthIn, y: 0 },
    { x: 0, y: rect.heightIn },
    { x: rect.widthIn, y: rect.heightIn },
  ];
  const qs: number[] = [];
  const rs: number[] = [];
  for (const c of corners) {
    const a = pixelToAxial(c, opts);
    qs.push(a.q);
    rs.push(a.r);
  }
  const qmin = Math.min(...qs) - 1;
  const qmax = Math.max(...qs) + 1;
  const rmin = Math.min(...rs) - 1;
  const rmax = Math.max(...rs) + 1;
  const out: Axial[] = [];
  for (let q = qmin; q <= qmax; q++) {
    for (let r = rmin; r <= rmax; r++) {
      const c = axialToPixel({ q, r }, opts);
      if (
        c.x >= 0 &&
        c.x <= rect.widthIn &&
        c.y >= 0 &&
        c.y <= rect.heightIn
      ) {
        out.push({ q, r });
        continue;
      }
      const verts = hexVertices({ q, r }, opts);
      if (
        verts.some(
          (v) =>
            v.x >= 0 &&
            v.x <= rect.widthIn &&
            v.y >= 0 &&
            v.y <= rect.heightIn,
        )
      ) {
        out.push({ q, r });
      }
    }
  }
  return out;
}
