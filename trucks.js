const auth = window.OPXAuth?.requireAuth("./login.html");
if (!auth) throw new Error("Authentication required");

if (!auth.can("accessCRM") || !auth.can("viewTrucks")) {
  document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>You do not have permission to access the Trucks page.</p></section></main>";
  throw new Error("No trucks access");
}

const KEY = "transport_crm_trucks";
const TRUCK_ATTACHMENTS_KEY = "transport_crm_truck_attachments";
const TRUCKS_SYNC_STATUS_KEY = "transport_crm_trucks_sync_status";
const TRUCKS_TABLE = "trucks";
const TRUCK_SYNC_RETRY_DELAYS_MS = [2000, 5000, 10000, 30000];
const TRUCK_ATTACHMENT_LIMIT = 5;
const TRUCK_ATTACHMENT_MAX_BYTES = 1.5 * 1024 * 1024;
const supabase = window.OPXSupabase?.client || null;
const useSupabase = Boolean(window.OPXSupabase?.isReady && supabase);
const REGO_NOTIFY_KEY = "transport_crm_rego_notify_state";
const REGO_ALERT_WINDOW_DAYS = 30;
const state = { trucks: readData() };
let truckAttachmentStore = readTruckAttachmentStore();
let truckSyncTimerId = 0;
let truckSearchTimerId = 0;
let truckRetryTimerId = 0;
let truckRetryAttempt = 0;
let truckSyncInFlight = false;
let truckSyncQueued = false;

