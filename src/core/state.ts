import { DEFAULT_PALETTE } from './palette';

export type Tool = 'paint' | 'eyedrop' | 'erase';
export type ViewMode = '2d' | '3d';
export type SurfaceGroup = 'Floors' | 'Ceiling' | 'Walls';

export interface Surface {
  id: string;
  group: SurfaceGroup;
  name: string;
  widthIn: number;
  heightIn: number;
  note?: string;
  heightLocked?: boolean;
}

export interface Orbit {
  rotX: number;
  rotY: number;
}

export interface State {
  ceilFt: number;
  palette: string[];
  selectedColor: string;
  tool: Tool;
  surfaces: Surface[];
  tiles: Record<string, Map<string, string>>;
  viewMode: ViewMode;
  orbit: Orbit;
}

export function defaultSurfaces(ceilFt: number): Surface[] {
  const ceilIn = ceilFt * 12;
  return [
    { id: 'main',    group: 'Floors',  name: 'Main bath floor', widthIn: 130, heightIn: 78,    note: "plan \u00b7 10'10\" \u00d7 6'6\" (less shower)" },
    { id: 'ensuite', group: 'Floors',  name: 'En suite floor',  widthIn: 96,  heightIn: 69,    note: 'editable default \u00b7 ~46 ft\u00b2' },
    { id: 'shower',  group: 'Floors',  name: 'Shower floor',    widthIn: 40,  heightIn: 78,    note: "plan \u00b7 3'4\" \u00d7 6'6\"" },
    { id: 'ceiling', group: 'Ceiling', name: 'Main ceiling',    widthIn: 170, heightIn: 78,    note: "plan \u00b7 14'2\" \u00d7 6'6\"" },
    { id: 'wallN',   group: 'Walls',   name: 'North wall',      widthIn: 170, heightIn: ceilIn, note: "plan \u00b7 14'2\" \u00b7 vanity wall", heightLocked: true },
    { id: 'wallS',   group: 'Walls',   name: 'South wall',      widthIn: 170, heightIn: ceilIn, note: "plan \u00b7 14'2\" \u00b7 tub/toilet wall", heightLocked: true },
    { id: 'wallE',   group: 'Walls',   name: 'East wall',       widthIn: 78,  heightIn: ceilIn, note: "plan \u00b7 6'6\" \u00b7 door end", heightLocked: true },
    { id: 'wallW',   group: 'Walls',   name: 'West wall',       widthIn: 78,  heightIn: ceilIn, note: "plan \u00b7 6'6\" \u00b7 shower end", heightLocked: true },
  ];
}

export function initialState(): State {
  const ceilFt = 9;
  return {
    ceilFt,
    palette: [...DEFAULT_PALETTE],
    selectedColor: DEFAULT_PALETTE[4]!,
    tool: 'paint',
    surfaces: defaultSurfaces(ceilFt),
    tiles: {},
    viewMode: '2d',
    orbit: { rotX: -18, rotY: -28 },
  };
}

export function initTiles(
  surfaces: Surface[],
  prev?: Record<string, Map<string, string>>,
): Record<string, Map<string, string>> {
  const tiles: Record<string, Map<string, string>> = {};
  for (const s of surfaces) tiles[s.id] = prev?.[s.id] ?? new Map();
  return tiles;
}
