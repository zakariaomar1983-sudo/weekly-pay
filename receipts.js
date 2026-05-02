const auth = window.OPXAuth?.requireAuth("./login.html");
if (!auth) throw new Error("Authentication required");

const canAccessReceipts = auth.can("accessCRM") && (auth.can("viewSpending") || auth.can("editSpending") || auth.can("accessControlPanel"));
if (!canAccessReceipts) {
  document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>You do not have permission to access the Receipts Inbox.</p></section></main>";
  throw new Error("No receipts access");
}

const RECEIPTS_KEY = "transport_crm_whatsapp_receipts";
const RECEIPTS_SYNC_STATUS_KEY = "transport_crm_receipts_sync_status";
const APP_LOGS_TABLE = "app_logs";
const RECEIPT_LOG_TYPE = "WhatsApp Receipt";
const EXPENSE_KEY = "transport_crm_spending";
const LOG_KEY = "transport_crm_logs";
const DEFAULT_REVIEW_STATUS = "Received";
const RECEIPT_SYNC_RETRY_DELAYS_MS = [2000, 5000, 10000, 30000];
const RECEIPT_STATUSES = ["Received", "Review Needed", "Reviewed", "Expense Drafted", "Logged", "Archived"];
const RECEIPTS_WHATSAPP_NUMBER = "+61466694470";
const OCR_PROGRESS_THROTTLE_MS = 500;

const state = {
  receipts: readReceipts(),
  selectedAttachmentUrl: "",
  webhookStatus: null
};

let receiptSearchTimerId = 0;
let receiptSyncTimerId = 0;
let receiptRetryTimerId = 0;
let receiptRetryAttempt = 0;
let receiptSyncInFlight = false;
let receiptSyncQueued = false;

function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isSupabaseReady() {
  return Boolean(window.OPXSupabase?.isReady && window.OPXSupabase?.client);
}

function supabaseClient() {
  return window.OPXSupabase?.client || null;
}

function readJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}${Math.random().toString(16).slice(2, 10)}`.slice(0, 32);
}

function nowIso() {
  return new Date().toISOString();
}

function formatReceiptSyncTime(value = Date.now()) {
  return new Date(value).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

function formatRetryDelay(ms) {
  return ms >= 60000 ? `${Math.round(ms / 60000)}m` : `${Math.round(ms / 1000)}s`;
}

function setReceiptsSyncStatus(message, tone = "neutral", { at = Date.now(), persist = true } = {}) {
  const node = byId("receiptsSyncStatus");
  if (!node) return;
  node.textContent = `${message} Last updated ${formatReceiptSyncTime(at)}.`;
  node.className = `sync-badge sync-badge-${tone}`;
  if (persist) {
    writeJson(RECEIPTS_SYNC_STATUS_KEY, { message, tone, at });
  }
  window.dispatchEvent(new CustomEvent("opx:sync-health-change", { detail: { source: "Receipts", message, tone, at } }));
}

function restoreReceiptsSyncStatus() {
  const saved = readJson(RECEIPTS_SYNC_STATUS_KEY, null);
  if (!saved?.message) return false;
  setReceiptsSyncStatus(saved.message, saved.tone || "neutral", { at: saved.at || Date.now(), persist: false });
  return true;
}

function clearReceiptsRetry(resetAttempt = true) {
  window.clearTimeout(receiptRetryTimerId);
  receiptRetryTimerId = 0;
  if (resetAttempt) receiptRetryAttempt = 0;
}

function queueReceiptsRetry(errorMessage = "") {
  if (!isSupabaseReady()) return;
  clearReceiptsRetry(false);
  const delay = RECEIPT_SYNC_RETRY_DELAYS_MS[Math.min(receiptRetryAttempt, RECEIPT_SYNC_RETRY_DELAYS_MS.length - 1)];
  receiptRetryAttempt += 1;
  const waitingForInternet = navigator.onLine === false;
  const retryMessage = waitingForInternet
    ? "Receipts saved here. Waiting for internet to retry shared sync."
    : `Receipts saved here. Retrying shared sync in ${formatRetryDelay(delay)}.`;
  const details = errorMessage ? ` ${errorMessage}` : "";
  setReceiptsSyncStatus(`${retryMessage}${details}`, "error");
  receiptRetryTimerId = window.setTimeout(() => {
    receiptRetryTimerId = 0;
    scheduleReceiptsSync(0);
  }, waitingForInternet ? Math.max(delay, 5000) : delay);
}

function scheduleReceiptsSync(delay = 300) {
  if (!isSupabaseReady()) return;
  window.clearTimeout(receiptSyncTimerId);
  clearReceiptsRetry(false);
  receiptSyncTimerId = window.setTimeout(() => {
    receiptSyncTimerId = 0;
    if (receiptSyncInFlight) {
      receiptSyncQueued = true;
      return;
    }
    void syncReceiptsToSupabase();
  }, delay);
}

function parseDescriptionJson(value) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
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

function normalizeDateTimeLocal(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  const offset = parsed.getTimezoneOffset() * 60000;
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
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

function extractReceiptDetails(text, fallback = {}) {
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
    truckNumber: String(fallback.truckNumber || truckMatch?.[1] || "").trim(),
    rego: String(fallback.rego || regoMatch?.[1] || "").trim(),
    reference: String(fallback.reference || refMatch?.[1] || "").trim(),
    supplier: String(fallback.supplier || supplierMatch?.[1] || firstLineSupplier || "").trim(),
    amount: normalizeNumber(fallback.amount || amountMatch?.[1] || 0),
    gst: normalizeNumber(fallback.gst || gstMatch?.[1] || 0),
    receiptDate: normalizeDateOnly(fallback.receiptDate || dateMatch?.[1] || ""),
    category: String(fallback.category || inferCategory(sourceText) || "Other").trim() || "Other"
  };
}

function isImageMimeType(value) {
  return /^image\//i.test(String(value || "").trim());
}

function isImageFilename(value) {
  return /\.(png|jpg|jpeg|webp|bmp|tif|tiff|gif|heic)$/i.test(String(value || "").trim());
}

function isPlaceholderMediaId(value) {
  return /^media-test-/i.test(String(value || "").trim());
}

function receiptAttachmentUrl(item = null) {
  const previewDataUrl = String(item?.previewDataUrl || "").trim();
  if (previewDataUrl) return previewDataUrl;
  const mediaId = String(item?.mediaId || "").trim();
  if (!mediaId || isPlaceholderMediaId(mediaId)) return "";
  const query = new URLSearchParams({ mediaId });
  const mimeType = String(item?.mimeType || "").trim();
  if (mimeType) query.set("mimeType", mimeType);
  return `./api/whatsapp-receipts-media?${query.toString()}`;
}

function applyParsedReceiptDetails(parsed) {
  byId("receiptTruckNumber").value = parsed.truckNumber || "";
  byId("receiptSupplier").value = parsed.supplier || "";
  byId("receiptAmount").value = parsed.amount ? String(parsed.amount) : "";
  byId("receiptGst").value = parsed.gst ? String(parsed.gst) : "";
  byId("receiptDate").value = parsed.receiptDate || "";
  byId("receiptCategory").value = parsed.category || "Other";
  byId("receiptReference").value = parsed.reference || byId("receiptReference").value;
}

function currentFormExtractFallback() {
  return {
    truckNumber: byId("receiptTruckNumber").value,
    supplier: byId("receiptSupplier").value,
    amount: byId("receiptAmount").value,
    gst: byId("receiptGst").value,
    receiptDate: byId("receiptDate").value,
    category: byId("receiptCategory").value,
    reference: byId("receiptReference").value
  };
}

function looksLikeApiErrorText(text) {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return false;
  return (
    (value.includes("\"error\"") || value.startsWith("error:"))
    && (
      value.includes("unsupported get request")
      || value.includes("invalid oauth")
      || value.includes("invalid application id")
      || value.includes("graph api")
      || value.includes("cannot parse access token")
    )
  );
}

function isSampleOrErrorReceipt(item = {}) {
  return (
    isPlaceholderMediaId(item.mediaId)
    || looksLikeApiErrorText(item.messageText)
    || looksLikeApiErrorText(item.notes)
    || looksLikeApiErrorText(item.reference)
  );
}

function applyExtractionFromText(text, successMessage = "Message parsed. Check the extracted details before saving.") {
  if (looksLikeApiErrorText(text)) {
    setDataStatus("This text is an API error, not a receipt caption. Open a real WhatsApp receipt and use Extract From Attachment.", "error");
    return;
  }
  const parsed = extractReceiptDetails(text, currentFormExtractFallback());
  applyParsedReceiptDetails(parsed);
  setDataStatus(successMessage, "success");
}

function looksLikeImageInput(fileName = "", mimeType = "") {
  return isImageMimeType(mimeType) || isImageFilename(fileName);
}

function getEditingReceipt() {
  const id = byId("receiptId").value;
  if (!id) return null;
  return state.receipts.find((item) => item.id === id) || null;
}

function latestReceiptWithAttachment() {
  return state.receipts.find((item) => Boolean(receiptAttachmentUrl(item))) || null;
}

function ensureReceiptWithAttachmentLoaded() {
  const editing = getEditingReceipt();
  if (editing && receiptAttachmentUrl(editing)) return editing;
  const candidate = latestReceiptWithAttachment();
  if (!candidate) return null;
  fillForm(candidate);
  return candidate;
}

async function readBlobFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Attachment fetch failed (${response.status}).`);
  }
  return response.blob();
}

async function blobLooksLikePdf(blob) {
  try {
    const buffer = await blob.slice(0, 5).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    return bytes.length >= 4
      && bytes[0] === 0x25 // %
      && bytes[1] === 0x50 // P
      && bytes[2] === 0x44 // D
      && bytes[3] === 0x46; // F
  } catch {
    return false;
  }
}

async function runAttachmentOcr(blob, onProgress = () => {}) {
  if (!window.Tesseract?.recognize) {
    throw new Error("OCR engine is unavailable. Refresh and try again.");
  }
  let lastProgressAt = 0;
  const result = await window.Tesseract.recognize(blob, "eng", {
    logger: (msg) => {
      if (msg?.status !== "recognizing text") return;
      const now = Date.now();
      if (now - lastProgressAt < OCR_PROGRESS_THROTTLE_MS) return;
      lastProgressAt = now;
      const pct = Math.max(0, Math.min(100, Math.round(Number(msg.progress || 0) * 100)));
      onProgress(pct);
    }
  });
  return String(result?.data?.text || "").trim();
}

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  if (value === "archived") return "neutral";
  if (value.includes("review")) return "warning";
  if (value.includes("drafted") || value.includes("logged")) return "queue";
  return "live";
}

function statusBadge(status) {
  return `<span class="status-pill status-pill-${statusTone(status)}">${escapeHtml(status)}</span>`;
}

