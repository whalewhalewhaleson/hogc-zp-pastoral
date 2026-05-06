import { NextRequest, NextResponse } from "next/server";
import { verifyTelegramLogin, isActiveLeader, createSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const data = await req.json();

  if (!verifyTelegramLogin(data)) {
    return NextResponse.json({ error: "Invalid login" }, { status: 401 });
  }

  const tgId = Number(data.id);
  if (!(await isActiveLeader(tgId))) {
    return NextResponse.json(
      { error: "You're not on the leaders list. Contact Wilson to get access." },
      { status: 403 },
    );
  }

  await createSession(tgId, data.first_name);
  return NextResponse.json({ ok: true });
}
