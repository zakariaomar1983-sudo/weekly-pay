const auth = window.OPXAuth?.requireAuth("./login.html");
if (!auth) throw new Error("Authentication required");

if (!auth.can("accessCRM") || !auth.can("viewDrivers")) {
  document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>You do not have permission to access the Drivers page.</p></section></main>";
  throw new Error("No drivers access");
}

const KEY = "transport_crm_drivers";
const LEGACY_CONTACT_KEY = "transport_crm_driver_contacts";
const DRIVER_ATTACHMENTS_KEY = "transport_crm_driver_attachments";
const DRIVERS_SYNC_STATUS_KEY = "transport_crm_drivers_sync_status";
const DRIVERS_UPDATED_KEY = "transport_crm_drivers_updated_at";
const DRIVERS_TABLE = "drivers";
const EXCLUDED_DRIVER_NAMES = new Set();
const REQUIRED_DRIVER_NAMES = ["Muhammed A H Siyad", "Faaid Warsame"];
const DRIVER_SYNC_RETRY_DELAYS_MS = [2000, 5000, 10000, 30000];
const DRIVER_ATTACHMENT_LIMIT = 5;
const DRIVER_ATTACHMENT_MAX_BYTES = 1.5 * 1024 * 1024;
const driversSupabase = window.OPXSupabase?.client || null;
const useSupabase = Boolean(window.OPXSupabase?.isReady && driversSupabase);
const legacyContacts = readLegacyContacts();
const state = { drivers: readData() };
let driverAttachmentStore = readDriverAttachmentStore();
let driverSyncTimerId = 0;
let driverSearchTimerId = 0;
let driverRetryTimerId = 0;
let driverRetryAttempt = 0;
let driverSyncInFlight = false;
let driverSyncQueued = false;
const driversChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("opx-drivers") : null;

