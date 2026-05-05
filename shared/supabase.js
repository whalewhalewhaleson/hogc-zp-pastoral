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

// --- Outings ---

export async function insertOuting(data) {
  const { error } = await supabase.from('outings').insert(data);
  if (error) throw new Error(`insertOuting: ${error.message}`);
}

export async function getOuting(outingId) {
  const { data, error } = await supabase
    .from('outings')
    .select('*')
    .eq('id', outingId)
    .single();
  if (error && error.code !== 'PGRST116') throw new Error(`getOuting: ${error.message}`);
  return data ?? null;
}

export async function patchOuting(outingId, fields) {
  const { error } = await supabase.from('outings').update(fields).eq('id', outingId);
  if (error) throw new Error(`patchOuting: ${error.message}`);
}

export async function softDeleteOuting(outingId, deletedAt) {
  return patchOuting(outingId, { deleted_at: deletedAt });
}

export async function setOutingParticipants(outingId, memberIds) {
  const { error: delError } = await supabase
    .from('outing_participants')
    .delete()
    .eq('outing_id', outingId);
  if (delError) throw new Error(`setOutingParticipants delete: ${delError.message}`);
  if (!memberIds.length) return;
  const rows = memberIds.map((mid) => ({ outing_id: outingId, member_id: mid }));
  const { error } = await supabase.from('outing_participants').insert(rows);
  if (error) throw new Error(`setOutingParticipants insert: ${error.message}`);
}

export async function getOutingParticipants(outingId) {
  const { data, error } = await supabase
    .from('outing_participants')
    .select('member_id')
    .eq('outing_id', outingId);
  if (error) throw new Error(`getOutingParticipants: ${error.message}`);
  return data.map((p) => p.member_id);
}

export async function getOutingsByMember(memberId, limit = 20) {
  const { data: parts, error: e1 } = await supabase
    .from('outing_participants')
    .select('outing_id')
    .eq('member_id', memberId);
  if (e1) throw new Error(`getOutingsByMember: ${e1.message}`);
  if (!parts?.length) return [];
  const ids = parts.map((p) => p.outing_id);
  const { data, error } = await supabase
    .from('outings')
    .select('*')
    .in('id', ids)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getOutingsByMember: ${error.message}`);
  return data;
}

export async function getRecentOutingsByAuthor(authorTgId, limit = 20) {
  const { data, error } = await supabase
    .from('outings')
    .select('*')
    .eq('author_tg_id', authorTgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getRecentOutingsByAuthor: ${error.message}`);
  return data;
}

export async function getRecentOutings(limit = 20) {
  const { data, error } = await supabase
    .from('outings')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getRecentOutings: ${error.message}`);
  return data;
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