function normalizeReceipt(input = {}) {
  const id = isUuid(input.id) ? input.id : newId();
  const messageText = String(input.messageText || input.caption || input.bodyText || "").trim();
  const extracted = extractReceiptDetails(messageText, input.extracted || {
    truckNumber: input.truckNumber,
    supplier: input.supplier,
    amount: input.amount,
    gst: input.gst,
    receiptDate: input.receiptDate,
    category: input.category,
    reference: input.reference
  });
  return {
    id,
    source: String(input.source || "manual").trim() || "manual",
    senderName: String(input.senderName || "").trim(),
    senderPhone: String(input.senderPhone || "").trim(),
    receivedAt: normalizeDateTimeLocal(input.receivedAt || nowIso()),
    messageType: String(input.messageType || "manual").trim() || "manual",
    reference: String(input.reference || "").trim() || String(input.messageId || "").trim() || `receipt:${id}`,
    messageId: String(input.messageId || "").trim(),
    filename: String(input.filename || "").trim(),
    mimeType: String(input.mimeType || "").trim(),
    mediaId: String(input.mediaId || "").trim(),
    messageText,
    notes: String(input.notes || "").trim(),
    reviewStatus: RECEIPT_STATUSES.includes(String(input.reviewStatus || "").trim()) ? String(input.reviewStatus).trim() : DEFAULT_REVIEW_STATUS,
    extracted,
    previewDataUrl: String(input.previewDataUrl || "").trim(),
    convertedExpenseId: String(input.convertedExpenseId || "").trim(),
    convertedLogId: String(input.convertedLogId || "").trim(),
    savedAt: String(input.savedAt || nowIso())
  };
}

function readReceipts() {
  const rows = readJson(RECEIPTS_KEY, []);
  return Array.isArray(rows) ? rows.map((row) => normalizeReceipt(row)) : [];
}

function saveReceipts({ sync = true } = {}) {
  state.receipts = state.receipts.map((item) => normalizeReceipt(item));
  writeJson(RECEIPTS_KEY, state.receipts);
  if (sync && isSupabaseReady()) {
    setReceiptsSyncStatus("Syncing receipt inbox...", "syncing");
    scheduleReceiptsSync();
  } else if (sync) {
    setReceiptsSyncStatus("Receipts saved on this device only.", "local");
  }
}

function mergeReceipts(...groups) {
  const byKey = new Map();
  groups.flat().forEach((row) => {
    if (!row || typeof row !== "object") return;
    const normalized = normalizeReceipt(row);
    const key = normalized.id || normalized.reference;
    const existing = byKey.get(key);
    const existingTime = Date.parse(existing?.savedAt || existing?.receivedAt || "") || 0;
    const nextTime = Date.parse(normalized.savedAt || normalized.receivedAt || "") || 0;
    if (!existing || nextTime >= existingTime) byKey.set(key, normalized);
  });
  return Array.from(byKey.values()).sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")));
}

function toDbReceipt(item) {
  const payload = {
    source: item.source,
    senderName: item.senderName,
    senderPhone: item.senderPhone,
    receivedAt: item.receivedAt,
    messageType: item.messageType,
    messageId: item.messageId,
    reference: item.reference,
    filename: item.filename,
    mimeType: item.mimeType,
    mediaId: item.mediaId,
    messageText: item.messageText,
    notes: item.notes,
    extracted: item.extracted,
    previewDataUrl: item.previewDataUrl,
    reviewStatus: item.reviewStatus,
    convertedExpenseId: item.convertedExpenseId,
    convertedLogId: item.convertedLogId,
    savedAt: item.savedAt
  };
  return {
    id: item.id,
    log_date: normalizeDateOnly(item.extracted?.receiptDate || item.receivedAt) || nowIso().slice(0, 10),
    log_type: RECEIPT_LOG_TYPE,
    driver: item.senderName || "",
    truck_number: item.extracted?.truckNumber || "",
    reference: item.reference || `receipt:${item.id}`,
    status: item.reviewStatus || DEFAULT_REVIEW_STATUS,
    description: JSON.stringify(payload)
  };
}

function fromDbReceipt(row) {
  const meta = parseDescriptionJson(row.description);
  return normalizeReceipt({
    id: row.id,
    source: meta.source || "whatsapp-webhook",
    senderName: meta.senderName || row.driver || "",
    senderPhone: meta.senderPhone || "",
    receivedAt: meta.receivedAt || row.log_date || nowIso(),
    messageType: meta.messageType || "document",
    messageId: meta.messageId || "",
    reference: meta.reference || row.reference || "",
    filename: meta.filename || "",
    mimeType: meta.mimeType || "",
    mediaId: meta.mediaId || "",
    messageText: meta.messageText || "",
    notes: meta.notes || "",
    reviewStatus: row.status || meta.reviewStatus || DEFAULT_REVIEW_STATUS,
    extracted: {
      ...(meta.extracted || {}),
      truckNumber: meta.extracted?.truckNumber || row.truck_number || ""
    },
    previewDataUrl: meta.previewDataUrl || "",
    convertedExpenseId: meta.convertedExpenseId || "",
    convertedLogId: meta.convertedLogId || "",
    savedAt: meta.savedAt || row.updated_at || row.created_at || nowIso()
  });
}