function formatDriversSyncTime(value = Date.now()) {
  return new Date(value).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

function formatDriverRetryDelay(ms) {
  if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

function readDriversSyncStatus() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DRIVERS_SYNC_STATUS_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function setDriversSyncStatus(message, tone = "neutral", { at = Date.now(), persist = true } = {}) {
  const status = document.getElementById("driversSyncStatus");
  if (!status) return;
  status.textContent = `${message} Last updated ${formatDriversSyncTime(at)}.`;
  status.className = `sync-badge sync-badge-${tone}`;
  if (persist) {
    localStorage.setItem(DRIVERS_SYNC_STATUS_KEY, JSON.stringify({ message, tone, at }));
  }
  window.dispatchEvent(new CustomEvent("opx:sync-health-change", { detail: { source: "Drivers", message, tone, at } }));
  updateDriversQueueBanner();
}

function restoreDriversSyncStatus() {
  const saved = readDriversSyncStatus();
  if (!saved?.message) return false;
  setDriversSyncStatus(saved.message, saved.tone || "neutral", { at: saved.at || Date.now(), persist: false });
  return true;
}

function setDriversQueueBanner(message = "", tone = "pending", visible = false) {
  const banner = document.getElementById("driversQueueBanner");
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

function updateDriversQueueBanner() {
  if (!useSupabase) {
    setDriversQueueBanner("", "pending", false);
    return;
  }
  if (navigator.onLine === false) {
    setDriversQueueBanner("Offline mode: driver changes are saving on this device and will sync automatically when internet returns.", "offline", true);
    return;
  }
  if (driverRetryAttempt || driverRetryTimerId || driverSyncQueued) {
    setDriversQueueBanner("Sync queue active: driver changes are saved locally and retrying automatically in the background.", "pending", true);
    return;
  }
  setDriversQueueBanner("", "pending", false);
}

function clearDriverSyncRetry(resetAttempt = true) {
  window.clearTimeout(driverRetryTimerId);
  driverRetryTimerId = 0;
  if (resetAttempt) driverRetryAttempt = 0;
}

function queueDriverSyncRetry(errorMessage = "") {
  if (!useSupabase) return;
  clearDriverSyncRetry(false);
  const delay = DRIVER_SYNC_RETRY_DELAYS_MS[Math.min(driverRetryAttempt, DRIVER_SYNC_RETRY_DELAYS_MS.length - 1)];
  driverRetryAttempt += 1;
  const waitingForInternet = navigator.onLine === false;
  const retryMessage = waitingForInternet
    ? "Saved here. Waiting for internet to retry shared driver sync."
    : `Saved here. Retrying shared driver sync in ${formatDriverRetryDelay(delay)}.`;
  const details = errorMessage ? ` ${errorMessage}` : "";
  setDriversSyncStatus(`${retryMessage}${details}`, "error");
  driverRetryTimerId = window.setTimeout(() => {
    driverRetryTimerId = 0;
    scheduleDriversSync(0);
  }, waitingForInternet ? Math.max(delay, 5000) : delay);
}

function canManageDrivers() {
  return auth.can("viewDrivers");
}

function normalizeDriverNameKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isExcludedDriverName(name) {
  return EXCLUDED_DRIVER_NAMES.has(normalizeDriverNameKey(name));
}

function filterExcludedDrivers(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => !isExcludedDriverName(row?.name));
}

function firstValue(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function normalizeDriverRow(row) {
  const raw = row && typeof row === "object" ? row : {};
  return {
    ...raw,
    id: String(firstValue(raw, ["id", "driverId", "driver_id"]) || ""),
    name: String(firstValue(raw, ["name", "driverName", "driver", "fullName", "driver_name"]) || ""),
    phone: String(firstValue(raw, ["phone", "mobile", "phoneNumber", "phone_number", "contactNumber"]) || ""),
    email: String(firstValue(raw, ["email", "emailAddress", "email_address"]) || ""),
    licenseNumber: String(firstValue(raw, ["licenseNumber", "licenceNumber", "license", "licence", "license_number"]) || ""),
    licenseExpiry: String(firstValue(raw, ["licenseExpiry", "licenceExpiry", "license_expiry", "licence_expiry"]) || ""),
    hireDate: String(firstValue(raw, ["hireDate", "startDate", "hire_date", "start_date"]) || ""),
    status: String(firstValue(raw, ["status", "driverStatus", "driver_status"]) || "Active"),
    address: String(firstValue(raw, ["address", "homeAddress", "home_address"]) || ""),
    emergencyContact: String(firstValue(raw, ["emergencyContact", "emergency", "nextOfKin", "emergency_contact"]) || "")
  };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}${Math.random().toString(16).slice(2, 10)}`.slice(0, 32);
}

function ensureUuidDrivers(rows) {
  let changed = false;
  const normalized = rows.map((row) => {
    if (isUuid(row.id)) return row;
    changed = true;
    return { ...row, id: newId() };
  });
  if (changed) {
    localStorage.setItem(KEY, JSON.stringify(normalized));
  }
  return normalized;
}

function readLegacyContacts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_CONTACT_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readDriverAttachmentStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DRIVER_ATTACHMENTS_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeDriverAttachmentStore() {
  localStorage.setItem(DRIVER_ATTACHMENTS_KEY, JSON.stringify(driverAttachmentStore));
}

function getDriverAttachments(recordId) {
  return Array.isArray(driverAttachmentStore?.[recordId]) ? driverAttachmentStore[recordId] : [];
}

function currentDriverRecordId() {
  return document.getElementById("driverDetailsId")?.value || "";
}

function ensureDriverDraftId() {
  const field = document.getElementById("driverDetailsId");
  if (!field) return "";
  if (!field.value) {
    field.value = uid();
  }
  return field.value;
}

function formatAttachmentSize(bytes) {
  const size = Number(bytes || 0);
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function attachmentCountLabel(count) {
  return count ? `${count} doc${count === 1 ? "" : "s"}` : "No docs";
}

function isSupportedDriverAttachment(file) {
  if (!file) return false;
  if (String(file.type || "").startsWith("image/")) return true;
  if (String(file.type || "").toLowerCase() === "application/pdf") return true;
  return /\.pdf$/i.test(String(file.name || ""));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function setDriverAttachmentStatus(message = "", tone = "muted") {
  const status = document.getElementById("driverAttachmentsStatus");
  if (!status) return;
  status.textContent = message;
  status.className = `attachment-status ${tone}`.trim();
}

function drawDriverAttachments(recordId = currentDriverRecordId()) {
  const list = document.getElementById("driverAttachmentsList");
  if (!list) return;
  const attachments = getDriverAttachments(recordId);

  if (!recordId) {
    list.innerHTML = "<p class='muted'>Save or start a driver record, then attach licence, ID, or contract files.</p>";
    setDriverAttachmentStatus("Attachments stay available on this CRM browser profile.");
    return;
  }

  if (!attachments.length) {
    list.innerHTML = "<p class='muted'>No driver documents attached yet.</p>";
    setDriverAttachmentStatus(`Up to ${DRIVER_ATTACHMENT_LIMIT} files, max ${formatAttachmentSize(DRIVER_ATTACHMENT_MAX_BYTES)} each.`);
    return;
  }

  list.innerHTML = attachments.map((attachment) => `
    <article class="attachment-card">
      <div>
        <strong>${attachment.name || "Document"}</strong>
        <span>${formatAttachmentSize(attachment.size)} · ${attachment.type || "file"}</span>
      </div>
      <div class="contact-actions">
        <button type="button" class="contact-link contact-link-email" data-action="download-driver-attachment" data-driver-id="${recordId}" data-attachment-id="${attachment.id}">Open</button>
        <button type="button" class="contact-link contact-link-danger" data-action="remove-driver-attachment" data-driver-id="${recordId}" data-attachment-id="${attachment.id}">Remove</button>
      </div>
    </article>
  `).join("");
  setDriverAttachmentStatus(`${attachments.length}/${DRIVER_ATTACHMENT_LIMIT} documents saved for this driver.`);
}

async function addDriverAttachments(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const recordId = ensureDriverDraftId();
  const current = [...getDriverAttachments(recordId)];
  const messages = [];

  for (const file of files) {
    if (current.length >= DRIVER_ATTACHMENT_LIMIT) {
      messages.push(`Only ${DRIVER_ATTACHMENT_LIMIT} driver documents are allowed.`);
      break;
    }
    if (!isSupportedDriverAttachment(file)) {
      messages.push(`${file.name} skipped. Only PDF or image files are supported.`);
      continue;
    }
    if (Number(file.size || 0) > DRIVER_ATTACHMENT_MAX_BYTES) {
      messages.push(`${file.name} skipped. Files must be under ${formatAttachmentSize(DRIVER_ATTACHMENT_MAX_BYTES)}.`);
      continue;
    }
    const dataUrl = await readFileAsDataUrl(file);
    current.push({
      id: uid(),
      name: file.name || "Document",
      type: file.type || "application/octet-stream",
      size: Number(file.size || 0),
      dataUrl,
      uploadedAt: new Date().toISOString()
    });
  }

  driverAttachmentStore[recordId] = current;
  writeDriverAttachmentStore();
  drawDriverAttachments(recordId);
  setDriverAttachmentStatus(messages.length ? messages.join(" ") : `${current.length} driver document${current.length === 1 ? "" : "s"} ready.`);
  refresh();
}

function removeDriverAttachment(recordId, attachmentId) {
  const current = getDriverAttachments(recordId);
  if (!current.length) return;
  driverAttachmentStore[recordId] = current.filter((attachment) => attachment.id !== attachmentId);
  if (!driverAttachmentStore[recordId].length) {
    delete driverAttachmentStore[recordId];
  }
  writeDriverAttachmentStore();
  drawDriverAttachments(recordId);
  refresh();
}

function openDriverAttachment(recordId, attachmentId) {
  const attachment = getDriverAttachments(recordId).find((item) => item.id === attachmentId);
  if (!attachment?.dataUrl) return;
  const anchor = document.createElement("a");
  anchor.href = attachment.dataUrl;
  anchor.download = attachment.name || "driver-document";
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.click();
}

function readData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    const rows = Array.isArray(parsed) ? parsed.map(normalizeDriverRow) : [];
    const mergedRows = mergeLegacyEmails(ensureUuidDrivers(rows)).rows;
    const withRequired = ensureRequiredDrivers(mergedRows);
    const filteredRows = filterExcludedDrivers(withRequired.rows);
    if (filteredRows.length !== withRequired.rows.length || withRequired.changed) {
      localStorage.setItem(KEY, JSON.stringify(filteredRows));
    }
    return filteredRows;
  } catch {
    return [];
  }
}

function mergeLegacyEmails(rows) {
  let changed = false;
  const merged = rows.map((row) => {
    const legacyEmail = String(legacyContacts?.[row.id]?.email || "").trim();
    if (row.email || !legacyEmail) return row;
    changed = true;
    return { ...row, email: legacyEmail };
  });
  return { rows: merged, changed };
}

function ensureRequiredDrivers(rows) {
  const list = Array.isArray(rows) ? [...rows] : [];
  const byName = new Set(list.map((row) => normalizeDriverNameKey(row.name)));
  let changed = false;

  REQUIRED_DRIVER_NAMES.forEach((name) => {
    const key = normalizeDriverNameKey(name);
    if (!key || byName.has(key)) return;
    list.push({
      id: newId(),
      name,
      phone: "",
      email: "",
      licenseNumber: "",
      licenseExpiry: "",
      hireDate: "",
      status: "Active",
      address: "",
      emergencyContact: ""
    });
    changed = true;
  });

  return { rows: list, changed };
}

function cleanupLegacyContactsForRows(rows) {
  let changed = false;
  rows.forEach((row) => {
    if (legacyContacts[row.id]) {
      delete legacyContacts[row.id];
      changed = true;
    }
  });
  if (changed) {
    localStorage.setItem(LEGACY_CONTACT_KEY, JSON.stringify(legacyContacts));
  }
}

function saveData() {
  localStorage.setItem(KEY, JSON.stringify(state.drivers));
  const updatedAt = String(Date.now());
  localStorage.setItem(DRIVERS_UPDATED_KEY, updatedAt);
  window.dispatchEvent(new CustomEvent("opx:drivers-updated", { detail: { updatedAt } }));
  try {
    driversChannel?.postMessage({ type: "drivers-updated", updatedAt });
  } catch {
    // no-op
  }
  cleanupLegacyContactsForRows(state.drivers.filter((row) => row.email));
  if (useSupabase) {
    clearDriverSyncRetry(false);
    setDriversSyncStatus("Syncing driver changes...", "syncing");
    scheduleDriversSync();
  } else {
    setDriversSyncStatus("Saved on this device only.", "local");
  }
}

function scheduleDriversSync(delay = 300) {
  if (!useSupabase) return;
  window.clearTimeout(driverSyncTimerId);
  clearDriverSyncRetry(false);
  driverSyncTimerId = window.setTimeout(() => {
    driverSyncTimerId = 0;
    if (driverSyncInFlight) {
      driverSyncQueued = true;
      return;
    }
    void syncDriversToSupabase();
  }, delay);
}

function scheduleDriversRefresh() {
  window.clearTimeout(driverSearchTimerId);
  driverSearchTimerId = window.setTimeout(() => {
    driverSearchTimerId = 0;
    refresh();
  }, 120);
}

function uid() {
  return newId();
}

function cleanPhone(phone) {
  return String(phone || "").replace(/[^\d+]/g, "").trim();
}

function toWhatsAppNumber(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 10) {
    digits = `61${digits.slice(1)}`;
  }
  return digits;
}

function launchLink(url, target = "_blank") {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = target;
  anchor.rel = "noopener noreferrer";
  anchor.click();
}

function openDriverContact(channel, item) {
  const email = String(item.email || "").trim();
  const phone = cleanPhone(item.phone);
  const message = `Hi ${item.name}, this is Onpoint Express.`;

  if (channel === "email") {
    if (!email) {
      alert(`No email saved for ${item.name} yet.`);
      return;
    }
    const subject = encodeURIComponent(`Onpoint Express update for ${item.name}`);
    const body = encodeURIComponent(`${message}\n\nPlease reply when you can.`);
    launchLink(`mailto:${email}?subject=${subject}&body=${body}`, "_self");
    return;
  }

  if (!phone) {
    alert(`No phone number saved for ${item.name} yet.`);
    return;
  }

  if (channel === "sms") {
    launchLink(`sms:${phone}?body=${encodeURIComponent(message)}`, "_self");
    return;
  }

  if (channel === "whatsapp") {
    const whatsappNumber = toWhatsAppNumber(phone);
    if (!whatsappNumber) {
      alert(`WhatsApp number is not valid for ${item.name}.`);
      return;
    }
    launchLink(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`);
  }
}

