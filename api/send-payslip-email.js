module.exports = async function handler(req, res) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.PAYSLIP_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || "";
  const replyTo = process.env.PAYSLIP_REPLY_TO || "";

  if (req.method === "GET") {
    return res.status(200).json({
      configured: Boolean(apiKey && fromEmail)
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!apiKey || !fromEmail) {
    return res.status(500).json({
      error: "Payslip email is not configured yet. Add RESEND_API_KEY and PAYSLIP_FROM_EMAIL in Vercel."
    });
  }

  const {
    to,
    driver,
    subject,
    text,
    attachmentHtml,
    attachmentFilename
  } = req.body || {};

  if (!to || !subject || !attachmentHtml || !attachmentFilename) {
    return res.status(400).json({ error: "Missing payslip email details." });
  }

  const safeTo = String(to).trim();
  const safeSubject = String(subject).trim();
  const safeText = String(text || "").trim();
  const safeFilename = String(attachmentFilename || "payslip.html").trim();
  const attachmentContent = Buffer.from(String(attachmentHtml), "utf8").toString("base64");

  const emailHtml = [
    `<p>Hi ${escapeHtml(driver || "team")},</p>`,
    "<p>Your OnPoint Express payslip is attached to this email.</p>",
    "<p>Open the attachment in your browser to view, print, or save it.</p>",
    "<p>Regards,<br />OnPoint Express</p>"
  ].join("");

  const resendPayload = {
    from: fromEmail,
    to: [safeTo],
    subject: safeSubject,
    html: emailHtml,
    text: safeText || `Your OnPoint Express payslip is attached.`,
    attachments: [
      {
        filename: safeFilename,
        content: attachmentContent
      }
    ]
  };

  if (replyTo) {
    resendPayload.replyTo = replyTo;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(resendPayload)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.message || payload?.error || "Resend rejected the payslip email.";
      return res.status(response.status).json({ error: message });
    }

    return res.status(200).json({ ok: true, id: payload?.id || null });
  } catch (error) {
    return res.status(500).json({
      error: String(error?.message || error || "Unexpected email send error.")
    });
  }
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
