import { PX_PER_INCH } from '@/core/grid';
import type { State, Surface } from '@/core/state';
import type { Tile } from '@/core/tile';
import { hexVertices, hexesInRect, type HexShape, type Point } from './hex-grid';

/** Tile narrowed to the hex shapes — `renderHexSurface` must not be called for squares. */
type HexTile = Tile & { shape: HexShape };

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Render a hex-tiled surface as an <svg>. Each hex is a <polygon> with
 * `data-surface-id` + `data-cell-key="q,r"` so the shared paint wiring in
 * `surface.ts` targets it the same way as a square `.tile` div. Hexes that
 * extend past the rect are visually clipped by the surface-scoped
 * <clipPath> but remain hittable (so users can paint a cut hex).
 */
export function renderHexSurface(s: Surface, tile: HexTile, state: State): SVGSVGElement {
  const widthPx = s.widthIn * PX_PER_INCH;
  const heightPx = s.heightIn * PX_PER_INCH;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('hex-grid');
  svg.setAttribute('viewBox', `0 0 ${widthPx} ${heightPx}`);
  svg.setAttribute('width', String(widthPx));
  svg.setAttribute('height', String(heightPx));
  // Matches the bordered look of the square `.grid` container so surfaces
  // line up visually whether they're square or hex.
  svg.dataset.surfaceId = s.id;

  const clipId = `clip-${s.id}`;
  const defs = document.createElementNS(SVG_NS, 'defs');
  const clipPath = document.createElementNS(SVG_NS, 'clipPath');
  clipPath.setAttribute('id', clipId);
  const clipRect = document.createElementNS(SVG_NS, 'rect');
  clipRect.setAttribute('x', '0');
  clipRect.setAttribute('y', '0');
  clipRect.setAttribute('width', String(widthPx));
  clipRect.setAttribute('height', String(heightPx));
  clipPath.appendChild(clipRect);
  defs.appendChild(clipPath);
  svg.appendChild(defs);

  // Group everything under a single `clip-path` ref — cheaper than attaching
  // per-polygon.
  const layer = document.createElementNS(SVG_NS, 'g');
  layer.setAttribute('clip-path', `url(#${clipId})`);
  svg.appendChild(layer);

  const painted = state.tiles[s.id] ?? new Map<string, string>();
  const opts = { shape: tile.shape, sizeIn: tile.sizeIn } as const;
  const hexes = hexesInRect({ widthIn: s.widthIn, heightIn: s.heightIn }, opts);
  for (const a of hexes) {
    const verts = hexVertices(a, opts).map(
      (v: Point): Point => ({ x: v.x * PX_PER_INCH, y: v.y * PX_PER_INCH }),
    );
    const key = `${a.q},${a.r}`;
    const poly = document.createElementNS(SVG_NS, 'polygon');
    poly.setAttribute(
      'points',
      verts.map((v) => `${v.x.toFixed(3)},${v.y.toFixed(3)}`).join(' '),
    );
    poly.setAttribute('stroke', 'var(--grid-line)');
    poly.setAttribute('stroke-width', '1');
    const color = painted.get(key);
    poly.setAttribute('fill', color ?? 'white');
    poly.dataset.surfaceId = s.id;
    poly.dataset.cellKey = key;
    poly.dataset.q = String(a.q);
    poly.dataset.r = String(a.r);
    layer.appendChild(poly);
  }
  return svg;
}
