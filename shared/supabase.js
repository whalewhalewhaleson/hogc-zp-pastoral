import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY env vars are required.');
}

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

// --- Updates (pastoral notes) ---

export async function insertUpdate(data) {
  const { error } = await supabase.from('updates').insert(data);
  if (error) throw new Error(`insertUpdate: ${error.message}`);
}

export async function getUpdate(updateId) {
  const { data, error } = await supabase
    .from('updates')
    .select('*')
    .eq('id', updateId)
    .single();
  if (error && error.code !== 'PGRST116') throw new Error(`getUpdate: ${error.message}`);
  return data ?? null;
}

export async function patchUpdate(updateId, fields) {
  const { error } = await supabase
    .from('updates')
    .update(fields)
    .eq('id', updateId);
  if (error) throw new Error(`patchUpdate: ${error.message}`);
}

export async function softDeleteUpdate(updateId, deletedAt) {
  return patchUpdate(updateId, { deleted_at: deletedAt });
}

export async function getUpdatesByMember(memberId, limit = 20) {
  const { data, error } = await supabase
    .from('updates')
    .select('*')
    .eq('member_id', memberId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getUpdatesByMember: ${error.message}`);
  return data;
}

export async function getRecentUpdatesByAuthor(authorTgId, limit = 20) {
  const { data, error } = await supabase
    .from('updates')
    .select('*')
    .eq('author_tg_id', authorTgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getRecentUpdatesByAuthor: ${error.message}`);
  return data;
}

export async function countUpdatesByMember() {
  const { data, error } = await supabase
    .from('updates')
    .select('member_id')
    .is('deleted_at', null);
  if (error) throw new Error(`countUpdatesByMember: ${error.message}`);
  const counts = {};
  for (const row of data) {
    counts[row.member_id] = (counts[row.member_id] ?? 0) + 1;
  }
  return counts;
}

export async function getLatestUpdatePerMember(limit = 10) {
  const { data, error } = await supabase
    .from('updates')
    .select('member_id, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`getLatestUpdatePerMember: ${error.message}`);
  const seen = new Map();
  for (const row of data) {
    if (!seen.has(row.member_id)) {
      seen.set(row.member_id, row.created_at);
      if (seen.size >= limit) break;
    }
  }
  return [...seen.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([memberId]) => memberId);
}

// --- Members ---

export async function fetchAllMembers(activeOnly = true) {
  let query = supabase.from('members').select('*');
  if (activeOnly) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) throw new Error(`fetchAllMembers: ${error.message}`);
  return data;
}

// --- Leaders ---

export async function fetchActiveLeaders() {
  const { data, error } = await supabase
    .from('leaders')
    .select('*')
    .eq('active', true);
  if (error) throw new Error(`fetchActiveLeaders: ${error.message}`);
  return data;
}
