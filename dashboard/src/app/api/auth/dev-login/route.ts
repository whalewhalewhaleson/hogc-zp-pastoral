import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";

export async function POST() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not available" }, { status: 403 });
  }

  await createSession(806982232, "Wilson");
  return NextResponse.json({ ok: true });
}
