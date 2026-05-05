-- Phase B migration: outings + outing_participants
-- Run in Supabase SQL editor after add-occurred-at.sql.

CREATE TABLE IF NOT EXISTS outings (
  id           text        primary key,
  title        text,
  note         text        not null,
  occurred_at  timestamptz,
  author_tg_id bigint      not null,
  author_name  text,
  created_at   timestamptz default now(),
  edited_at    timestamptz,
  deleted_at   timestamptz
);

CREATE TABLE IF NOT EXISTS outing_participants (
  outing_id  text references outings(id)  on delete cascade,
  member_id  uuid references members(id)  on delete cascade,
  primary key (outing_id, member_id)
);

CREATE INDEX IF NOT EXISTS outing_participants_member_id_idx
  ON outing_participants(member_id);