function renderContactButtons(item) {
  const email = String(item.email || "").trim();
  const hasPhone = Boolean(cleanPhone(item.phone));
  return `<div class='contact-actions'>
    <button type='button' class='contact-link contact-link-email' data-action='email-driver' data-id='${item.id}' ${email ? "" : "disabled"}>Email</button>
    <button type='button' class='contact-link contact-link-sms' data-action='sms-driver' data-id='${item.id}' ${hasPhone ? "" : "disabled"}>SMS</button>
    <button type='button' class='contact-link contact-link-whatsapp' data-action='whatsapp-driver' data-id='${item.id}' ${hasPhone ? "" : "disabled"}>WhatsApp</button>
  </div>`;
}

function toDbDriver(item) {
  return {
    id: item.id,
    name: item.name || "",
    phone: item.phone || "",
    email: item.email || "",
    license_number: item.licenseNumber || "",
    license_expiry: item.licenseExpiry || null,
    hire_date: item.hireDate || null,
    status: item.status || "",
    address: item.address || "",
    emergency_contact: item.emergencyContact || ""
  };
}

function fromDbDriver(row) {
  return {
    id: row.id,
    name: row.name || "",
    phone: row.phone || "",
    email: row.email || "",
    licenseNumber: row.license_number || "",
    licenseExpiry: row.license_expiry || "",
    hireDate: row.hire_date || "",
    status: row.status || "",
    address: row.address || "",
    emergencyContact: row.emergency_contact || ""
  };
}

