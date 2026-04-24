import { fetchActiveLeaders } from './shared/supabase.js';

let _cache = { byId: new Map(), loadedAt: 0 };

export async function loadLeaders() {
  const rows = await fetchActiveLeaders();
  const byId = new Map();
  for (const r of rows) {
    byId.set(Number(r.tg_id), { tgId: Number(r.tg_id), name: r.name });
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
