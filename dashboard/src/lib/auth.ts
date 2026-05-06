import { cookies } from "next/headers";
import crypto from "crypto";
import { supabase } from "./supabase";

const BOT_TOKEN = process.env.BOT_TOKEN!;

interface TelegramLoginData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export function verifyTelegramLogin(data: TelegramLoginData): boolean {
  const { hash, ...rest } = data;
  const checkString = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k as keyof typeof rest]}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(BOT_TOKEN).digest();
  const hmac = crypto
    .createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  if (hmac !== hash) return false;

  // Reject logins older than 1 hour
  const now = Math.floor(Date.now() / 1000);
  if (now - data.auth_date > 3600) return false;

  return true;
}

export async function isActiveLeader(tgId: number): Promise<boolean> {
  const { data } = await supabase
    .from("leaders")
    .select("tg_id")
    .eq("tg_id", tgId)
    .eq("active", true)
    .single();
  return !!data;
}

export async function getLeader(tgId: number) {
  const { data } = await supabase
    .from("leaders")
    .select("*")
    .eq("tg_id", tgId)
    .eq("active", true)
    .single();
  return data;
}

const SESSION_COOKIE = "zp_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function createSession(tgId: number, name: string) {
  const payload = JSON.stringify({ tgId, name, ts: Date.now() });
  const secret = crypto.createHash("sha256").update(BOT_TOKEN + "session").digest();
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const token = Buffer.from(payload).toString("base64url") + "." + sig;

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
}

export async function getSession(): Promise<{ tgId: number; name: string } | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;

  const payload = Buffer.from(payloadB64, "base64url").toString();
  const secret = crypto.createHash("sha256").update(BOT_TOKEN + "session").digest();
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  if (sig !== expected) return null;

  try {
    const { tgId, name } = JSON.parse(payload);
    return { tgId, name };
  } catch {
    return null;
  }
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
