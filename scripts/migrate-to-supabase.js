import 'dotenv/config';
import { readRows } from '../sheets.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

// --- Members ---

async function migrateMembers() {
  const { rows } = await readRows('Members!A2:ZZ');
  const named = rows.filter((r) => String(r.NAME ?? r.name ?? '').trim());

  const LEADER_ROLES = new Set(['PTL', 'SCGL', 'PCGL', 'POTL']);
  const INACTIVE_ROLES = new Set(['KIV', 'LEFT', 'INACTIVE']);
  const VALID_ROLES = new Set(['R', 'I', 'G', 'GI', 'NF']);

  const toInsert = named.map((r) => {
    const rawRole = String(r.ROLE ?? r.role ?? '').trim().toUpperCase();
    let role = rawRole;
    let leaderRole = null;

    if (LEADER_ROLES.has(rawRole)) {
      leaderRole = rawRole;
      role = 'R';
    } else if (!VALID_ROLES.has(rawRole) && !INACTIVE_ROLES.has(rawRole)) {
      role = 'R';
    }

    return {
      name: String(r.NAME ?? r.name ?? '').trim(),
      role,
      leader_role: leaderRole,
      active: !INACTIVE_ROLES.has(rawRole),
    };
  });

  console.log(`Inserting ${toInsert.length} members...`);
  const { data, error } = await supabase.from('members').insert(toInsert).select('id, name, role');
  if (error) throw new Error(`Members insert failed: ${error.message}`);
  console.log(`Inserted ${data.length} members.`);

  // Build mapping: name+role → uuid (for linking updates)
  const memberMap = new Map();
  for (const m of data) {
    memberMap.set(`${m.name}::${m.role}`, m.id);
  }

  // Also build old members_id → uuid mapping
  const oldIdMap = new Map();
  for (let i = 0; i < named.length; i++) {
    const r = named[i];
    const oldId = String(r.members_id ?? r.member_id ?? '').trim();
    const name = String(r.NAME ?? r.name ?? '').trim();
    const role = String(r.ROLE ?? r.role ?? '').trim().toUpperCase();
    const uuid = memberMap.get(`${name}::${role}`);
    if (oldId && uuid) {
      oldIdMap.set(oldId, uuid);
    }
    // Also map fallback IDs the bot currently generates
    const fallbackId = `name:${name.toLowerCase().replace(/\s+/g, '_')}`;
    if (uuid) {
      oldIdMap.set(fallbackId, uuid);
    }
  }

  console.log(`ID mapping: ${oldIdMap.size} old IDs → UUIDs`);
  return oldIdMap;
}

// --- Pastoral Notes ---

async function migrateUpdates(oldIdMap) {
  let rows;
  try {
    ({ rows } = await readRows('_updates'));
  } catch {
    console.log('No _updates sheet found — skipping pastoral notes migration.');
    return;
  }

  if (rows.length === 0) {
    console.log('_updates sheet is empty — skipping.');
    return;
  }

  const toInsert = [];
  let skipped = 0;

  for (const r of rows) {
    const id = String(r.id ?? '').trim();
    const oldMemberId = String(r.member_id ?? '').trim();
    const newMemberId = oldIdMap.get(oldMemberId);

    if (!id || !newMemberId) {
      skipped++;
      continue;
    }

    toInsert.push({
      id,
      member_id: newMemberId,
      author_tg_id: Number(r.author_tg_id) || 0,
      author_name: String(r.author_name ?? '').trim(),
      title: String(r.title ?? '').trim() || null,
      note: String(r.note ?? '').trim(),
      created_at: r.created_at || new Date().toISOString(),
      edited_at: r.edited_at || null,
      deleted_at: r.deleted_at || null,
    });
  }

  if (toInsert.length === 0) {
    console.log(`No valid updates to migrate (${skipped} skipped).`);
    return;
  }

  console.log(`Inserting ${toInsert.length} pastoral notes (${skipped} skipped)...`);
  const { error } = await supabase.from('updates').insert(toInsert);
  if (error) throw new Error(`Updates insert failed: ${error.message}`);
  console.log(`Inserted ${toInsert.length} pastoral notes.`);
}

// --- Run ---

try {
  const oldIdMap = await migrateMembers();
  await migrateUpdates(oldIdMap);
  console.log('\nMigration complete!');
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exit(1);
}
