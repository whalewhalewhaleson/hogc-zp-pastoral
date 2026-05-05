-- Phase A migration: add occurred_at to updates
-- Run in Supabase SQL editor.
-- Display and timeline-sort use COALESCE(occurred_at, created_at).
-- created_at stays immutable for audit; occurred_at is the user-editable event date.

ALTER TABLE updates
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
