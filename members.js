import Fuse from 'fuse.js';
import { fetchAllMembers } from './shared/supabase.js';

let _members = [];
let _fuse = null;
let _byId = new Map();

export async function loadMembers() {
  const rows = await fetchAllMembers(true);
  _members = rows.map((r) => ({
    memberId: r.id,
    name: r.name,
    role: r.role,
    leaderRole: r.leader_role,
  }));

  _byId = new Map(_members.map((m) => [m.memberId, m]));
  _fuse = new Fuse(_members, {
    keys: ['name'],
    threshold: 0.4,
    includeScore: true,
    minMatchCharLength: 2,
  });
  if (_members.length === 0) {
    console.warn('[members] 0 active members loaded — check the members table in Supabase.');
  }
  return _members;
}

export async function reloadMembers() {
  return loadMembers();
}

function ensureLoaded() {
  if (!_fuse) {
    throw new Error('members not loaded — call loadMembers() at boot.');
  }
}

// Fuzzy match by name. Returns up to `limit` candidates sorted by score.
export function searchMembers(query, limit = 8) {
  ensureLoaded();
  const q = String(query ?? '').trim();
  if (!q) return [];
  return _fuse.search(q, { limit }).map((r) => r.item);
}

export function getMember(memberId) {
  return _byId.get(String(memberId));
}

export function getAllMembers() {
  ensureLoaded();
  return [..._members];
}

// Display label with role suffix for disambiguation, e.g. "Mandy (NF)".
export function memberLabel(m) {
  return `${m.name} (${m.role})`;
}
