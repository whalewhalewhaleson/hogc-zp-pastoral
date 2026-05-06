import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { label, date, type } = await req.json();
  if (!label || !date) {
    return NextResponse.json({ error: "Label and date required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("sessions")
    .insert({ label, date, type: type || "regular" })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}
