/**
 * Outbound email via Resend (https://resend.com).
 *
 * Plain fetch against the REST API — no SDK dependency. Configure with:
 *   RESEND_API_KEY  – API key (required to actually send)
 *   EMAIL_FROM      – sender, e.g. 'Concordia <no-reply@concordiachat.com>'
 *
 * Without RESEND_API_KEY (local dev), emails are logged to stdout instead of
 * sent, so auth flows remain testable end-to-end.
 */
const FROM = process.env.EMAIL_FROM || 'Concordia <no-reply@concordiachat.com>';

async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn(`[mailer] RESEND_API_KEY not set — email to ${to} not sent.`);
    console.warn(`[mailer]   subject: ${subject}`);
    console.warn(`[mailer]   text: ${text}`);
    return { sent: false };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }

  return { sent: true };
}

module.exports = { sendEmail };
