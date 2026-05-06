import { NextRequest, NextResponse } from "next/server";
import { verifyInitData, readInitDataHeader } from "@/lib/miniapp-auth";
import { getLeader } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const initData = readInitDataHeader(req);
  if (!initData) {
    return NextResponse.json({ error: "Missing auth header" }, { status: 401 });
  }

  const verified = verifyInitData(initData);
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const leader = await getLeader(verified.user.id);
  if (!leader) {
    return NextResponse.json({ error: "Not on the leaders list" }, { status: 403 });
  }

  return NextResponse.json({ name: leader.name, tgId: leader.tg_id });
}
