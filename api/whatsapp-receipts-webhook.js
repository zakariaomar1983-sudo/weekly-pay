const { getSupabaseServerClient, getSupabaseServerConfig } = require("./_supabase-server");
const { randomUUID } = require("crypto");

const RECEIPT_LOG_TYPE = "WhatsApp Receipt";

function parseBody(req) {
  if (!req?.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function normalizeNumber(value) {
  if (value == null || value === "") return 0;
  const normalized = Number(String(value).replaceAll(",", "").replace("$", ""));
  return Number.isFinite(normalized) ? normalized : 0;
}

function normalizeDateOnly(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, dd, mm, yyyy] = slashMatch;
    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function inferCategory(text) {
  const hay = String(text || "").toLowerCase();
  if (/(diesel|fuel|petrol|ampol|shell|bp|caltex)/.test(hay)) return "Fuel";
  if (/(rego|registration)/.test(hay)) return "Rego";
  if (/(service)/.test(hay)) return "Service";
  if (/(repair|workshop|mechanic)/.test(hay)) return "Repair";
  if (/(tyre|tire)/.test(hay)) return "Tyres";
  if (/(toll|linkt)/.test(hay)) return "Toll";
  if (/(invoice)/.test(hay)) return "Invoice";
  return "Other";
}

function extractReceiptDetails(text) {
  const sourceText = String(text || "").trim();
  const lines = sourceText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const amountMatch = sourceText.match(/\$?\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+(?:\.\d{2}))/);
  const gstMatch = sourceText.match(/gst[^0-9$]*(\$?\s?\d+(?:\.\d{2})?)/i);
  const truckMatch = sourceText.match(/(?:truck|unit)\s*(?:#|number)?\s*[:\-]?\s*(\d{3,4})/i) || sourceText.match(/\b(620|672|840|841|853|855|881)\b/);
  const regoMatch = sourceText.match(/(?:rego|registration)\s*[:\-]?\s*([A-Z0-9-]{4,12})/i);
  const refMatch = sourceText.match(/(?:invoice|inv|receipt|ref|job|po)\s*(?:#|number)?\s*[:\-]?\s*([A-Z0-9\-\/]{3,})/i);
  const dateMatch = sourceText.match(/\b(\d{4}-\d{2}-\d{2})\b/) || sourceText.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/);
  const supplierMatch = sourceText.match(/(?:supplier|vendor|from)\s*[:\-]?\s*([^\n]+)/i);
  const firstLineSupplier = lines.find((line) => !/\d/.test(line) && line.length > 2 && line.length < 40);
  return {
    truckNumber: String(truckMatch?.[1] || "").trim(),
    rego: String(regoMatch?.[1] || "").trim(),
    reference: String(refMatch?.[1] || "").trim(),
    supplier: String(supplierMatch?.[1] || firstLineSupplier || "").trim(),
    amount: normalizeNumber(amountMatch?.[1] || 0),
    gst: normalizeNumber(gstMatch?.[1] || 0),
    receiptDate: normalizeDateOnly(dateMatch?.[1] || ""),
    category: inferCategory(sourceText)
  };
}

function getWebhookConfig(env = process.env) {
  const verifyToken = String(env.WHATSAPP_VERIFY_TOKEN || "").trim();
  const accessTokenRaw = String(env.WHATSAPP_ACCESS_TOKEN || "");
  const accessToken = accessTokenRaw.trim();
  const phoneNumberId = String(env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
  const supabase = getSupabaseServerConfig(env);
  const compactToken = accessToken.replace(/\s+/g, "");
  const contaminationPattern = /(curl|http|vercel|Invoke-RestMethod|Get-Clipboard|Bearer|\$TOKEN)/i;
  const tokenDiagnostics = {
    length: accessToken.length,
    compactLength: compactToken.length,
    startsWithEAA: /^EAA/i.test(accessToken),
    hasWhitespace: /\s/.test(accessToken),
    hasQuotes: /^["']|["']$/.test(accessToken),
    looksContaminated: contaminationPattern.test(accessToken),
    sample: accessToken
      ? `${accessToken.slice(0, 4)}...${accessToken.slice(-4)}`
      : ""
  };
  return {
    verifyToken,
    accessToken,
    phoneNumberId,
    verifyTokenConfigured: Boolean(verifyToken),
    accessTokenConfigured: Boolean(accessToken && phoneNumberId),
    supabaseConfigured: Boolean(supabase.configured),
    configured: Boolean(verifyToken && supabase.configured),
    tokenDiagnostics
  };
}

async function validateAccessToken(config) {
  if (!config.accessTokenConfigured) {
    return { valid: false, detail: "Missing WhatsApp access token or phone number ID." };
  }
  const targetId = encodeURIComponent(config.phoneNumberId);
  const url = `https://graph.facebook.com/v22.0/${targetId}?fields=id`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.accessToken}`
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        valid: false,
        detail: String(body?.error?.message || body?.message || `HTTP ${response.status}`)
      };
    }
    return { valid: true, detail: "" };
  } catch (error) {
    return { valid: false, detail: String(error?.message || error || "Token validation failed.") };
  }
}

function collectMessages(payload) {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  const messages = [];
  entries.forEach((entry) => {
    (Array.isArray(entry?.changes) ? entry.changes : []).forEach((change) => {
      const value = change?.value || {};
      const contactsByWaId = new Map((Array.isArray(value.contacts) ? value.contacts : []).map((contact) => [String(contact?.wa_id || contact?.from || ""), contact]));
      (Array.isArray(value.messages) ? value.messages : []).forEach((message) => {
        messages.push({
          ...message,
          contact: contactsByWaId.get(String(message?.from || "")) || null,
          metadata: value.metadata || {}
        });
      });
    });
  });
  return messages;
}

function descriptionPayloadFromMessage(message) {
  const messageType = String(message?.type || "text").trim() || "text";
  const typedPayload = (message && typeof message === "object" && typeof message[messageType] === "object")
    ? message[messageType]
    : null;
  const fallbackPayload = typedPayload || message?.image || message?.document || {};
  const text = String(message?.text?.body || fallbackPayload?.caption || "").trim();
  const mediaId = String(fallbackPayload?.id || "").trim();
  const isMediaType = messageType === "image" || messageType === "document";
  const notes = isMediaType && !mediaId
    ? "Webhook received media-type message without media id. Ask sender to re-send as a normal photo/document (not view-once)."
    : "";
  return {
    source: "whatsapp-webhook",
    senderName: String(message?.contact?.profile?.name || "").trim(),
    senderPhone: String(message?.from || "").trim(),
    receivedAt: message?.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString(),
    messageType,
    messageId: String(message?.id || "").trim(),
    reference: String(message?.id || "").trim(),
    filename: String(fallbackPayload?.filename || "").trim(),
    mimeType: String(fallbackPayload?.mime_type || "").trim(),
    mediaId,
    messageText: text,
    notes,
    extracted: extractReceiptDetails(text),
    reviewStatus: "Received",
    convertedExpenseId: "",
    convertedLogId: "",
    savedAt: new Date().toISOString()
  };
}

async function findExistingReceiptLog(client, reference) {
  const { data, error } = await client
    .from("app_logs")
    .select("id")
    .eq("log_type", RECEIPT_LOG_TYPE)
    .eq("reference", reference)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function saveReceiptMessage(client, message) {
  const payload = descriptionPayloadFromMessage(message);
  const existing = payload.reference ? await findExistingReceiptLog(client, payload.reference) : null;
  const row = {
    id: existing?.id || randomUUID(),
    log_date: payload.extracted.receiptDate || payload.receivedAt.slice(0, 10),
    log_type: RECEIPT_LOG_TYPE,
    driver: payload.senderName || "",
    truck_number: payload.extracted.truckNumber || "",
    reference: payload.reference || `wa:${Date.now()}`,
    status: payload.reviewStatus,
    description: JSON.stringify(payload)
  };

  if (existing?.id) {
    const { error } = await client.from("app_logs").update(row).eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  }

  const { data, error } = await client.from("app_logs").insert(row).select("id").limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0].id : "";
}

module.exports = async function handler(req, res) {
  const config = getWebhookConfig(process.env);
  const client = getSupabaseServerClient(process.env);

  if (req.method === "GET" && !req.query?.["hub.mode"]) {
    const tokenHealth = await validateAccessToken(config);
    return res.status(200).json({
      phoneNumberId: config.phoneNumberId,
      verifyTokenConfigured: config.verifyTokenConfigured,
      accessTokenConfigured: config.accessTokenConfigured,
      accessTokenValid: tokenHealth.valid,
      accessTokenError: tokenHealth.detail || "",
      tokenDiagnostics: config.tokenDiagnostics,
      supabaseConfigured: config.supabaseConfigured,
      configured: config.configured
    });
  }

  if (req.method === "GET") {
    const mode = String(req.query?.["hub.mode"] || "").trim();
    const token = String(req.query?.["hub.verify_token"] || "").trim();
    const challenge = String(req.query?.["hub.challenge"] || "");
    if (mode === "subscribe" && config.verifyTokenConfigured && token === config.verifyToken) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: "Webhook verification failed." });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!config.supabaseConfigured || !client) {
    return res.status(500).json({ error: "Supabase is not configured for WhatsApp receipt storage." });
  }

  const payload = parseBody(req);
  const messages = collectMessages(payload).filter((message) => ["text", "image", "document"].includes(String(message?.type || "").trim()));

  try {
    const savedIds = [];
    for (const message of messages) {
      const id = await saveReceiptMessage(client, message);
      if (id) savedIds.push(id);
    }
    return res.status(200).json({
      ok: true,
      received: messages.length,
      saved: savedIds.length
    });
  } catch (error) {
    return res.status(500).json({
      error: String(error?.message || error || "Unable to store WhatsApp receipts.")
    });
  }
};
