// HMAC-signed order access tokens. Used in the "your resume is ready" email
// so clicking the link on any device grants access to the buyer's snapshot.
//
// Format: base64url(HMAC-SHA256(secret, orderId))
// Verification is a constant-time string compare — no DB roundtrip.
//
// Tokens never expire in this implementation. If you want expiry:
// include a timestamp in the signed payload and check it on verify.

import crypto from "crypto";

function getSecret(): string {
  return (
    process.env.NEXTRESUME_TOKEN_SECRET ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    ""
  );
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function signOrderToken(orderId: string): string {
  const secret = getSecret();
  if (!secret) {
    throw new Error(
      "Missing NEXTRESUME_TOKEN_SECRET (or STRIPE_WEBHOOK_SECRET fallback).",
    );
  }
  const mac = crypto.createHmac("sha256", secret).update(orderId).digest();
  return b64url(mac);
}

export function verifyOrderToken(orderId: string, token: string): boolean {
  if (!orderId || !token) return false;
  try {
    const expected = signOrderToken(orderId);
    const a = Buffer.from(expected);
    const b = Buffer.from(token);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
