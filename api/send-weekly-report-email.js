const { getWeeklyReportEmailConfig, sendWeeklyReportEmail } = require("./_weekly-report-email");

module.exports = async function handler(req, res) {
  const config = getWeeklyReportEmailConfig(process.env);

  if (req.method === "GET") {
    return res.status(200).json({
      configured: config.configured
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!config.configured) {
    return res.status(500).json({
      error: "Weekly report email is not configured yet. Add RESEND_API_KEY and REPORTS_FROM_EMAIL in Vercel."
    });
  }

  const {
    to,
    subject,
    text,
    attachmentHtml,
    attachmentFilename
  } = req.body || {};

  if (!to || !subject || !attachmentHtml || !attachmentFilename) {
    return res.status(400).json({ error: "Missing weekly report email details." });
  }

  try {
    const result = await sendWeeklyReportEmail({
      to,
      subject,
      text,
      attachmentHtml,
      attachmentFilename
    }, process.env);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      error: String(error?.message || error || "Unexpected email send error.")
    });
  }
};
