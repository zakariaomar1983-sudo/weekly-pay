const { requireStaff } = require("./_auth-server");

function bodyOf(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(String(req.body || "{}")); } catch { return {}; }
}

function responseText(payload) {
  return String(payload?.output_text || payload?.output?.flatMap((item) => item.content || []).map((part) => part.text || "").join("\n") || "").trim();
}

function parseJson(text) {
  const cleaned = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The AI returned an unreadable receipt draft.");
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { throw new Error("The AI returned an unreadable receipt draft."); }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!requireStaff(req, res, "accessAI")) return;
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return res.status(503).json({ error: "AI is not configured. Add OPENAI_API_KEY in Vercel." });

  const body = bodyOf(req);
  const receiptText = String(body.receiptText || "").trim();
  const receiptImage = String(body.receiptImage || "").trim();
  if (!receiptText && !receiptImage) return res.status(400).json({ error: "Paste receipt text or an image first." });
  if (receiptText.length > 20000) return res.status(413).json({ error: "Receipt text is too long. Paste one receipt at a time." });
  if (receiptImage && (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=_-]+$/.test(receiptImage) || receiptImage.length > 8000000)) return res.status(413).json({ error: "The receipt image is invalid or too large. Use one image under 6 MB." });

  const prompt = `Extract one vehicle expense from this pasted receipt for the internal Onpoint Express CRM.
Return JSON only with exactly these keys: date (YYYY-MM-DD or empty), truckNumber (string or empty), category (normally Fuel for diesel/petrol/fuel), amount (number or 0), vendor (string or empty), notes (short string), confidence (number from 0 to 1).
Do not invent missing values. The amount must be the receipt total, not a unit price, tax, or subtotal unless that is the only amount present. If the receipt says diesel, fuel, petrol, Ampol, Shell, BP, or Caltex, use category Fuel.

${receiptText ? `Receipt text:\n${receiptText}` : "The receipt is supplied as an image. Read the visible receipt details."}`;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", input: receiptImage ? [{ role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: receiptImage }] }] : prompt })
    });
    const payload = await response.json();
    if (!response.ok) return res.status(502).json({ error: payload?.error?.message || "AI provider rejected the request." });

    const item = parseJson(responseText(payload));
    const lower = `${receiptText} ${item.vendor || ""} ${item.category || ""}`.toLowerCase();
    const category = /diesel|fuel|petrol|ampol|shell|\bbp\b|caltex/.test(lower) ? "Fuel" : String(item.category || "Expense").trim();
    const amount = Number(item.amount);
    const confidence = Number(item.confidence);
    return res.status(200).json({ item: {
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || "")) ? String(item.date) : "",
      truckNumber: String(item.truckNumber || "").trim(),
      category,
      amount: Number.isFinite(amount) && amount >= 0 ? Number(amount.toFixed(2)) : 0,
      vendor: String(item.vendor || "").trim(),
      notes: String(item.notes || "").trim(),
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, Number(confidence.toFixed(2)))) : 0
    }});
  } catch (error) {
    return res.status(500).json({ error: String(error?.message || error) });
  }
};
