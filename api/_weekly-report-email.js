function normalizeSenderAddress(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return normalized.replaceAll("onpointgroups.com", "onpointgroupes.com");
}

function normalizeRecipientList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getWeeklyReportEmailConfig(env = process.env) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const configuredFromEmail =
    env.REPORTS_FROM_EMAIL ||
    env.PAYSLIP_FROM_EMAIL ||
    env.RESEND_FROM_EMAIL ||
    "";
  const fromEmail = normalizeSenderAddress(configuredFromEmail) || "onboarding@resend.dev";
  const replyTo = String(env.REPORTS_REPLY_TO || env.PAYSLIP_REPLY_TO || "").trim();

  return {
    apiKey,
    fromEmail,
    replyTo,
    configured: Boolean(apiKey && fromEmail)
  };
}

async function sendWeeklyReportEmail({
  to,
  subject,
  text,
  attachmentHtml,
  attachmentFilename
}, env = process.env) {
  const config = getWeeklyReportEmailConfig(env);
  if (!config.configured) {
    throw new Error("Weekly report email is not configured yet. Add RESEND_API_KEY and REPORTS_FROM_EMAIL in Vercel.");
  }

  const safeRecipients = normalizeRecipientList(to);
  if (!safeRecipients.length || !subject || !attachmentHtml || !attachmentFilename) {
    throw new Error("Missing weekly report email details.");
  }

  const resendPayload = {
    from: config.fromEmail,
    to: safeRecipients,
    subject: String(subject || "").trim(),
    html: [
      "<p>Hi team,</p>",
      "<p>Your OnPoint Express weekly report is attached to this email.</p>",
      "<p>Open the attachment in your browser to review, print, or save it.</p>",
      "<p>Regards,<br />OnPoint Express Reports</p>"
    ].join(""),
    text: String(text || "").trim() || "Your OnPoint Express weekly report is attached.",
    attachments: [
      {
        filename: String(attachmentFilename || "weekly-report.html").trim(),
        content: Buffer.from(String(attachmentHtml), "utf8").toString("base64")
      }
    ]
  };

  if (config.replyTo) {
    resendPayload.replyTo = config.replyTo;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(resendPayload)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || "Resend rejected the weekly report email.");
  }

  return {
    ok: true,
    id: payload?.id || null
  };
}

module.exports = {
  getWeeklyReportEmailConfig,
  normalizeRecipientList,
  normalizeSenderAddress,
  sendWeeklyReportEmail
};