async function syncDriversToSupabase() {
  if (!useSupabase || driverSyncInFlight) return false;
  driverSyncInFlight = true;
  const rows = state.drivers.map(toDbDriver);
  try {
    if (!rows.length) {
      const wipe = await driversSupabase.from(DRIVERS_TABLE).delete().not("id", "is", null);
      if (wipe.error) {
        console.error("Supabase delete sync failed for drivers:", wipe.error.message);
        queueDriverSyncRetry(wipe.error.message);
        return false;
      }
      clearDriverSyncRetry();
      setDriversSyncStatus("Driver changes saved and synced.", "live");
      return true;
    }

    const { error } = await driversSupabase.from(DRIVERS_TABLE).upsert(rows, { onConflict: "id" });
    if (error) {
      console.error("Supabase sync failed for drivers:", error.message);
      queueDriverSyncRetry(error.message);
      return false;
    }

    const ids = rows.map((r) => r.id);
    const inList = `(${ids.map((id) => `"${String(id).replaceAll('"', "")}"`).join(",")})`;
    const cleanup = await driversSupabase.from(DRIVERS_TABLE).delete().not("id", "in", inList);
    if (cleanup.error) {
      console.error("Supabase cleanup failed for drivers:", cleanup.error.message);
      queueDriverSyncRetry(cleanup.error.message);
      return false;
    }
    clearDriverSyncRetry();
    setDriversSyncStatus("Driver changes saved and synced.", "live");
    return true;
  } finally {
    driverSyncInFlight = false;
    if (driverSyncQueued) {
      driverSyncQueued = false;
      scheduleDriversSync(0);
    }
  }
}

