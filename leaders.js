import { readRows } from './sheets.js';

let _cache = { byId: new Map(), loadedAt: 0 };

function truthy(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1';
}

export async function loadLeaders() {
  const { rows } = await readRows('_leaders');
  const byId = new Map();
  for (const r of rows) {
    const tgId = Number(r.tg_id);
    if (!Number.isFinite(tgId) || tgId === 0) continue;
    if (!truthy(r.active)) continue;
    byId.set(tgId, { tgId, name: String(r.name ?? '').trim() });
  }
  _cache = { byId, loadedAt: Date.now() };
  return _cache;
}

export async function isLeader(tgId) {
  if (_cache.byId.size === 0) await loadLeaders();
  return _cache.byId.has(Number(tgId));
}

export async function getLeaderName(tgId) {
  if (_cache.byId.size === 0) await loadLeaders();
  const entry = _cache.byId.get(Number(tgId));
  return entry?.name ?? '';
}

export async function reloadLeaders() {
  return loadLeaders();
}
