import Fuse from 'fuse.js';
import { readRows } from './sheets.js';

const ACTIVE_ROLES = new Set(['R', 'I', 'G', 'NF']);

let _members = [];
let _fuse = null;
let _byId = new Map();

export async function loadMembers() {
  const { rows } = await readRows('Members!A2:ZZ');
  const namedRows = rows.filter((r) => String(r.NAME ?? r.name ?? '').trim() !== '');

  let fallbackCount = 0;
  _members = namedRows
    .filter((r) => ACTIVE_ROLES.has(String(r.ROLE ?? r.role ?? '').trim().toUpperCase()))
    .map((r) => {
      const name = String(r.NAME ?? r.name ?? '').trim();
      const rawId = String(r.members_id ?? r.member_id ?? '').trim();
      let memberId = rawId;
      if (!memberId) {
        memberId = `name:${name.toLowerCase().replace(/\s+/g, '_')}`;
        fallbackCount++;
      }
      return { memberId, name, role: String(r.ROLE ?? r.role ?? '').trim().toUpperCase() };
    });

  _byId = new Map(_members.map((m) => [m.memberId, m]));
  _fuse = new Fuse(_members, {
    keys: ['name'],
    threshold: 0.4,
    includeScore: true,
    minMatchCharLength: 2,
  });
  if (_members.length === 0) {
    console.warn('[members] 0 active members loaded — check that the Members sheet has data and roles are in ACTIVE_ROLES.');
  } else if (fallbackCount > 0) {
    console.warn(`[members] ${fallbackCount}/${_members.length} members using fallback IDs. Run the Apps Script in the Members sheet to generate members_id values, then /reload.`);
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