async function hydrateDriversFromSupabase() {
  if (!useSupabase) return;
  setDriversSyncStatus("Checking shared driver data...", "syncing");
  updateDataStatus("Checking shared driver data...");
  const { data, error } = await driversSupabase.from(DRIVERS_TABLE).select("*");
  if (error) {
    console.error("Supabase load failed for drivers:", error.message);
    updateDataStatus(`Shared driver data could not load: ${error.message}. Showing this device's saved driver data.`);
    setDriversSyncStatus("Shared driver sync unavailable. Using this device's saved data.", "local");
    return;
  }
  if (!Array.isArray(data)) return;
  if (!data.length && state.drivers.length) {
    console.warn("Supabase drivers table is empty; keeping local data and seeding Supabase.");
    await syncDriversToSupabase();
    setDriversSyncStatus("Local driver data copied into shared storage.", "live");
    refresh();
    return;
  }

  const merged = mergeLegacyEmails(data.map(fromDbDriver));
  const withRequired = ensureRequiredDrivers(merged.rows);
  const filteredRows = filterExcludedDrivers(withRequired.rows);
  const removedExcluded = filteredRows.length !== withRequired.rows.length;
  state.drivers = filteredRows;
  localStorage.setItem(KEY, JSON.stringify(state.drivers));
  cleanupLegacyContactsForRows(state.drivers.filter((row) => row.email));
  if (merged.changed || withRequired.changed || removedExcluded) {
    await syncDriversToSupabase();
  }
  setDriversSyncStatus("Shared driver data loaded.", "live");
  refresh();
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const body = rows.map((r) => headers.map((h) => esc(r[h])).join(",")).join("\n");
  return `${headers.join(",")}\n${body}`;
}

