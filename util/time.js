// SGT = UTC+8 year-round (no DST)

export function nowSGT() {
  return new Date();
}

export function toSGTIso(date = new Date()) {
  const sgt = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return sgt.toISOString().replace('Z', '+08:00');
}

export function formatSGTDate(iso) {
  if (!iso) return '';
  return iso.slice(0, 10);
}

export function hoursSince(iso) {
  if (!iso) return Infinity;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return Infinity;
  return (Date.now() - then) / 3_600_000;
}