function formatTrucksSyncTime(value = Date.now()) {
  return new Date(value).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

function formatTruckRetryDelay(ms) {
  if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

function readTrucksSyncStatus() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRUCKS_SYNC_STATUS_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function setTrucksSyncStatus(message, tone = "neutral", { at = Date.now(), persist = true } = {}) {
  const status = document.getElementById("trucksSyncStatus");
  if (!status) return;
  status.textContent = `${message} Last updated ${formatTrucksSyncTime(at)}.`;
  status.className = `sync-badge sync-badge-${tone}`;
  if (persist) {
    localStorage.setItem(TRUCKS_SYNC_STATUS_KEY, JSON.stringify({ message, tone, at }));
  }
  window.dispatchEvent(new CustomEvent("opx:sync-health-change", { detail: { source: "Trucks", message, tone, at } }));
  updateTrucksQueueBanner();
}

function restoreTrucksSyncStatus() {
  const saved = readTrucksSyncStatus();
  if (!saved?.message) return false;
  setTrucksSyncStatus(saved.message, saved.tone || "neutral", { at: saved.at || Date.now(), persist: false });
  return true;
}

function setTrucksQueueBanner(message = "", tone = "pending", visible = false) {
  const banner = document.getElementById("trucksQueueBanner");
  if (!banner) return;
  banner.hidden = !visible;
  if (!visible) {
    banner.textContent = "";
    banner.className = "queue-banner queue-banner-pending";
    return;
  }
  banner.textContent = message;
  banner.className = `queue-banner queue-banner-${tone}`;
}

function updateTrucksQueueBanner() {
  if (!useSupabase) {
    setTrucksQueueBanner("", "pending", false);
    return;
  }
  if (navigator.onLine === false) {
    setTrucksQueueBanner("Offline mode: truck updates are saving on this device and will sync automatically when internet returns.", "offline", true);
    return;
  }
  if (truckRetryAttempt || truckRetryTimerId || truckSyncQueued) {
    setTrucksQueueBanner("Sync queue active: truck changes are saved locally and retrying automatically in the background.", "pending", true);
    return;
  }
  setTrucksQueueBanner("", "pending", false);
}

function clearTruckSyncRetry(resetAttempt = true) {
  window.clearTimeout(truckRetryTimerId);
  truckRetryTimerId = 0;
  if (resetAttempt) truckRetryAttempt = 0;
}

function queueTruckSyncRetry(errorMessage = "") {
  if (!useSupabase) return;
  clearTruckSyncRetry(false);
  const delay = TRUCK_SYNC_RETRY_DELAYS_MS[Math.min(truckRetryAttempt, TRUCK_SYNC_RETRY_DELAYS_MS.length - 1)];
  truckRetryAttempt += 1;
  const waitingForInternet = navigator.onLine === false;
  const retryMessage = waitingForInternet
    ? "Saved here. Waiting for internet to retry shared truck sync."
    : `Saved here. Retrying shared truck sync in ${formatTruckRetryDelay(delay)}.`;
  const details = errorMessage ? ` ${errorMessage}` : "";
  setTrucksSyncStatus(`${retryMessage}${details}`, "error");
  truckRetryTimerId = window.setTimeout(() => {
    truckRetryTimerId = 0;
    scheduleTrucksSync(0);
  }, waitingForInternet ? Math.max(delay, 5000) : delay);
}

function normalizeSearchValue(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeTruckRecord(row) {
  return {
    id: row.id,
    truckNumber: String(row.truckNumber ?? "").trim(),
    registration: String(row.registration ?? "").trim(),
    model: String(row.model ?? "").trim(),
    capacity: Number(row.capacity || 0),
    serviceDueDate: String(row.serviceDueDate ?? ""),
    regoExpiryDate: String(row.regoExpiryDate ?? ""),
    status: String(row.status ?? ""),
    notes: String(row.notes ?? "").trim()
  };
}

function formatSearchDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "";
  const [year, month, day] = String(value).split("-");
  return `${day}/${month}/${year}`;
}

function buildTruckSearchHaystack(item) {
  return normalizeSearchValue([
    item.truckNumber,
    item.registration,
    item.model,
    item.capacity,
    item.serviceDueDate,
    formatSearchDate(item.serviceDueDate),
    item.regoExpiryDate,
    formatSearchDate(item.regoExpiryDate),
    item.status,
    item.notes || ""
  ].join(" "));
}

function getFilteredTrucks(query = normalizeSearchValue(document.getElementById("trucksSearch")?.value || "")) {
  return state.trucks.filter((item) => {
    if (!query) return true;
    return buildTruckSearchHaystack(item).includes(query);
  });
}

function findBestTruckMatch(query) {
  const normalized = normalizeSearchValue(query);
  if (!normalized) return null;

  const filtered = getFilteredTrucks(normalized);
  if (!filtered.length) return null;

  const exact = filtered.find((item) => normalizeSearchValue(item.truckNumber) === normalized)
    || filtered.find((item) => normalizeSearchValue(item.registration) === normalized);

  return exact || filtered[0];
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}${Math.random().toString(16).slice(2, 10)}`.slice(0, 32);
}

function ensureUuidTrucks(rows) {
  let changed = false;
  const normalized = rows.map((row) => {
    const next = normalizeTruckRecord({
      ...row,
      id: isUuid(row.id) ? row.id : newId()
    });
    if (!isUuid(row.id) || JSON.stringify(next) !== JSON.stringify(row)) {
      changed = true;
    }
    return next;
  });
  if (changed) {
    localStorage.setItem(KEY, JSON.stringify(normalized));
  }
  return normalized;
}

function readData() {
  try {
    return ensureUuidTrucks(JSON.parse(localStorage.getItem(KEY) || "[]"));
  } catch {
    return [];
  }
}

function readTruckAttachmentStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRUCK_ATTACHMENTS_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeTruckAttachmentStore() {
  localStorage.setItem(TRUCK_ATTACHMENTS_KEY, JSON.stringify(truckAttachmentStore));
}

function getTruckAttachments(recordId) {
  return Array.isArray(truckAttachmentStore?.[recordId]) ? truckAttachmentStore[recordId] : [];
}

function currentTruckRecordId() {
  return document.getElementById("truckDetailsId")?.value || "";
}

function ensureTruckDraftId() {
  const field = document.getElementById("truckDetailsId");
  if (!field) return "";
  if (!field.value) {
    field.value = uid();
  }
  return field.value;
}

function formatTruckAttachmentSize(bytes) {
  const size = Number(bytes || 0);
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function truckAttachmentCountLabel(count) {
  return count ? `${count} doc${count === 1 ? "" : "s"}` : "No docs";
}

function isSupportedTruckAttachment(file) {
  if (!file) return false;
  if (String(file.type || "").startsWith("image/")) return true;
  if (String(file.type || "").toLowerCase() === "application/pdf") return true;
  return /\.pdf$/i.test(String(file.name || ""));
}

function readTruckFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function setTruckAttachmentStatus(message = "", tone = "muted") {
  const status = document.getElementById("truckAttachmentsStatus");
  if (!status) return;
  status.textContent = message;
  status.className = `attachment-status ${tone}`.trim();
}

function drawTruckAttachments(recordId = currentTruckRecordId()) {
  const list = document.getElementById("truckAttachmentsList");
  if (!list) return;
  const attachments = getTruckAttachments(recordId);

  if (!recordId) {
    list.innerHTML = "<p class='muted'>Save or start a truck record, then attach rego, service, or compliance files.</p>";
    setTruckAttachmentStatus("Attachments stay available on this CRM browser profile.");
    return;
  }

  if (!attachments.length) {
    list.innerHTML = "<p class='muted'>No truck documents attached yet.</p>";
    setTruckAttachmentStatus(`Up to ${TRUCK_ATTACHMENT_LIMIT} files, max ${formatTruckAttachmentSize(TRUCK_ATTACHMENT_MAX_BYTES)} each.`);
    return;
  }

  list.innerHTML = attachments.map((attachment) => `
    <article class="attachment-card">
      <div>
        <strong>${attachment.name || "Document"}</strong>
        <span>${formatTruckAttachmentSize(attachment.size)} · ${attachment.type || "file"}</span>
      </div>
      <div class="contact-actions">
        <button type="button" class="contact-link contact-link-email" data-action="download-truck-attachment" data-truck-id="${recordId}" data-attachment-id="${attachment.id}">Open</button>
        <button type="button" class="contact-link contact-link-danger" data-action="remove-truck-attachment" data-truck-id="${recordId}" data-attachment-id="${attachment.id}">Remove</button>
      </div>
    </article>
  `).join("");
  setTruckAttachmentStatus(`${attachments.length}/${TRUCK_ATTACHMENT_LIMIT} documents saved for this truck.`);
}

async function addTruckAttachments(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const recordId = ensureTruckDraftId();
  const current = [...getTruckAttachments(recordId)];
  const messages = [];

  for (const file of files) {
    if (current.length >= TRUCK_ATTACHMENT_LIMIT) {
      messages.push(`Only ${TRUCK_ATTACHMENT_LIMIT} truck documents are allowed.`);
      break;
    }
    if (!isSupportedTruckAttachment(file)) {
      messages.push(`${file.name} skipped. Only PDF or image files are supported.`);
      continue;
    }
    if (Number(file.size || 0) > TRUCK_ATTACHMENT_MAX_BYTES) {
      messages.push(`${file.name} skipped. Files must be under ${formatTruckAttachmentSize(TRUCK_ATTACHMENT_MAX_BYTES)}.`);
      continue;
    }
    const dataUrl = await readTruckFileAsDataUrl(file);
    current.push({
      id: uid(),
      name: file.name || "Document",
      type: file.type || "application/octet-stream",
      size: Number(file.size || 0),
      dataUrl,
      uploadedAt: new Date().toISOString()
    });
  }

  truckAttachmentStore[recordId] = current;
  writeTruckAttachmentStore();
  drawTruckAttachments(recordId);
  setTruckAttachmentStatus(messages.length ? messages.join(" ") : `${current.length} truck document${current.length === 1 ? "" : "s"} ready.`);
  refresh();
}

function removeTruckAttachment(recordId, attachmentId) {
  const current = getTruckAttachments(recordId);
  if (!current.length) return;
  truckAttachmentStore[recordId] = current.filter((attachment) => attachment.id !== attachmentId);
  if (!truckAttachmentStore[recordId].length) {
    delete truckAttachmentStore[recordId];
  }
  writeTruckAttachmentStore();
  drawTruckAttachments(recordId);
  refresh();
}

function openTruckAttachment(recordId, attachmentId) {
  const attachment = getTruckAttachments(recordId).find((item) => item.id === attachmentId);
  if (!attachment?.dataUrl) return;
  const anchor = document.createElement("a");
  anchor.href = attachment.dataUrl;
  anchor.download = attachment.name || "truck-document";
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.click();
}

function saveData() {
  localStorage.setItem(KEY, JSON.stringify(state.trucks));
  if (useSupabase) {
    clearTruckSyncRetry(false);
    setTrucksSyncStatus("Syncing truck changes...", "syncing");
    scheduleTrucksSync();
  } else {
    setTrucksSyncStatus("Saved on this device only.", "local");
  }
}

function scheduleTrucksSync(delay = 300) {
  if (!useSupabase) return;
  window.clearTimeout(truckSyncTimerId);
  clearTruckSyncRetry(false);
  truckSyncTimerId = window.setTimeout(() => {
    truckSyncTimerId = 0;
    if (truckSyncInFlight) {
      truckSyncQueued = true;
      return;
    }
    void syncTrucksToSupabase();
  }, delay);
}

function scheduleTruckSearch() {
  window.clearTimeout(truckSearchTimerId);
  truckSearchTimerId = window.setTimeout(() => {
    truckSearchTimerId = 0;
    refresh();
    applyTruckSearch();
  }, 120);
}

function uid() {
  return newId();
}

function toDbTruck(item) {
  return {
    id: item.id,
    truck_number: item.truckNumber || "",
    registration: item.registration || "",
    model: item.model || "",
    capacity: Number(item.capacity || 0),
    service_due_date: item.serviceDueDate || null,
    rego_expiry_date: item.regoExpiryDate || null,
    status: item.status || "",
    notes: item.notes || ""
  };
}

function fromDbTruck(row) {
  return normalizeTruckRecord({
    id: row.id,
    truckNumber: row.truck_number || "",
    registration: row.registration || "",
    model: row.model || "",
    capacity: Number(row.capacity || 0),
    serviceDueDate: row.service_due_date || "",
    regoExpiryDate: row.rego_expiry_date || "",
    status: row.status || "",
    notes: row.notes || ""
  });
}

async function syncTrucksToSupabase() {
  if (!useSupabase || truckSyncInFlight) return false;
  truckSyncInFlight = true;
  const rows = state.trucks.map(toDbTruck);
  try {
    if (!rows.length) {
      const wipe = await supabase.from(TRUCKS_TABLE).delete().not("id", "is", null);
      if (wipe.error) {
        console.error("Supabase delete sync failed for trucks:", wipe.error.message);
        queueTruckSyncRetry(wipe.error.message);
        return false;
      }
      clearTruckSyncRetry();
      setTrucksSyncStatus("Truck changes saved and synced.", "live");
      return true;
    }

    const { error } = await supabase.from(TRUCKS_TABLE).upsert(rows, { onConflict: "id" });
    if (error) {
      console.error("Supabase sync failed for trucks:", error.message);
      queueTruckSyncRetry(error.message);
      return false;
    }

    const ids = rows.map((r) => r.id);
    const inList = `(${ids.map((id) => `"${String(id).replaceAll('"', "")}"`).join(",")})`;
    const cleanup = await supabase.from(TRUCKS_TABLE).delete().not("id", "in", inList);
    if (cleanup.error) {
      console.error("Supabase cleanup failed for trucks:", cleanup.error.message);
      queueTruckSyncRetry(cleanup.error.message);
      return false;
    }
    clearTruckSyncRetry();
    setTrucksSyncStatus("Truck changes saved and synced.", "live");
    return true;
  } finally {
    truckSyncInFlight = false;
    if (truckSyncQueued) {
      truckSyncQueued = false;
      scheduleTrucksSync(0);
    }
  }
}

async function hydrateTrucksFromSupabase() {
  if (!useSupabase) return;
  setTrucksSyncStatus("Checking shared truck data...", "syncing");
  const { data, error } = await supabase.from(TRUCKS_TABLE).select("*");
  if (error) {
    console.error("Supabase load failed for trucks:", error.message);
    setTrucksSyncStatus("Shared truck sync unavailable. Using this device's saved data.", "local");
    return;
  }
  if (!Array.isArray(data)) return;
  if (!data.length && state.trucks.length) {
    console.warn("Supabase trucks table is empty; keeping local data and seeding Supabase.");
    await syncTrucksToSupabase();
    setTrucksSyncStatus("Local truck data copied into shared storage.", "live");
    refresh();
    return;
  }
  state.trucks = data.map(fromDbTruck);
  localStorage.setItem(KEY, JSON.stringify(state.trucks));
  setTrucksSyncStatus("Shared truck data loaded.", "live");
  refresh();
}

function parseDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function todayDateOnly() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysUntil(dateValue) {
  const date = parseDateOnly(dateValue);
  if (!date) return null;
  const diffMs = date.getTime() - todayDateOnly().getTime();
  return Math.floor(diffMs / 86400000);
}

function buildRegoAlerts() {
  const overdue = [];
  const dueSoon = [];

  state.trucks.forEach((truck) => {
    const days = daysUntil(truck.regoExpiryDate);
    if (days == null) return;
    if (days < 0) {
      overdue.push({ truck, days });
      return;
    }
    if (days <= REGO_ALERT_WINDOW_DAYS) {
      dueSoon.push({ truck, days });
    }
  });

  overdue.sort((a, b) => a.days - b.days);
  dueSoon.sort((a, b) => a.days - b.days);
  return { overdue, dueSoon };
}

function readNotifyState() {
  try {
    return JSON.parse(localStorage.getItem(REGO_NOTIFY_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeNotifyState(value) {
  localStorage.setItem(REGO_NOTIFY_KEY, JSON.stringify(value));
}

function notificationSummary(overdueCount, dueSoonCount) {
  const parts = [];
  if (overdueCount) parts.push(`${overdueCount} overdue`);
  if (dueSoonCount) parts.push(`${dueSoonCount} due soon`);
  return parts.join(" | ");
}

function maybeSendRegoBrowserNotification(alerts) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const overdueCount = alerts.overdue.length;
  const dueSoonCount = alerts.dueSoon.length;
  if (!overdueCount && !dueSoonCount) return;

  const today = new Date().toISOString().slice(0, 10);
  const summary = notificationSummary(overdueCount, dueSoonCount);
  const notifyState = readNotifyState();

  if (notifyState.date === today && notifyState.summary === summary) return;

  const body = `${summary}. Open Trucks page to review registration dates.`;
  new Notification("Rego Expiry Alert", { body });
  writeNotifyState({ date: today, summary });
}

function drawRegoAlerts() {
  const meta = document.getElementById("regoAlertsMeta");
  const list = document.getElementById("regoAlertsList");
  const notifyBtn = document.getElementById("enableRegoNotifications");
  const alerts = buildRegoAlerts();

  if (!alerts.overdue.length && !alerts.dueSoon.length) {
    meta.textContent = `No rego alerts. No registrations due within ${REGO_ALERT_WINDOW_DAYS} days.`;
    list.innerHTML = "<p class='muted'>No trucks are close to rego expiry right now.</p>";
  } else {
    meta.textContent = `Rego alerts: ${alerts.overdue.length} overdue, ${alerts.dueSoon.length} due within ${REGO_ALERT_WINDOW_DAYS} days.`;
    const cards = [];

    alerts.overdue.forEach((entry) => {
      cards.push(`
        <article class="stat-card profit-negative">
          <p>Overdue</p>
          <h3>Truck ${entry.truck.truckNumber}</h3>
          <p>${entry.truck.registration} · ${entry.truck.model || "No model"}</p>
          <p>Expired ${Math.abs(entry.days)} day(s) ago on ${entry.truck.regoExpiryDate}</p>
        </article>
      `);
    });

    alerts.dueSoon.forEach((entry) => {
      cards.push(`
        <article class="stat-card profit-neutral">
          <p>Due Soon</p>
          <h3>Truck ${entry.truck.truckNumber}</h3>
          <p>${entry.truck.registration} · ${entry.truck.model || "No model"}</p>
          <p>Expires in ${entry.days} day(s) on ${entry.truck.regoExpiryDate}</p>
        </article>
      `);
    });

    list.innerHTML = `<div class="stats-grid">${cards.join("")}</div>`;
  }

  if (!notifyBtn) return;
  if (!("Notification" in window)) {
    notifyBtn.style.display = "none";
    return;
  }

  if (Notification.permission === "granted") {
    notifyBtn.textContent = "Browser Notifications Enabled";
    notifyBtn.disabled = true;
    maybeSendRegoBrowserNotification(alerts);
    return;
  }

  notifyBtn.textContent = "Enable Rego Notifications";
  notifyBtn.disabled = false;
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const body = rows.map((r) => headers.map((h) => esc(r[h])).join(",")).join("\n");
  return `${headers.join(",")}\n${body}`;
}

function drawStats() {
  const available = state.trucks.filter((t) => t.status === "Available").length;
  const repair = state.trucks.filter((t) => t.status === "Under Repair").length;
  const stats = [
    { label: "Total Trucks", value: String(state.trucks.length) },
    { label: "Available", value: String(available) },
    { label: "Under Repair", value: String(repair) }
  ];

  const grid = document.getElementById("trucksStats");
  if (!auth.can("viewStats")) {
    grid.style.display = "none";
    return;
  }

  grid.style.display = "grid";
  grid.innerHTML = stats.map((s) => `<article class='stat-card'><p>${s.label}</p><h3>${s.value}</h3></article>`).join("");
}

function drawTable() {
  const tbody = document.getElementById("trucksTableBody");
  const query = normalizeSearchValue(document.getElementById("trucksSearch")?.value || "");
  const filtered = getFilteredTrucks(query);

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan='8' class='empty'>${state.trucks.length ? "No trucks match this search." : "No trucks yet."}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .sort((a, b) => String(a.truckNumber || "").localeCompare(String(b.truckNumber || ""), undefined, { numeric: true, sensitivity: "base" }))
    .map((item) => {
      const regoDays = daysUntil(item.regoExpiryDate);
      const rowClass = regoDays == null ? "" : regoDays < 0 ? "row-rego-overdue" : regoDays <= REGO_ALERT_WINDOW_DAYS ? "row-rego-soon" : "";
      const attachmentCount = getTruckAttachments(item.id).length;
      return `<tr class='${rowClass}'><td>${item.truckNumber}<div class="attachment-summary">${attachmentCount ? `<span class="ack-chip ack-chip-neutral">${truckAttachmentCountLabel(attachmentCount)}</span>` : ""}</div></td><td>${item.registration}</td><td>${item.model}</td><td>${item.capacity}</td><td>${item.serviceDueDate}</td><td>${item.regoExpiryDate || ""}</td><td>${item.status}</td><td>${auth.can("editTrucks") ? `<div class='table-actions table-actions-stack'><button type='button' data-action='edit' data-id='${item.id}'>Edit</button><button type='button' data-action='delete' data-id='${item.id}'>Delete</button></div>` : "<span class='muted'>View only</span>"}</td></tr>`;
    })
    .join("");
}

function refresh() {
  truckAttachmentStore = readTruckAttachmentStore();
  drawStats();
  drawRegoAlerts();
  drawTable();
  updateInfoBar();
  drawTruckAttachments();
}

function updateInfoBar(message = "") {
  const info = document.getElementById("trucksInfo");
  const exportBtn = document.getElementById("exportTrucks");
  const query = normalizeSearchValue(document.getElementById("trucksSearch")?.value || "");
  const visibleCount = getFilteredTrucks(query).length;

  if (message) {
    info.textContent = message;
  } else if (query) {
    info.textContent = `${visibleCount} of ${state.trucks.length} truck record(s) match "${document.getElementById("trucksSearch").value.trim()}".`;
  } else {
    info.textContent = state.trucks.length ? `${state.trucks.length} truck record(s) saved.` : "No trucks saved yet.";
  }

  if (exportBtn) {
    exportBtn.disabled = state.trucks.length === 0;
  }
}

function setForm(item) {
  document.getElementById("truckDetailsId").value = item.id;
  document.getElementById("truckDetailsNumber").value = item.truckNumber;
  document.getElementById("truckRegistration").value = item.registration;
  document.getElementById("truckModel").value = item.model;
  document.getElementById("truckCapacity").value = item.capacity;
  document.getElementById("serviceDueDate").value = item.serviceDueDate;
  document.getElementById("regoExpiryDate").value = item.regoExpiryDate || "";
  document.getElementById("truckStatus").value = item.status;
  document.getElementById("truckNotes").value = item.notes || "";
  document.getElementById("truckDetailsNumber").focus();
  drawTruckAttachments(item.id);
}

function applyTruckSearch() {
  const query = normalizeSearchValue(document.getElementById("trucksSearch")?.value || "");
  if (!query) {
    updateInfoBar();
    return;
  }

  const bestMatch = findBestTruckMatch(query);
  if (!bestMatch) {
    updateInfoBar(`No truck found for "${document.getElementById("trucksSearch").value.trim()}".`);
    return;
  }

  setForm(bestMatch);
  const visibleCount = getFilteredTrucks(query).length;
  updateInfoBar(`Loaded truck ${bestMatch.truckNumber} from search${visibleCount > 1 ? ` (${visibleCount} matches)` : ""}.`);
}

function applyAccessControl() {
  document.getElementById("currentUserChip").textContent = `User: ${auth.user.username}`;
  if (!auth.can("accessControlPanel")) document.getElementById("controlPanelLink").style.display = "none";
  if (!auth.can("viewReports")) {
    const reportsLink = document.getElementById("reportsLink");
    if (reportsLink) reportsLink.style.display = "none";
  }

  if (!auth.can("accessLogs")) {
    document.querySelector("a[href='./log.html']").style.display = "none";
  }

  if (!auth.can("viewRoster")) {
    const rosterLink = document.getElementById("rosterLink");
    if (rosterLink) rosterLink.style.display = "none";
  }

  if (!(auth.can("viewTruckIncome") || auth.can("viewSpending") || auth.can("viewPayslips") || auth.can("viewStats"))) {
    const financeLink = document.getElementById("financeLink");
    if (financeLink) financeLink.style.display = "none";
  }

  if (!auth.can("editTrucks")) {
    const form = document.getElementById("trucksForm");
    Array.from(form.elements).forEach((element) => {
      if (element.type !== "hidden") element.disabled = true;
    });
    document.getElementById("exportTrucks").style.display = "none";
  }
}

document.getElementById("logoutBtn").addEventListener("click", () => {
  window.OPXAuth.logout();
  window.location.href = "./login.html";
});

document.getElementById("trucksForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!auth.can("editTrucks")) return;

  const id = document.getElementById("truckDetailsId").value;
  const payload = {
    id: id || uid(),
    truckNumber: document.getElementById("truckDetailsNumber").value.trim(),
    registration: document.getElementById("truckRegistration").value.trim(),
    model: document.getElementById("truckModel").value.trim(),
    capacity: Number(document.getElementById("truckCapacity").value),
    serviceDueDate: document.getElementById("serviceDueDate").value,
    regoExpiryDate: document.getElementById("regoExpiryDate").value,
    status: document.getElementById("truckStatus").value,
    notes: document.getElementById("truckNotes").value.trim()
  };

  state.trucks = id ? state.trucks.map((t) => t.id === id ? payload : t) : [...state.trucks, payload];
  saveData();
  e.target.reset();
  document.getElementById("truckDetailsId").value = "";
  updateInfoBar("Truck record saved.");
  refresh();
});

document.getElementById("cancelTruckEdit").addEventListener("click", () => {
  const draftId = document.getElementById("truckDetailsId").value;
  if (draftId && !state.trucks.some((truck) => truck.id === draftId) && truckAttachmentStore[draftId]) {
    delete truckAttachmentStore[draftId];
    writeTruckAttachmentStore();
  }
  document.getElementById("trucksForm").reset();
  document.getElementById("truckDetailsId").value = "";
  const fileInput = document.getElementById("truckAttachmentsInput");
  if (fileInput) fileInput.value = "";
  drawTruckAttachments("");
  updateInfoBar();
});

document.getElementById("exportTrucks").addEventListener("click", () => {
  if (!auth.can("editTrucks")) return;
  const csv = toCsv(state.trucks);
  if (!csv) return alert("No saved trucks yet. Click 'Save Truck' first.");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "trucks.csv";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("trucksSearch").addEventListener("input", scheduleTruckSearch);
document.getElementById("trucksSearch").addEventListener("search", scheduleTruckSearch);
document.getElementById("trucksSearch").addEventListener("change", scheduleTruckSearch);
document.getElementById("clearTrucksFilters").addEventListener("click", () => {
  const draftId = document.getElementById("truckDetailsId").value;
  if (draftId && !state.trucks.some((truck) => truck.id === draftId) && truckAttachmentStore[draftId]) {
    delete truckAttachmentStore[draftId];
    writeTruckAttachmentStore();
  }
  document.getElementById("trucksSearch").value = "";
  document.getElementById("trucksForm").reset();
  document.getElementById("truckDetailsId").value = "";
  const fileInput = document.getElementById("truckAttachmentsInput");
  if (fileInput) fileInput.value = "";
  refresh();
});

document.getElementById("truckAttachmentsInput")?.addEventListener("change", async (event) => {
  const input = event.target;
  try {
    await addTruckAttachments(input.files);
  } catch (error) {
    console.error("Truck attachment add failed:", error);
    setTruckAttachmentStatus(error.message || "Could not add the selected truck document.", "error-text");
  } finally {
    input.value = "";
  }
});

document.getElementById("enableRegoNotifications").addEventListener("click", async () => {
  if (!("Notification" in window)) {
    alert("Browser notifications are not supported on this browser.");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    alert("Notification permission was not granted.");
  }
  refresh();
});

document.body.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button) return;

  if (button.dataset.action === "download-truck-attachment") {
    openTruckAttachment(button.dataset.truckId || "", button.dataset.attachmentId || "");
    return;
  }

  if (button.dataset.action === "remove-truck-attachment") {
    if (!auth.can("editTrucks")) return;
    removeTruckAttachment(button.dataset.truckId || "", button.dataset.attachmentId || "");
    return;
  }

  if (!auth.can("editTrucks")) return;

  const { action, id } = button.dataset;
  if (action === "edit") {
    const item = state.trucks.find((t) => t.id === id);
    if (item) {
      setForm(item);
      updateInfoBar(`Editing truck ${item.truckNumber}.`);
    }
    return;
  }

  if (action === "delete") {
    const truck = state.trucks.find((t) => t.id === id);
    if (!truck) return;
    if (!window.confirm(`Delete truck ${truck.truckNumber}?`)) return;
    state.trucks = state.trucks.filter((t) => t.id !== id);
    if (truckAttachmentStore[id]) {
      delete truckAttachmentStore[id];
      writeTruckAttachmentStore();
    }
    saveData();
    document.getElementById("truckDetailsId").value = "";
    refresh();
    updateInfoBar(`Deleted truck ${truck.truckNumber}.`);
  }
});

applyAccessControl();
refresh();
if (!restoreTrucksSyncStatus()) {
  setTrucksSyncStatus(useSupabase ? "Shared truck sync ready." : "Local-only mode on this device.", useSupabase ? "neutral" : "local", { persist: false });
}
void hydrateTrucksFromSupabase();

if (!useSupabase) {
  window.addEventListener("opx:supabase-ready", () => {
    window.location.reload();
  }, { once: true });
}

window.addEventListener("storage", (event) => {
  if (event.key === TRUCK_ATTACHMENTS_KEY) {
    truckAttachmentStore = readTruckAttachmentStore();
    drawTruckAttachments();
    drawTable();
    return;
  }
  if (event.key !== KEY) return;
  state.trucks = readData();
  setTrucksSyncStatus("Truck data updated in another tab.", "neutral");
  refresh();
});

window.addEventListener("offline", updateTrucksQueueBanner);

window.addEventListener("online", () => {
  if (!useSupabase) return;
  if (truckRetryAttempt || truckRetryTimerId) {
    clearTruckSyncRetry(false);
    setTrucksSyncStatus("Back online. Retrying shared truck sync...", "syncing");
    scheduleTrucksSync(0);
    return;
  }
  updateTrucksQueueBanner();
});

