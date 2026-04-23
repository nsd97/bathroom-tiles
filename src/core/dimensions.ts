export function parseDim(raw: unknown): number {
  if (raw == null) return NaN;
  const s = String(raw).trim().toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
  if (!s) return NaN;
  const m1 = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(\d+(?:\.\d+)?)?\s*(?:"|in|inch|inches)?$/);
  if (m1) {
    const ft = parseFloat(m1[1]!);
    const inch = m1[2] ? parseFloat(m1[2]) : 0;
    return ft * 12 + inch;
  }
  const m2 = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?$/);
  if (m2) return parseFloat(m2[1]!);
  return NaN;
}

export function formatDim(inches: number | null | undefined): string {
  if (inches == null || !Number.isFinite(inches)) return '';
  const total = Math.round(inches * 100) / 100;
  const ft = Math.floor(total / 12);
  const inRem = Math.round((total - ft * 12) * 100) / 100;
  if (ft === 0) return `${inRem}"`;
  if (inRem === 0) return `${ft}'`;
  return `${ft}'${inRem}"`;
}
