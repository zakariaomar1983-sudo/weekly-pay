const { requireStaff } = require("./_auth-server");

function bodyOf(req) { if (req.body && typeof req.body === "object") return req.body; try { return JSON.parse(String(req.body || "{}")); } catch { return {}; } }
function responseText(payload) { return String(payload?.output_text || payload?.output?.flatMap((item) => item.content || []).map((part) => part.text || "").join("\n") || "").trim(); }

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!requireStaff(req, res, "accessAI")) return;
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return res.status(503).json({ error: "AI is not configured. Add OPENAI_API_KEY in Vercel." });
  const body = bodyOf(req); const question = String(body.question || "").trim();
  if (!question) return res.status(400).json({ error: "A question is required." });
  const prompt = `You are the internal Onpoint Express CRM assistant. Answer only from the supplied CRM data. If data is missing, say so. Be concise and include names, dates, truck numbers, and amounts when relevant. CRM data JSON:\n${JSON.stringify(body.context || {}).slice(0, 120000)}\n\nQuestion: ${question}`;
  try { const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", input: prompt }) }); const payload = await response.json(); if (!response.ok) return res.status(502).json({ error: payload?.error?.message || "AI provider rejected the request." }); return res.status(200).json({ answer: responseText(payload) }); } catch (error) { return res.status(500).json({ error: String(error?.message || error) }); }
};
