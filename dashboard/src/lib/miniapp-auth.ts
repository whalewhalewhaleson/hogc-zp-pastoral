import crypto from "crypto";

// Telegram Mini App initData verification.
// Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//   secret_key  = HMAC_SHA256(key="WebAppData", message=bot_token)
//   data_check  = sorted "key=value" lines (all fields except `hash`), joined by \n
//   expected    = HMAC_SHA256(key=secret_key, message=data_check)
//   valid iff   expected === initData.hash

const BOT_TOKEN = process.env.BOT_TOKEN!;
const MAX_AGE_SECONDS = 24 * 60 * 60;

export interface InitDataUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface VerifiedInitData {
  user: InitDataUser;
  authDate: number;
}

export function verifyInitData(initData: string): VerifiedInitData | null {
  if (!initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheck = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const expected = crypto.createHmac("sha256", secretKey).update(dataCheck).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const hashBuf = Buffer.from(hash, "hex");
  if (expectedBuf.length !== hashBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, hashBuf)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate) return null;
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > MAX_AGE_SECONDS) return null;

  const userJson = params.get("user");
  if (!userJson) return null;

  let user: InitDataUser;
  try {
    user = JSON.parse(userJson);
  } catch {
    return null;
  }

  return { user, authDate };
}

export function readInitDataHeader(req: Request): string | null {
  // Convention: client sends `Authorization: tma <initDataRaw>`
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("tma ")) return null;
  return auth.slice(4);
}