function drawStats() {
  const active = state.drivers.filter((d) => d.status === "Active").length;
  const onLeave = state.drivers.filter((d) => d.status === "On Leave").length;
  const stats = [
    { label: "Total Drivers", value: String(state.drivers.length) },
    { label: "Active", value: String(active) },
    { label: "On Leave", value: String(onLeave) }
  ];

  const grid = document.getElementById("driversStats");
  if (!auth.can("viewStats")) {
    grid.style.display = "none";
    return;
  }

  grid.style.display = "grid";
  grid.innerHTML = stats.map((s) => `<article class='stat-card'><p>${s.label}</p><h3>${s.value}</h3></article>`).join("");
}

function drawTable() {
  const tbody = document.getElementById("driversTableBody");
  const query = (document.getElementById("driversSearch")?.value || "").trim().toLowerCase();
  const filtered = state.drivers.filter((item) => {
    if (!query) return true;
    const hay = Object.values(item).concat([
      item.name,
      item.phone,
      item.email,
      item.licenseNumber,
      item.licenseExpiry,
      item.hireDate,
      item.status,
      item.address,
      item.emergencyContact
    ]).join(" ").toLowerCase();
    return hay.includes(query);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan='6' class='empty'>${query ? "No drivers match your search." : "No drivers yet."}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    .map((item) => {
      const adminActions = canManageDrivers()
        ? `<div class='table-actions'><button data-action='edit' data-id='${item.id}'>Edit</button><button data-action='delete' data-id='${item.id}'>Delete</button></div>`
        : "<span class='muted'>View only</span>";
      const attachmentCount = getDriverAttachments(item.id).length;
      return `<tr><td><strong>${item.name || "Unnamed driver"}</strong><div class="attachment-summary">${attachmentCount ? `<span class="ack-chip ack-chip-neutral">${attachmentCountLabel(attachmentCount)}</span>` : ""}</div><div class='table-actions table-actions-stack'>${renderContactButtons(item)}${adminActions}</div></td><td>${item.phone || "-"}</td><td>${item.email || "-"}</td><td>${item.licenseNumber || "-"}</td><td>${item.status || "-"}</td><td>${item.emergencyContact || "-"}</td></tr>`;
    })
    .join("");
}

function refresh() {
  state.drivers = readData();
  driverAttachmentStore = readDriverAttachmentStore();
  drawStats();
  drawTable();
  updateDataStatus(null, getFilteredDriverCount());
  drawDriverAttachments();
}

function getFilteredDriverCount() {
  const query = (document.getElementById("driversSearch")?.value || "").trim().toLowerCase();
  if (!query) return state.drivers.length;
  return state.drivers.filter((item) => Object.values(item).join(" ").toLowerCase().includes(query)).length;
}

function updateDataStatus(message, visibleCount = state.drivers.length) {
  const status = document.getElementById("driversDataStatus");
  if (!status) return;
  const query = (document.getElementById("driversSearch")?.value || "").trim();
  if (message) {
    status.textContent = message;
    return;
  }
  status.textContent = query
    ? `Search is active. Showing ${visibleCount} of ${state.drivers.length} driver record${state.drivers.length === 1 ? "" : "s"}.`
    : `Loaded ${state.drivers.length} driver record${state.drivers.length === 1 ? "" : "s"}. Edit and Delete are under each driver's name.`;
}

function setForm(item) {
  document.getElementById("driverDetailsId").value = item.id;
  document.getElementById("driverDetailsName").value = item.name;
  document.getElementById("driverPhone").value = item.phone;
  document.getElementById("driverEmail").value = item.email || "";
  document.getElementById("licenseNumber").value = item.licenseNumber;
  document.getElementById("licenseExpiry").value = item.licenseExpiry;
  document.getElementById("hireDate").value = item.hireDate;
  document.getElementById("driverStatus").value = item.status;
  document.getElementById("driverAddress").value = item.address || "";
  document.getElementById("emergencyContact").value = item.emergencyContact || "";
  drawDriverAttachments(item.id);
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
  if (!(auth.can("viewSpending") || auth.can("editSpending") || auth.can("accessControlPanel"))) {
    const receiptsLink = document.getElementById("receiptsLink");
    if (receiptsLink) receiptsLink.style.display = "none";
  }

  if (!canManageDrivers()) {
    const form = document.getElementById("driversForm");
    Array.from(form.elements).forEach((element) => {
      if (element.type !== "hidden") element.disabled = true;
    });
    document.getElementById("exportDrivers").style.display = "none";
  }
}

document.getElementById("logoutBtn").addEventListener("click", () => {
  window.OPXAuth.logout();
  window.location.href = "./login.html";
});

document.getElementById("driversForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!canManageDrivers()) return;

  const id = document.getElementById("driverDetailsId").value;
  const payload = {
    id: id || uid(),
    name: document.getElementById("driverDetailsName").value.trim(),
    phone: document.getElementById("driverPhone").value.trim(),
    email: document.getElementById("driverEmail").value.trim(),
    licenseNumber: document.getElementById("licenseNumber").value.trim(),
    licenseExpiry: document.getElementById("licenseExpiry").value,
    hireDate: document.getElementById("hireDate").value,
    status: document.getElementById("driverStatus").value,
    address: document.getElementById("driverAddress").value.trim(),
    emergencyContact: document.getElementById("emergencyContact").value.trim()
  };

  if (!payload.name) {
    alert("Driver name is required.");
    return;
  }
  if (!payload.status) {
    payload.status = "Active";
  }

  if (isExcludedDriverName(payload.name)) {
    alert(`${payload.name} is removed from the drivers list and cannot be added here.`);
    return;
  }

  state.drivers = id ? state.drivers.map((d) => d.id === id ? payload : d) : [...state.drivers, payload];
  saveData();
  e.target.reset();
  document.getElementById("driverDetailsId").value = "";
  refresh();
});

document.getElementById("cancelDriverEdit").addEventListener("click", () => {
  const draftId = document.getElementById("driverDetailsId").value;
  if (draftId && !state.drivers.some((driver) => driver.id === draftId) && driverAttachmentStore[draftId]) {
    delete driverAttachmentStore[draftId];
    writeDriverAttachmentStore();
  }
  document.getElementById("driversForm").reset();
  document.getElementById("driverDetailsId").value = "";
  const fileInput = document.getElementById("driverAttachmentsInput");
  if (fileInput) fileInput.value = "";
  drawDriverAttachments("");
});

document.getElementById("exportDrivers").addEventListener("click", () => {
  if (!canManageDrivers()) return;
  const csv = toCsv(state.drivers);
  if (!csv) return alert("No records to export.");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "drivers.csv";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("driversSearch").addEventListener("input", scheduleDriversRefresh);
document.getElementById("driversSearch").addEventListener("search", scheduleDriversRefresh);
document.getElementById("driversSearch").addEventListener("change", scheduleDriversRefresh);
document.getElementById("clearDriversFilters").addEventListener("click", () => {
  document.getElementById("driversSearch").value = "";
  refresh();
});

document.getElementById("driverAttachmentsInput")?.addEventListener("change", async (event) => {
  const input = event.target;
  try {
    await addDriverAttachments(input.files);
  } catch (error) {
    console.error("Driver attachment add failed:", error);
    setDriverAttachmentStatus(error.message || "Could not add the selected driver document.", "error-text");
  } finally {
    input.value = "";
  }
});

document.body.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;
  state.drivers = readData();
  const item = state.drivers.find((d) => d.id === id);

  if (action === "email-driver" || action === "sms-driver" || action === "whatsapp-driver") {
    if (!item) return;
    if (action === "email-driver") openDriverContact("email", item);
    if (action === "sms-driver") openDriverContact("sms", item);
    if (action === "whatsapp-driver") openDriverContact("whatsapp", item);
    return;
  }

  if (action === "download-driver-attachment") {
    openDriverAttachment(button.dataset.driverId || "", button.dataset.attachmentId || "");
    return;
  }

  if (action === "remove-driver-attachment") {
    removeDriverAttachment(button.dataset.driverId || "", button.dataset.attachmentId || "");
    return;
  }

  if (!canManageDrivers()) return;

  if (action === "edit") {
    if (item) setForm(item);
    return;
  }

  if (action === "delete") {
    if (item && !confirm(`Delete driver ${item.name}?`)) return;
    state.drivers = state.drivers.filter((d) => d.id !== id);
    if (driverAttachmentStore[id]) {
      delete driverAttachmentStore[id];
      writeDriverAttachmentStore();
    }
    if (legacyContacts[id]) {
      delete legacyContacts[id];
      localStorage.setItem(LEGACY_CONTACT_KEY, JSON.stringify(legacyContacts));
    }
    saveData();
    refresh();
  }
});

applyAccessControl();
refresh();
if (!restoreDriversSyncStatus()) {
  setDriversSyncStatus(useSupabase ? "Shared driver sync ready." : "Local-only mode on this device.", useSupabase ? "neutral" : "local", { persist: false });
}
void hydrateDriversFromSupabase();

if (!useSupabase) {
  window.addEventListener("opx:supabase-ready", () => {
    window.location.reload();
  }, { once: true });
}

window.addEventListener("storage", (event) => {
  if (event.key === DRIVER_ATTACHMENTS_KEY) {
    driverAttachmentStore = readDriverAttachmentStore();
    drawDriverAttachments();
    drawTable();
    return;
  }
  if (event.key !== KEY && event.key !== DRIVERS_UPDATED_KEY) return;
  state.drivers = readData();
  setDriversSyncStatus("Driver data updated in another tab.", "neutral");
  refresh();
});

if (driversChannel) {
  driversChannel.addEventListener("message", (event) => {
    if (event?.data?.type !== "drivers-updated") return;
    state.drivers = readData();
    refresh();
  });
}

window.addEventListener("offline", updateDriversQueueBanner);

window.addEventListener("online", () => {
  if (!useSupabase) return;
  if (driverRetryAttempt || driverRetryTimerId) {
    clearDriverSyncRetry(false);
    setDriversSyncStatus("Back online. Retrying shared driver sync...", "syncing");
    scheduleDriversSync(0);
    return;
  }
  updateDriversQueueBanner();
});