async function syncReceiptsToSupabase() {
  if (!isSupabaseReady() || receiptSyncInFlight) return false;
  receiptSyncInFlight = true;
  try {
    const client = supabaseClient();
    const rows = state.receipts.map(toDbReceipt);
    const { error } = await client.from(APP_LOGS_TABLE).upsert(rows, { onConflict: "id" });
    if (error) throw error;
    clearReceiptsRetry();
    setReceiptsSyncStatus("Receipts inbox synced.", "live");
    return true;
  } catch (error) {
    console.error("Supabase sync failed for WhatsApp receipts:", error.message || error);
    queueReceiptsRetry(error.message || String(error));
    return false;
  } finally {
    receiptSyncInFlight = false;
    if (receiptSyncQueued) {
      receiptSyncQueued = false;
      scheduleReceiptsSync(0);
    }
  }
}

async function loadRemoteReceipts() {
  if (!isSupabaseReady()) {
    setReceiptsSyncStatus("Shared receipts unavailable. Using this device's inbox.", "local");
    return;
  }
  try {
    setReceiptsSyncStatus("Checking shared receipts inbox...", "syncing", { persist: false });
    const client = supabaseClient();
    const { data, error } = await client
      .from(APP_LOGS_TABLE)
      .select("*")
      .eq("log_type", RECEIPT_LOG_TYPE)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const remote = (Array.isArray(data) ? data : []).map(fromDbReceipt);
    state.receipts = mergeReceipts(state.receipts, remote);
    writeJson(RECEIPTS_KEY, state.receipts);
    setReceiptsSyncStatus("Shared receipts inbox loaded.", "live");
  } catch (error) {
    console.error("Supabase load failed for WhatsApp receipts:", error.message || error);
    setReceiptsSyncStatus("Shared receipts unavailable. Using this device's inbox.", "local");
  }
}

function receiptSummaryStats() {
  const active = state.receipts.filter((item) => item.reviewStatus !== "Archived");
  return [
    { label: "Inbox Items", value: String(active.length) },
    { label: "Need Review", value: String(active.filter((item) => item.reviewStatus === "Review Needed" || item.reviewStatus === "Received").length) },
    { label: "Expense Drafted", value: String(active.filter((item) => item.reviewStatus === "Expense Drafted").length) },
    { label: "Archived", value: String(state.receipts.filter((item) => item.reviewStatus === "Archived").length) }
  ];
}

function drawStats() {
  byId("receiptsStats").innerHTML = receiptSummaryStats()
    .map((item) => `<article class="stat-card"><p>${item.label}</p><h3>${item.value}</h3></article>`)
    .join("");
}

function formatDisplayDateTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value || "-");
  return parsed.toLocaleString("en-AU", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" });
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function isMediaTypeReceipt(item) {
  const type = String(item?.messageType || "").trim().toLowerCase();
  return type === "image" || type === "document";
}

function hasUsefulPayload(item) {
  return Boolean(receiptAttachmentUrl(item))
    || Boolean(String(item?.messageText || "").trim());
}

function filteredReceipts() {
  const query = String(byId("receiptsSearch")?.value || "").trim().toLowerCase();
  const status = String(byId("receiptsStatusFilter")?.value || "").trim();
  const showMissingMedia = Boolean(byId("receiptsShowMissingMedia")?.checked);
  return state.receipts.filter((item) => {
    if (status && item.reviewStatus !== status) return false;
    if (!showMissingMedia && isMediaTypeReceipt(item) && !hasUsefulPayload(item)) return false;
    if (!query) return true;
    const hay = [
      item.senderName,
      item.senderPhone,
      item.extracted?.truckNumber,
      item.extracted?.supplier,
      item.extracted?.reference,
      item.extracted?.category,
      item.notes,
      item.messageText,
      item.reference
    ].join(" ").toLowerCase();
    return hay.includes(query);
  });
}

function drawTable() {
  const tbody = byId("receiptsTableBody");
  const rows = filteredReceipts();
  if (!rows.length) {
    tbody.innerHTML = "<tr><td colspan='10' class='empty'>No receipt inbox items match your filters yet.</td></tr>";
    return;
  }
  tbody.innerHTML = rows.map((item) => {
    const canCreateExpense = auth.can("editSpending");
    const canCreateLog = auth.can("editLogs") || auth.can("accessControlPanel");
    const hasMedia = Boolean(receiptAttachmentUrl(item));
    const hasCaption = Boolean(String(item.messageText || "").trim());
    const attachmentLabel = hasMedia ? "Media" : (hasCaption ? "Caption" : "Missing");
    const attachmentTone = hasMedia || hasCaption ? "live" : "warning";
    return `
      <tr>
        <td>${escapeHtml(formatDisplayDateTime(item.receivedAt))}</td>
        <td>
          <strong>${escapeHtml(item.senderName || "-")}</strong>
          <div class="muted receipts-meta">${escapeHtml(item.senderPhone || item.reference || "")}</div>
        </td>
        <td>${escapeHtml(item.extracted?.truckNumber || "-")}</td>
        <td>${escapeHtml(item.extracted?.supplier || "-")}</td>
        <td>${money(item.extracted?.amount || 0)}</td>
        <td>${escapeHtml(item.extracted?.category || "-")}</td>
        <td>${statusBadge(item.reviewStatus)}</td>
        <td><span class="status-pill status-pill-${attachmentTone}">${attachmentLabel}</span></td>
        <td>${escapeHtml(item.source || "-")}</td>
        <td>
          <div class="table-actions table-actions-stack">
            <button type="button" data-action="edit-receipt" data-id="${item.id}">Review</button>
            <button type="button" data-action="expense-receipt" data-id="${item.id}" ${canCreateExpense ? "" : "disabled"}>Create Expense</button>
            <button type="button" data-action="log-receipt" data-id="${item.id}" ${canCreateLog ? "" : "disabled"}>Create Log</button>
            <button type="button" data-action="archive-receipt" data-id="${item.id}">${item.reviewStatus === "Archived" ? "Reopen" : "Archive"}</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function setDataStatus(message, tone = "neutral") {
  const node = byId("receiptsDataStatus");
  if (!node) return;
  node.textContent = message;
  node.className = `data-status data-status-${tone}`;
}

function readAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Attachment read failed."));
    reader.readAsDataURL(file);
  });
}

function updateAttachmentMeta(item = null) {
  const meta = byId("receiptAttachmentMeta");
  const openBtn = byId("openReceiptAttachment");
  state.selectedAttachmentUrl = receiptAttachmentUrl(item);
  const messageType = String(item?.messageType || "").trim().toLowerCase();
  const isMediaType = messageType === "image" || messageType === "document";
  if (meta) {
    if (item?.filename) {
      meta.textContent = `${item.filename}${item.mimeType ? ` - ${item.mimeType}` : ""}`;
    } else if (isPlaceholderMediaId(item?.mediaId)) {
      meta.textContent = "Sample media record only (no real WhatsApp file attached).";
    } else if (item?.mediaId) {
      meta.textContent = `WhatsApp media ${item.mediaId.slice(0, 10)}${item.mimeType ? ` - ${item.mimeType}` : ""}`;
    } else {
      meta.textContent = "No attachment selected.";
    }
  }
  if (openBtn) {
    const isTextOnly = messageType === "text" && !state.selectedAttachmentUrl;
    const isMissingMediaId = isMediaType && !state.selectedAttachmentUrl;
    openBtn.disabled = !state.selectedAttachmentUrl;
    openBtn.textContent = isTextOnly
      ? "No Attachment (Text)"
      : (isMissingMediaId ? "Missing Media ID" : "Open Attachment");
  }
}

function resetForm() {
  byId("receiptsForm").reset();
  byId("receiptId").value = "";
  byId("receiptReceivedAt").value = normalizeDateTimeLocal(nowIso());
  byId("receiptReviewStatus").value = DEFAULT_REVIEW_STATUS;
  byId("receiptCategory").value = "Fuel";
  updateAttachmentMeta(null);
}

function fillForm(item) {
  let activeItem = normalizeReceipt(item || {});
  const extracted = activeItem.extracted || {};
  const hasCaptionText = Boolean(String(activeItem.messageText || "").trim());
  const missingSupplier = !String(extracted.supplier || "").trim();
  const missingAmount = Number(extracted.amount || 0) <= 0;
  const missingDate = !String(extracted.receiptDate || "").trim();
  if (hasCaptionText && (missingSupplier || missingAmount || missingDate)) {
    const parsed = extractReceiptDetails(activeItem.messageText, extracted);
    const hasNewSupplier = !String(extracted.supplier || "").trim() && Boolean(String(parsed.supplier || "").trim());
    const hasNewAmount = Number(extracted.amount || 0) <= 0 && Number(parsed.amount || 0) > 0;
    const hasNewDate = !String(extracted.receiptDate || "").trim() && Boolean(String(parsed.receiptDate || "").trim());
    if (hasNewSupplier || hasNewAmount || hasNewDate) {
      activeItem = normalizeReceipt({
        ...activeItem,
        extracted: {
          ...extracted,
          ...parsed
        },
        savedAt: nowIso()
      });
      const index = state.receipts.findIndex((row) => row.id === activeItem.id);
      if (index >= 0) {
        state.receipts[index] = activeItem;
        saveReceipts();
        drawStats();
        drawTable();
      }
    }
  }

  byId("receiptId").value = activeItem.id;
  byId("receiptSenderName").value = activeItem.senderName || "";
  byId("receiptSenderPhone").value = activeItem.senderPhone || "";
  byId("receiptReceivedAt").value = normalizeDateTimeLocal(activeItem.receivedAt || nowIso());
  byId("receiptMessageType").value = activeItem.messageType || "manual";
  byId("receiptTruckNumber").value = activeItem.extracted?.truckNumber || "";
  byId("receiptSupplier").value = activeItem.extracted?.supplier || "";
  byId("receiptAmount").value = activeItem.extracted?.amount ? String(activeItem.extracted.amount) : "";
  byId("receiptGst").value = activeItem.extracted?.gst ? String(activeItem.extracted.gst) : "";
  byId("receiptDate").value = activeItem.extracted?.receiptDate || "";
  byId("receiptCategory").value = activeItem.extracted?.category || "Other";
  byId("receiptReference").value = activeItem.extracted?.reference || activeItem.reference || "";
  byId("receiptReviewStatus").value = activeItem.reviewStatus || DEFAULT_REVIEW_STATUS;
  byId("receiptMessageText").value = activeItem.messageText || "";
  byId("receiptNotes").value = activeItem.notes || "";
  updateAttachmentMeta(activeItem);
}

function nextReceiptForReview() {
  const priorities = ["Received", "Review Needed", "Reviewed", "Expense Drafted", "Logged"];
  const activeRows = state.receipts.filter((item) =>
    item.reviewStatus !== "Archived" && !isSampleOrErrorReceipt(item)
  );
  for (const status of priorities) {
    const foundMediaPayload = activeRows.find((item) =>
      item.reviewStatus === status && isMediaTypeReceipt(item) && Boolean(receiptAttachmentUrl(item))
    );
    if (foundMediaPayload) return foundMediaPayload;

    const foundWithPayload = activeRows.find((item) => item.reviewStatus === status && hasUsefulPayload(item));
    if (foundWithPayload) return foundWithPayload;
  }
  return activeRows.find((item) => isMediaTypeReceipt(item) && Boolean(receiptAttachmentUrl(item)))
    || activeRows.find((item) => hasUsefulPayload(item))
    || null;
}

function autoPopulateReceiptForm({ force = false } = {}) {
  const currentId = String(byId("receiptId")?.value || "").trim();
  if (currentId && !force) return false;
  const next = nextReceiptForReview();
  if (!next) {
    resetForm();
    setDataStatus("No receipt rows with attachment/caption payload yet. Send a fresh receipt image to WhatsApp with a caption (truck, supplier, amount, date).", "error");
    return false;
  }
  fillForm(next);
  setDataStatus(`Loaded ${next.extracted?.supplier || next.senderName || "latest receipt"} for review.`, "neutral");
  return true;
}

function receiptFromForm(existing = {}) {
  return normalizeReceipt({
    ...existing,
    id: existing.id || byId("receiptId").value || newId(),
    senderName: byId("receiptSenderName").value.trim(),
    senderPhone: byId("receiptSenderPhone").value.trim(),
    receivedAt: byId("receiptReceivedAt").value || nowIso(),
    messageType: byId("receiptMessageType").value,
    reference: byId("receiptReference").value.trim() || existing.reference || "",
    messageText: byId("receiptMessageText").value.trim(),
    notes: byId("receiptNotes").value.trim(),
    reviewStatus: byId("receiptReviewStatus").value,
    filename: existing.filename || "",
    mimeType: existing.mimeType || "",
    previewDataUrl: existing.previewDataUrl || "",
    extracted: {
      truckNumber: byId("receiptTruckNumber").value.trim(),
      supplier: byId("receiptSupplier").value.trim(),
      amount: normalizeNumber(byId("receiptAmount").value),
      gst: normalizeNumber(byId("receiptGst").value),
      receiptDate: normalizeDateOnly(byId("receiptDate").value),
      category: byId("receiptCategory").value,
      reference: byId("receiptReference").value.trim()
    },
    savedAt: nowIso()
  });
}

function replaceReceipt(item) {
  const index = state.receipts.findIndex((row) => row.id === item.id);
  if (index === -1) {
    state.receipts = [item, ...state.receipts];
  } else {
    state.receipts[index] = item;
  }
  state.receipts = mergeReceipts(state.receipts);
  saveReceipts();
  drawStats();
  drawTable();
}

function createExpenseFromReceipt(item) {
  const expenses = readJson(EXPENSE_KEY, []);
  const expenseId = newId();
  const payload = {
    id: expenseId,
    date: normalizeDateOnly(item.extracted?.receiptDate || item.receivedAt) || nowIso().slice(0, 10),
    truckNumber: item.extracted?.truckNumber || "",
    category: item.extracted?.category || "Other",
    amount: normalizeNumber(item.extracted?.amount || 0),
    vendor: item.extracted?.supplier || item.senderName || "WhatsApp Receipt",
    notes: [item.notes, item.messageText, item.extracted?.reference ? `Ref ${item.extracted.reference}` : ""].filter(Boolean).join(" | ")
  };
  expenses.unshift(payload);
  writeJson(EXPENSE_KEY, expenses);
  const updated = normalizeReceipt({
    ...item,
    reviewStatus: "Expense Drafted",
    convertedExpenseId: expenseId,
    savedAt: nowIso()
  });
  replaceReceipt(updated);
  setDataStatus(`Truck expense draft created for ${updated.extracted?.supplier || updated.senderName || "this receipt"}.`, "success");
}

function createLogFromReceipt(item) {
  const logs = readJson(LOG_KEY, []);
  const logId = newId();
  const payload = {
    id: logId,
    logDate: normalizeDateOnly(item.extracted?.receiptDate || item.receivedAt) || nowIso().slice(0, 10),
    logType: "WhatsApp Receipt",
    driver: item.senderName || "",
    truck: item.extracted?.truckNumber || "",
    reference: item.extracted?.reference || item.reference || "",
    status: "Open",
    description: [item.extracted?.supplier, item.messageText, item.notes].filter(Boolean).join(" | ")
  };
  logs.unshift(payload);
  writeJson(LOG_KEY, logs);
  const updated = normalizeReceipt({
    ...item,
    reviewStatus: item.reviewStatus === "Expense Drafted" ? "Expense Drafted" : "Logged",
    convertedLogId: logId,
    savedAt: nowIso()
  });
  replaceReceipt(updated);
  setDataStatus(`Log entry created for ${updated.extracted?.supplier || updated.senderName || "this receipt"}.`, "success");
}

async function loadWebhookStatus() {
  const webhookUrl = new URL("./api/whatsapp-receipts-webhook", window.location.href).href;
  byId("receiptsWebhookUrl").value = webhookUrl;
  byId("receiptsWhatsappNumber").value = RECEIPTS_WHATSAPP_NUMBER;
  try {
    const response = await fetch(webhookUrl, { method: "GET" });
    const data = await response.json();
    state.webhookStatus = data;
    byId("receiptsWebhookState").textContent = data.configured ? "Ready for webhook verification" : "Setup still needed";
    const tokenState = data.accessTokenConfigured
      ? (data.accessTokenValid ? "valid" : "invalid")
      : "missing";
    const tokenNote = data.accessTokenConfigured && !data.accessTokenValid && data.accessTokenError
      ? ` Token check: ${data.accessTokenError}`
      : "";
    byId("receiptsWebhookMeta").textContent = data.configured
      ? `Supabase ${data.supabaseConfigured ? "ready" : "missing"}. Verify token ${data.verifyTokenConfigured ? "configured" : "missing"}. Cloud API token ${tokenState}.${tokenNote}`
      : `Webhook setup still needs attention. Supabase ${data.supabaseConfigured ? "ready" : "missing"}, verify token ${data.verifyTokenConfigured ? "configured" : "missing"}, access token ${tokenState}.${tokenNote}`;
  } catch (error) {
    byId("receiptsWebhookState").textContent = "Webhook status unavailable";
    byId("receiptsWebhookMeta").textContent = `Could not read API setup right now. ${error.message || error}`;
  }
}

function applyNavVisibility() {
  if (!auth.can("viewReports")) byId("reportsLink")?.style.setProperty("display", "none");
  if (!auth.can("viewDrivers")) byId("driversLink")?.style.setProperty("display", "none");
  if (!auth.can("viewTrucks")) byId("trucksLink")?.style.setProperty("display", "none");
  if (!auth.can("viewRoster")) byId("rosterLink")?.style.setProperty("display", "none");
  if (!(auth.can("viewTruckIncome") || auth.can("viewSpending") || auth.can("viewPayslips") || auth.can("viewStats"))) byId("financeLink")?.style.setProperty("display", "none");
  if (!auth.can("accessLogs")) byId("logsLink")?.style.setProperty("display", "none");
  if (!auth.can("accessControlPanel")) byId("controlPanelLink")?.style.setProperty("display", "none");
}

function scheduleRefresh() {
  window.clearTimeout(receiptSearchTimerId);
  receiptSearchTimerId = window.setTimeout(() => {
    receiptSearchTimerId = 0;
    drawTable();
  }, 100);
}

byId("logoutBtn").addEventListener("click", () => {
  window.OPXAuth.logout();
  window.location.href = "./login.html";
});

byId("receiptsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = byId("receiptId").value;
  const existing = state.receipts.find((item) => item.id === id) || {};
  const file = byId("receiptAttachment").files?.[0] || null;
  const draft = receiptFromForm(existing);
  if (file) {
    draft.filename = file.name;
    draft.mimeType = file.type || "";
    draft.previewDataUrl = await readAttachment(file);
  }
  replaceReceipt(draft);
  fillForm(draft);
  setDataStatus(`Receipt saved for ${draft.extracted?.supplier || draft.senderName || "review"}.`, "success");
});

byId("parseReceiptMessage").addEventListener("click", () => {
  const messageText = byId("receiptMessageText").value.trim();
  if (!messageText) {
    const hasManualAttachment = Boolean(byId("receiptAttachment").files?.[0]);
    const hasStoredAttachment = Boolean(ensureReceiptWithAttachmentLoaded());
    if (hasManualAttachment || hasStoredAttachment) {
      setDataStatus("No caption text found. Running attachment OCR instead...", "neutral");
      byId("parseReceiptAttachment").click();
      return;
    }
    setDataStatus("No caption text found. Paste the WhatsApp caption or use Extract From Attachment.", "error");
    return;
  }
  applyExtractionFromText(messageText, "Caption text parsed. Check extracted details before saving.");
});

byId("parseReceiptAttachment").addEventListener("click", async () => {
  const file = byId("receiptAttachment").files?.[0] || null;
  const editingReceipt = ensureReceiptWithAttachmentLoaded();

  let blob = null;
  let sourceName = "";
  let sourceMime = "";
  let sourceLabel = "attachment";

  if (file) {
    sourceName = file.name || "attachment";
    sourceMime = file.type || "";
    sourceLabel = sourceName;
    if (!looksLikeImageInput(sourceName, sourceMime)) {
      setDataStatus("OCR currently supports image attachments only (PNG, JPG, WEBP, HEIC).", "error");
      return;
    }
    blob = file;
  } else if (editingReceipt) {
    sourceName = editingReceipt.filename || editingReceipt.mediaId || "WhatsApp attachment";
    sourceMime = editingReceipt.mimeType || "";
    sourceLabel = sourceName;
    const url = receiptAttachmentUrl(editingReceipt);
    if (!url) {
      setDataStatus("No image attachment found for OCR.", "error");
      return;
    }
    setDataStatus("Loading attachment from WhatsApp...", "neutral");
    try {
      blob = await readBlobFromUrl(url);
    } catch (error) {
      setDataStatus(`Could not load attachment for OCR. ${error.message || error}`, "error");
      return;
    }
  } else {
    setDataStatus("No WhatsApp media is linked to this receipt yet. Click Review on a row with an attachment, or upload an image file below.", "error");
    return;
  }

  const blobMime = String(blob?.type || "").trim();
  const looksImage = looksLikeImageInput(sourceName, sourceMime)
    || looksLikeImageInput(sourceName, blobMime)
    || isImageMimeType(blobMime);

  if (!looksImage) {
    if (await blobLooksLikePdf(blob)) {
      setDataStatus("This attachment is a PDF, not an image. Paste caption text and use Extract From Message.", "error");
      return;
    }
    setDataStatus(`"${sourceLabel}" is not an image attachment. Paste caption text and use Extract From Message.`, "error");
    return;
  }

  try {
    setDataStatus("Running OCR on attachment (0%)...", "neutral");
    const text = await runAttachmentOcr(blob, (pct) => {
      setDataStatus(`Running OCR on attachment (${pct}%)...`, "neutral");
    });
    if (!text) {
      setDataStatus("OCR finished but no readable text was found in the image.", "error");
      return;
    }
    if (!byId("receiptMessageText").value.trim()) {
      byId("receiptMessageText").value = text;
    }
    applyExtractionFromText(text, "Attachment OCR complete. Check extracted details before saving.");
  } catch (error) {
    setDataStatus(`Attachment OCR failed. ${error.message || error}`, "error");
  }
});

byId("cancelReceiptEdit").addEventListener("click", () => {
  resetForm();
  setDataStatus("Receipt form reset. You can capture a new receipt now.");
});

byId("copyReceiptsWebhookUrl").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(byId("receiptsWebhookUrl").value);
    setDataStatus("Webhook URL copied. You can paste it into Meta WhatsApp webhook setup.", "success");
  } catch (error) {
    setDataStatus(`Could not copy the webhook URL. ${error.message || error}`, "error");
  }
});

byId("copyReceiptsWhatsappNumber").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(RECEIPTS_WHATSAPP_NUMBER);
    setDataStatus("Receipt WhatsApp number copied. Your team can forward receipts to it now.", "success");
  } catch (error) {
    setDataStatus(`Could not copy the receipt number. ${error.message || error}`, "error");
  }
});

byId("openReceiptAttachment").addEventListener("click", () => {
  if (!state.selectedAttachmentUrl) {
    const item = ensureReceiptWithAttachmentLoaded();
    if (item) {
      setDataStatus("Loaded latest receipt with attachment.", "neutral");
    }
  }
  if (!state.selectedAttachmentUrl) {
    setDataStatus("No attachment is linked yet. Scroll to Inbox and click Review on that receipt, or upload a file below.", "error");
    return;
  }
  window.open(state.selectedAttachmentUrl, "_blank", "noopener");
});

byId("receiptsSearch").addEventListener("input", scheduleRefresh);
byId("receiptsStatusFilter").addEventListener("change", drawTable);
byId("receiptsShowMissingMedia").addEventListener("change", drawTable);
byId("clearReceiptsFilters").addEventListener("click", () => {
  byId("receiptsSearch").value = "";
  byId("receiptsStatusFilter").value = "";
  byId("receiptsShowMissingMedia").checked = false;
  drawTable();
});

byId("archiveSampleRows").addEventListener("click", () => {
  const targets = state.receipts.filter((item) => item.reviewStatus !== "Archived" && isSampleOrErrorReceipt(item));
  if (!targets.length) {
    setDataStatus("No sample/error receipt rows found to archive.");
    return;
  }
  const targetIds = new Set(targets.map((item) => item.id));
  const updatedAt = nowIso();
  state.receipts = state.receipts.map((item) => {
    if (!targetIds.has(item.id)) return item;
    return normalizeReceipt({
      ...item,
      reviewStatus: "Archived",
      savedAt: updatedAt
    });
  });
  saveReceipts();
  drawStats();
  drawTable();
  setDataStatus(`${targets.length} sample/error receipt ${targets.length === 1 ? "row" : "rows"} archived.`, "success");
});

byId("receiptAttachment").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    updateAttachmentMeta(null);
    return;
  }
  const previewUrl = URL.createObjectURL(file);
  updateAttachmentMeta({ filename: file.name, mimeType: file.type, previewDataUrl: previewUrl });
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const id = button.dataset.id;
  const item = state.receipts.find((row) => row.id === id);
  if (!item) return;
  const action = button.dataset.action;
  if (action === "edit-receipt") {
    fillForm(item);
    setDataStatus(`Reviewing ${item.extracted?.supplier || item.senderName || "selected receipt"}.`);
  }
  if (action === "expense-receipt" && auth.can("editSpending")) {
    createExpenseFromReceipt(item);
  }
  if (action === "log-receipt" && (auth.can("editLogs") || auth.can("accessControlPanel"))) {
    createLogFromReceipt(item);
  }
  if (action === "archive-receipt") {
    replaceReceipt({
      ...item,
      reviewStatus: item.reviewStatus === "Archived" ? "Reviewed" : "Archived",
      savedAt: nowIso()
    });
    setDataStatus(item.reviewStatus === "Archived" ? "Receipt restored to active inbox." : "Receipt archived.", "success");
  }
});

window.addEventListener("storage", (event) => {
  if (event.key === RECEIPTS_KEY) {
    state.receipts = readReceipts();
    drawStats();
    drawTable();
    autoPopulateReceiptForm();
  }
});

(async function initReceiptsPage() {
  const currentUserChip = byId("currentUserChip");
  if (currentUserChip) currentUserChip.textContent = `User: ${auth.user.username}`;
  applyNavVisibility();
  if (!restoreReceiptsSyncStatus()) {
    setReceiptsSyncStatus(isSupabaseReady() ? "Receipts inbox ready." : "Local-only receipts mode on this device.", isSupabaseReady() ? "neutral" : "local", { persist: false });
  }
  resetForm();
  drawStats();
  drawTable();
  autoPopulateReceiptForm();
  await Promise.all([loadRemoteReceipts(), loadWebhookStatus()]);
  drawStats();
  drawTable();
  autoPopulateReceiptForm({ force: true });
})();


