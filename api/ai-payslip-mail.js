const { requireStaff } = require("./_auth-server");

function responseText(payload) { return String(payload?.output_text || payload?.output?.flatMap((item) => item.content || []).map((part) => part.text || "").join("\n") || "").trim(); }
function oauthClient() {
  const raw = String(process.env.GOOGLE_OAUTH_CLIENT_JSON || "").trim();
  if (!raw) throw new Error("Google OAuth is not configured.");
  try {
    const parsed = JSON.parse(raw);
    return parsed.installed || parsed.web || parsed;
  } catch { throw new Error("GOOGLE_OAUTH_CLIENT_JSON is not valid JSON."); }
}

async function googleToken() {
  const client = oauthClient(); const refreshToken = String(process.env.GOOGLE_OAUTH_REFRESH_TOKEN || "").trim();
  if (!refreshToken) throw new Error("Google OAuth refresh token is not configured.");
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, refresh_token: refreshToken, grant_type: "refresh_token" }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error_description || "Google authentication failed."); return data.access_token;
}

async function gmailGet(path, token) {
  const mailbox = encodeURIComponent(process.env.GOOGLE_MAILBOX || "admin@onpointgroupes.com");
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${mailbox}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || "Gmail API request failed."); return data;
}
function decodeBase64Url(value) { return Buffer.from(String(value || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); }
function normalizeBase64(value) { return Buffer.from(String(value || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("base64"); }
async function collectParts(part, messageId, token, output = []) {
  if (!part) return output;
  let data = part.body?.data || "";
  if (!data && part.body?.attachmentId) {
    const attachment = await gmailGet(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`, token);
    data = attachment.data || "";
  }
  if (data) output.push({ filename: part.filename || "", mimeType: part.mimeType || "", data, text: /^text\//i.test(part.mimeType || "") ? decodeBase64Url(data) : "" });
  for (const child of part.parts || []) await collectParts(child, messageId, token, output);
  return output;
}
function parseJson(text) { try { return JSON.parse(text); } catch { const match = String(text).match(/\{[\s\S]*\}/); return match ? JSON.parse(match[0]) : null; } }

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  if (!requireStaff(req, res, "accessAI")) return;
  if (!process.env.OPENAI_API_KEY || !process.env.GOOGLE_OAUTH_CLIENT_JSON || !process.env.GOOGLE_OAUTH_REFRESH_TOKEN || !process.env.GOOGLE_MAILBOX) return res.status(503).json({ error: "Google AI import is not configured. Add GOOGLE_OAUTH_CLIENT_JSON, GOOGLE_OAUTH_REFRESH_TOKEN, GOOGLE_MAILBOX, and OPENAI_API_KEY in Vercel." });
  try {
    const token = await googleToken(); const list = await gmailGet("/messages?q=has%3Aattachment%20newer_than%3A30d&maxResults=20", token); const items = [];
    for (const summary of list.messages || []) {
      const message = await gmailGet(`/messages/${encodeURIComponent(summary.id)}?format=full`, token); const parts = await collectParts(message.payload, summary.id, token);
      const subject = (message.payload?.headers || []).find((h) => h.name.toLowerCase() === "subject")?.value || ""; const source = `Subject: ${subject}\nReceived: ${message.internalDate || ""}\n${parts.map((part) => `[${part.filename || part.mimeType}]\n${part.text}`).join("\n")}`.slice(0, 120000);
      const prompt = `Extract a driver payslip from this Gmail message and its attachments. Inspect the full daily records table, not only the earnings summary. Use the daily rate or daily subtotal shown for the driver's ordinary work when calculating dailyRate. Identify night-run rows, drops, or night-run fees from the service codes, docket details, additional details, and daily records; calculate nightRunDrops and nightRunPay when the document provides enough information. Company rule from the supplied payslip: a row with docket/service pattern SRV4008 and service code CP, such as Derrimut to Epping for $181.40, is a night run and its fee counts toward nightRunPay. Do not confuse total job earnings, fuel allowance, GST, or invoice total with the daily rate or night-run pay. Return JSON only with keys: driver, truckNumber, payPeriod, daysWorked, dailyRate, nightRunDrops, nightRunPay, driverBonus, deductions, paymentDate, netPay, confidence. Use numbers for numeric fields and null when unknown. Do not invent values. Email text:\n${source}`;
      const content = [{ type: "input_text", text: prompt }, ...parts.filter((part) => /^application\/pdf$/i.test(part.mimeType || "") && part.data).map((part) => ({ type: "input_file", filename: part.filename || "payslip.pdf", file_data: `data:${part.mimeType};base64,${normalizeBase64(part.data)}` }))];
      const ai = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", input: [{ role: "user", content }] }) });
      const payload = await ai.json(); if (!ai.ok) throw new Error(payload?.error?.message || "AI extraction failed."); const extracted = parseJson(responseText(payload)); if (extracted?.driver) items.push({ ...extracted, sourceMessageId: summary.id });
    }
    return res.status(200).json({ items });
  } catch (error) { return res.status(502).json({ error: String(error?.message || error) }); }
};
