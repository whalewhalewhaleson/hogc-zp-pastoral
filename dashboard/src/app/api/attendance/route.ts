import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { session_id, records } = await req.json();
  if (!session_id || !Array.isArray(records)) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const rows = records.map((r: { member_id: string; status: string; adjusted: boolean; adjusted_reason?: string }) => ({
    session_id,
    member_id: r.member_id,
    status: r.status,
    adjusted: r.adjusted,
    adjusted_reason: r.adjusted_reason || null,
    marked_by_tg_id: session.tgId,
  }));

  const { error } = await supabase
    .from("attendance")
    .upsert(rows, { onConflict: "session_id,member_id" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
