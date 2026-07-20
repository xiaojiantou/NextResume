// Transactional email via MailerSend.
//
// Fails safe: if MAILERSEND_API_KEY isn't set, this logs a warning and no-ops
// so the checkout flow still succeeds. Wire the key when you're ready.
//
// Env vars:
//   MAILERSEND_API_KEY   — starts with "mlsn."
//   EMAIL_FROM_EMAIL     — e.g. "hello@yourdomain.com" (must be from a verified domain,
//                          OR a *.mlsender.net trial subdomain MailerSend assigns you)
//   EMAIL_FROM_NAME      — display name, defaults to "NextResume"
//   NEXT_PUBLIC_APP_URL  — used in the CTA link back into the app

const API_KEY = process.env.MAILERSEND_API_KEY;
const FROM_EMAIL = process.env.EMAIL_FROM_EMAIL || "";
const FROM_NAME = process.env.EMAIL_FROM_NAME || "NextResume";
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://nextresume-lovat.vercel.app";

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; reason: string };

export async function sendOrderReadyEmail({
  to,
  name,
  orderId,
}: {
  to: string;
  name?: string;
  orderId: string;
}): Promise<SendResult> {
  if (!API_KEY) {
    console.warn(
      "[email] MAILERSEND_API_KEY not set — skipping order-ready email to",
      to,
    );
    return { ok: false, reason: "email_disabled" };
  }
  if (!FROM_EMAIL) {
    console.warn(
      "[email] EMAIL_FROM_EMAIL not set — skipping order-ready email to",
      to,
    );
    return { ok: false, reason: "email_from_missing" };
  }

  const resultUrl = `${APP_URL}/result`;
  const displayName = (name || "").split(/[\s@]/)[0] || "there";

  const body = {
    from: { email: FROM_EMAIL, name: FROM_NAME },
    to: [{ email: to, name: name || undefined }],
    subject: "Your optimized resume is ready",
    html: renderHtml({ displayName, resultUrl, orderId }),
    text: renderText({ displayName, resultUrl, orderId }),
  };

  try {
    const res = await fetch("https://api.mailersend.com/v1/email", {
      method: "POST",
      headers: {
        authorization: `Bearer ${API_KEY}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(
        "[email] mailersend error",
        res.status,
        errText.slice(0, 500),
      );
      return { ok: false, reason: `mailersend_${res.status}` };
    }
    const id = res.headers.get("x-message-id") || "";
    return { ok: true, id };
  } catch (e) {
    console.error("[email] send failed", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "unknown_error",
    };
  }
}

function renderText({
  displayName,
  resultUrl,
  orderId,
}: {
  displayName: string;
  resultUrl: string;
  orderId: string;
}) {
  return [
    `Hey ${displayName},`,
    "",
    "Your optimized resume is ready. Every bullet was rewritten and cited back to your real experience — no fabrication.",
    "",
    `Open it here: ${resultUrl}`,
    "",
    "You can download it as PDF, try a different model, or regenerate a variation.",
    "",
    `Order: ${orderId}`,
    "— NextResume",
  ].join("\n");
}

function renderHtml({
  displayName,
  resultUrl,
  orderId,
}: {
  displayName: string;
  resultUrl: string;
  orderId: string;
}) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Your optimized resume is ready</title>
</head>
<body style="margin:0;padding:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #ececef;border-radius:14px;padding:32px;">
        <tr><td>
          <div style="font-size:18px;font-weight:600;letter-spacing:-0.2px;">NextResume</div>
        </td></tr>
        <tr><td style="padding-top:24px;">
          <h1 style="font-size:24px;line-height:1.2;letter-spacing:-0.4px;margin:0 0 12px 0;color:#18181b;">Your optimized resume is ready.</h1>
          <p style="font-size:15px;line-height:1.55;color:#52525b;margin:0 0 20px 0;">
            Hey ${escapeHtml(displayName)}, thanks for your purchase. Every bullet was rewritten and cited back to your real experience — no fabrication.
          </p>
          <a href="${resultUrl}"
             style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:12px 20px;border-radius:10px;">
            Open my resume →
          </a>
          <p style="font-size:13px;color:#71717a;margin:24px 0 0 0;line-height:1.6;">
            Inside you can download PDF, try a different model, or generate a new variation.
          </p>
        </td></tr>
        <tr><td style="padding-top:28px;border-top:1px solid #ececef;margin-top:24px;">
          <p style="font-size:12px;color:#a1a1aa;margin:20px 0 0 0;">
            Order <span style="font-family:ui-monospace,Menlo,monospace;color:#71717a;">${escapeHtml(orderId)}</span>
          </p>
        </td></tr>
      </table>
      <p style="font-size:12px;color:#a1a1aa;margin:16px 0 0 0;">© NextResume · Built with privacy in mind</p>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
