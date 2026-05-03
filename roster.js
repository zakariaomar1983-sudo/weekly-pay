const auth = window.OPXAuth?.requireAuth("./login.html");
if (!auth) throw new Error("Authentication required");

if (!auth.can("accessCRM") || !auth.can("viewRoster")) {
  document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>You do not have permission to access the Weekly Roster page.</p></section></main>";
  throw new Error("No roster access");
}
window.__OPX_ROSTER_MAIN_LOADED = true;

const KEY = "transport_crm_roster";
const ROSTER_ACK_KEY = "transport_crm_roster_ack";
const ROSTER_WEEK_STATUS_KEY = "transport_crm_roster_week_status";
const ROSTER_SYNC_STATUS_KEY = "transport_crm_roster_sync_status";
const ROSTER_DRIVER_POOL_KEY = "transport_crm_roster_driver_pool";
const DRIVERS_KEY = "transport_crm_drivers";
const DRIVERS_UPDATED_KEY = "transport_crm_drivers_updated_at";
const CONTACT_KEY = "transport_crm_driver_contacts";
const TRUCKS_KEY = "transport_crm_trucks";
const DRIVERS_TABLE = "drivers";
const ROSTER_TABLE = "roster";
const TRUCKS_TABLE = "trucks";
const ROSTER_SYNC_RETRY_DELAYS_MS = [2000, 5000, 10000, 30000];
const ROSTER_PULL_INTERVAL_MS = 30000;
const ROSTER_PULL_THROTTLE_MS = 2000;
const TARGET_DRIVERS = 7;
const TARGET_TRUCKS = 7;
const TARGET_DAYS_PER_DRIVER = 5;
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DEFAULT_SHIFT_TIME = "06:00 - 14:00";
const DEFAULT_ROUTE = "As-Directed";
const LEAVE_SHIFT_TIME = "On Leave";
const ABSENT_SHIFT_TIME = "Absent";
const LEAVE_ROUTE = "Driver away";
const ABSENT_ROUTE = "Unavailable today";
const AWAY_STATUSES = new Set(["Leave", "Absent"]);
const START_LOCATION_OPTIONS = [
  "LG, Altona to As- Directed",
  "Allied Express, Broadmeadows As-Directed"
];
const DEFAULT_START_LOCATION = START_LOCATION_OPTIONS[0];
const ROUTE_LOCATION_SEPARATOR = "|||opx-start-location|||";
const LEGACY_ROUTE_ALIASES = new Map([
  ["Sydney to Newcastle", DEFAULT_ROUTE]
]);
const ACK_STATUS_META = {
  pending: { label: "Pending", tone: "neutral" },
  sent: { label: "Sent", tone: "queue" },
  viewed: { label: "Viewed", tone: "warning" },
  confirmed: { label: "Confirmed", tone: "live" }
};
const ACK_STATUS_ORDER = ["pending", "sent", "viewed", "confirmed"];
const WEEK_STATUS_META = {
  draft: { label: "Draft", tone: "neutral" },
  approved: { label: "Approved", tone: "live" },
  sent: { label: "Sent To Drivers", tone: "queue" }
};
const FALLBACK_DRIVERS = [
  { id: "fallback-driver-1", name: "Sharmake Hashi", status: "Active" },
  { id: "fallback-driver-2", name: "Imran Abdella", status: "Active" },
  { id: "fallback-driver-3", name: "Abdirizak Ahmed", status: "Active" },
  { id: "fallback-driver-4", name: "Ramzi Mohamed", status: "Active" },
  { id: "fallback-driver-5", name: "Suhen Omar", status: "Active" },
  { id: "fallback-driver-6", name: "Soleh Sungkar", status: "Active" },
  { id: "fallback-driver-7", name: "Samatar Yusuf", status: "Active" }
];
const FALLBACK_TRUCKS = [
  { id: "fallback-truck-1", truckNumber: "840", status: "Available" },
  { id: "fallback-truck-2", truckNumber: "881", status: "Available" },
  { id: "fallback-truck-3", truckNumber: "855", status: "Available" },
  { id: "fallback-truck-4", truckNumber: "853", status: "Available" },
  { id: "fallback-truck-5", truckNumber: "672", status: "Available" },
  { id: "fallback-truck-6", truckNumber: "620", status: "Available" },
  { id: "fallback-truck-7", truckNumber: "841", status: "Available" }
];
const PRIMARY_TRUCK_BY_DRIVER = new Map([
  ["Abdirizak Ahmed", "853"],
  ["Imran Abdella", "881"],
  ["Muhammed A H Siyad", "620"],
  ["Ramzi Mohamed", "841"],
  ["Samatar Yusuf", "855"],
  ["Sharmake Hashi", "672"],
  ["Soleh Sungkar", "840"],
  ["Suhen Omar", "620"]
]);
const LEGACY_DRIVER_NAME_ALIASES = new Map([
  [normalizeDriverNameKey("Khalid Aden"), "Suhen Omar"],
  [normalizeDriverNameKey("Mohamed Siyad"), "Muhammed A H Siyad"],
  [normalizeDriverNameKey("Mohammed Siyad"), "Muhammed A H Siyad"],
  [normalizeDriverNameKey("Muhamed Siyad"), "Muhammed A H Siyad"]
]);
const REQUIRED_DRIVER_NAMES = ["Soleh Sungkar"];
const ROSTER_EXCLUDED_DRIVER_NAMES = new Set([
  normalizeDriverNameKey("Mohamed Siyad"),
  normalizeDriverNameKey("Mohammed Siyad"),
  normalizeDriverNameKey("Muhamed Siyad"),
  normalizeDriverNameKey("Muhammed A H Siyad"),
  normalizeDriverNameKey("Faaid Warsame")
]);
const AUTO_TEMPLATE_BLOCKED_DRIVERS = new Set([
  normalizeDriverNameKey("Muhammed A H Siyad"),
  normalizeDriverNameKey("Faaid Warsame")
]);
const supabase = window.OPXSupabase?.client || null;
const useSupabase = Boolean(window.OPXSupabase?.isReady && supabase);
const state = {
  roster: readData(),
  syncedRosterIds: [],
  sharedAcknowledgements: {},
  sharedAcknowledgementWeek: "",
  sharedAcknowledgementsLoaded: false,
  sharedAcknowledgementsConfigured: true
};
const boardDragState = { shiftId: "" };
const weekRenderState = { queued: false };
let rosterSyncTimerId = 0;
let rosterSearchTimerId = 0;
let rosterRetryTimerId = 0;
let rosterRetryAttempt = 0;
let rosterSyncInFlight = false;
let rosterSyncQueued = false;
let rosterAcknowledgementRequestId = 0;
let rosterPullIntervalId = 0;
let rosterPullTimerId = 0;
let rosterPullQueued = false;
let rosterLastPullAt = 0;
let rosterRealtimeChannel = null;
const driversChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("opx-drivers") : null;

function formatRosterSyncTime(value = Date.now()) {
  return new Date(value).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

function formatRosterRetryDelay(ms) {
  if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

function readRosterSyncStatus() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ROSTER_SYNC_STATUS_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function setRosterSyncStatus(message, tone = "neutral", { at = Date.now(), persist = true } = {}) {
  const status = document.getElementById("rosterSyncStatus");
  if (!status) return;
  status.textContent = `${message} Last updated ${formatRosterSyncTime(at)}.`;
  status.className = `sync-badge sync-badge-${tone}`;
  if (persist) {
    localStorage.setItem(ROSTER_SYNC_STATUS_KEY, JSON.stringify({ message, tone, at }));
  }
  window.dispatchEvent(new CustomEvent("opx:sync-health-change", { detail: { source: "Roster", message, tone, at } }));
  updateRosterQueueBanner();
}

function restoreRosterSyncStatus() {
  const saved = readRosterSyncStatus();
  if (!saved?.message) return false;
  setRosterSyncStatus(saved.message, saved.tone || "neutral", { at: saved.at || Date.now(), persist: false });
  return true;
}

function setRosterQueueBanner(message = "", tone = "pending", visible = false) {
  const banner = document.getElementById("rosterQueueBanner");
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

function updateRosterQueueBanner() {
  if (!useSupabase) {
    setRosterQueueBanner("", "pending", false);
    return;
  }
  if (navigator.onLine === false) {
    setRosterQueueBanner("Offline mode: roster changes are saving on this device and will sync automatically when internet returns.", "offline", true);
    return;
  }
  if (rosterRetryAttempt || rosterRetryTimerId || rosterSyncQueued) {
    setRosterQueueBanner("Sync queue active: roster changes are saved locally and retrying automatically in the background.", "pending", true);
    return;
  }
  setRosterQueueBanner("", "pending", false);
}

function clearRosterSyncRetry(resetAttempt = true) {
  window.clearTimeout(rosterRetryTimerId);
  rosterRetryTimerId = 0;
  if (resetAttempt) rosterRetryAttempt = 0;
}

function queueRosterSyncRetry(errorMessage = "") {
  if (!useSupabase) return;
  clearRosterSyncRetry(false);
  const delay = ROSTER_SYNC_RETRY_DELAYS_MS[Math.min(rosterRetryAttempt, ROSTER_SYNC_RETRY_DELAYS_MS.length - 1)];
  rosterRetryAttempt += 1;
  const waitingForInternet = navigator.onLine === false;
  const retryMessage = waitingForInternet
    ? "Saved here. Waiting for internet to retry shared roster sync."
    : `Saved here. Retrying shared roster sync in ${formatRosterRetryDelay(delay)}.`;
  const details = errorMessage ? ` ${errorMessage}` : "";
  setRosterSyncStatus(`${retryMessage}${details}`, "error");
  rosterRetryTimerId = window.setTimeout(() => {
    rosterRetryTimerId = 0;
    scheduleRosterSync(0);
  }, waitingForInternet ? Math.max(delay, 5000) : delay);
}

function readData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    const rows = Array.isArray(parsed) ? parsed : [];
    const normalized = normalizeRosterRows(rows);
    if (JSON.stringify(rows) !== JSON.stringify(normalized)) {
      localStorage.setItem(KEY, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return [];
  }
}

function readArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readContacts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONTACT_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readRosterAcknowledgements() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ROSTER_ACK_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readWeekWorkflowStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ROSTER_WEEK_STATUS_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeWeekWorkflowStore(value) {
  localStorage.setItem(ROSTER_WEEK_STATUS_KEY, JSON.stringify(value || {}));
}

function writeRosterAcknowledgements(value) {
  localStorage.setItem(ROSTER_ACK_KEY, JSON.stringify(value || {}));
}

function acknowledgementKey(driverName, weekKey) {
  const name = canonicalDriverName(driverName);
  return `${String(weekKey || "").trim()}__${String(name || "").trim()}`;
}

function acknowledgementOrder(status) {
  const index = ACK_STATUS_ORDER.indexOf(String(status || "").trim());
  return index === -1 ? 0 : index;
}

function normalizeAcknowledgementEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const driverName = canonicalDriverName(entry.driverName || entry.driver || "");
  const weekKey = String(entry.weekKey || entry.log_date || "").trim();
  if (!driverName || !weekKey) return null;
  const status = Object.prototype.hasOwnProperty.call(ACK_STATUS_META, entry.status) ? entry.status : "pending";
  return {
    driverName,
    weekKey,
    status,
    updatedAt: String(entry.updatedAt || entry.updated_at || entry.created_at || "").trim(),
    source: String(entry.source || "").trim()
  };
}

function latestAcknowledgementEntry(firstEntry, secondEntry) {
  const left = normalizeAcknowledgementEntry(firstEntry);
  const right = normalizeAcknowledgementEntry(secondEntry);
  if (!left) return right;
  if (!right) return left;
  const leftOrder = acknowledgementOrder(left.status);
  const rightOrder = acknowledgementOrder(right.status);
  if (leftOrder !== rightOrder) return leftOrder > rightOrder ? left : right;
  const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
  const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
  return rightTime >= leftTime ? right : left;
}

function sharedAcknowledgementEntry(driverName, weekKey) {
  const key = acknowledgementKey(driverName, weekKey);
  return normalizeAcknowledgementEntry(state.sharedAcknowledgements[key]);
}

function getWeekAcknowledgement(driverName, weekKey) {
  const meta = ACK_STATUS_META.pending;
  if (!driverName || !weekKey) return { status: "pending", label: meta.label, tone: meta.tone, updatedAt: "" };
  const store = readRosterAcknowledgements();
  const saved = normalizeAcknowledgementEntry(store[acknowledgementKey(driverName, weekKey)]);
  const shared = sharedAcknowledgementEntry(driverName, weekKey);
  const merged = latestAcknowledgementEntry(saved, shared);
  const status = merged?.status || "pending";
  return {
    status,
    label: ACK_STATUS_META[status].label,
    tone: ACK_STATUS_META[status].tone,
    updatedAt: merged?.updatedAt || ""
  };
}

function setWeekAcknowledgementLocal(driverName, weekKey, status, updatedAt = new Date().toISOString()) {
  if (!driverName || !weekKey || !Object.prototype.hasOwnProperty.call(ACK_STATUS_META, status)) return;
  const store = readRosterAcknowledgements();
  const nextEntry = {
    driverName: canonicalDriverName(driverName),
    weekKey,
    status,
    updatedAt: String(updatedAt || new Date().toISOString())
  };
  store[acknowledgementKey(driverName, weekKey)] = nextEntry;
  writeRosterAcknowledgements(store);
  return nextEntry;
}

function updateSharedAcknowledgementCache(entry) {
  const normalized = normalizeAcknowledgementEntry(entry);
  if (!normalized) return;
  const key = acknowledgementKey(normalized.driverName, normalized.weekKey);
  state.sharedAcknowledgements[key] = latestAcknowledgementEntry(state.sharedAcknowledgements[key], normalized);
}

async function syncSharedWeekAcknowledgement(driverName, weekKey, status, mode = "set", source = "crm") {
  if (!driverName || !weekKey || !Object.prototype.hasOwnProperty.call(ACK_STATUS_META, status)) return null;
  try {
    const response = await fetch("./api/roster-ack", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        driverName: canonicalDriverName(driverName),
        weekKey,
        status,
        mode,
        source
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error || "Unable to update shared roster acknowledgement.";
      if (/not configured/i.test(String(message))) {
        state.sharedAcknowledgementsConfigured = false;
      }
      throw new Error(message);
    }
    state.sharedAcknowledgementsConfigured = true;
    if (payload?.item) {
      updateSharedAcknowledgementCache(payload.item);
      if (state.sharedAcknowledgementWeek === weekKey) {
        refreshWeekView();
      }
    }
    return payload?.item || null;
  } catch (error) {
    console.warn("Shared roster acknowledgement sync failed:", error?.message || error);
    return null;
  }
}

async function loadSharedWeekAcknowledgements(weekKey, { force = false } = {}) {
  if (!weekKey) {
    state.sharedAcknowledgements = {};
    state.sharedAcknowledgementWeek = "";
    state.sharedAcknowledgementsLoaded = false;
    return;
  }
  if (!force && state.sharedAcknowledgementWeek === weekKey && state.sharedAcknowledgementsLoaded) return;
  const requestId = ++rosterAcknowledgementRequestId;
  try {
    const response = await fetch(`./api/roster-ack?weekKey=${encodeURIComponent(weekKey)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || "Unable to load shared roster acknowledgements.");
    }
    if (requestId !== rosterAcknowledgementRequestId) return;
    if (payload?.configured === false) {
      state.sharedAcknowledgements = {};
      state.sharedAcknowledgementWeek = weekKey;
      state.sharedAcknowledgementsLoaded = true;
      state.sharedAcknowledgementsConfigured = false;
      refreshWeekView();
      return;
    }
    const next = {};
    (Array.isArray(payload?.items) ? payload.items : []).forEach((item) => {
      const normalized = normalizeAcknowledgementEntry(item);
      if (!normalized) return;
      next[acknowledgementKey(normalized.driverName, normalized.weekKey)] = normalized;
    });
    state.sharedAcknowledgements = next;
    state.sharedAcknowledgementWeek = weekKey;
    state.sharedAcknowledgementsLoaded = true;
    state.sharedAcknowledgementsConfigured = true;
    refreshWeekView();
  } catch (error) {
    if (requestId !== rosterAcknowledgementRequestId) return;
    console.warn("Shared roster acknowledgement load failed:", error?.message || error);
    state.sharedAcknowledgementsLoaded = false;
  }
}

function setWeekAcknowledgement(driverName, weekKey, status, { mode = "set", source = "crm" } = {}) {
  const normalizedName = canonicalDriverName(driverName);
  if (!normalizedName || !weekKey || !Object.prototype.hasOwnProperty.call(ACK_STATUS_META, status)) return;
  const current = getWeekAcknowledgement(normalizedName, weekKey);
  const nextStatus = mode === "atLeast" && acknowledgementOrder(current.status) > acknowledgementOrder(status)
    ? current.status
    : status;
  const nextEntry = setWeekAcknowledgementLocal(normalizedName, weekKey, nextStatus);
  updateSharedAcknowledgementCache(nextEntry);
  void syncSharedWeekAcknowledgement(normalizedName, weekKey, status, mode, source);
}

function ensureWeekAcknowledgementAtLeast(driverName, weekKey, minimumStatus, source = "crm") {
  const current = getWeekAcknowledgement(driverName, weekKey).status;
  if (acknowledgementOrder(minimumStatus) > acknowledgementOrder(current)) {
    setWeekAcknowledgement(driverName, weekKey, minimumStatus, { mode: "atLeast", source });
    return;
  }
  void syncSharedWeekAcknowledgement(driverName, weekKey, minimumStatus, "atLeast", source);
}

function formatAcknowledgementTime(value) {
  if (!value) return "Not updated yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not updated yet";
  return date.toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  });
}

function renderAcknowledgementBadge(driverName, weekKey, compact = false) {
  const acknowledgement = getWeekAcknowledgement(driverName, weekKey);
  const timeTitle = acknowledgement.updatedAt ? ` title="Updated ${escapeHtml(formatAcknowledgementTime(acknowledgement.updatedAt))}"` : "";
  const label = compact ? acknowledgement.label : `${acknowledgement.label} ack`;
  return `<span class="ack-chip ack-chip-${acknowledgement.tone}"${timeTitle}>${escapeHtml(label)}</span>`;
}

function acknowledgementCounts(driverNames, weekKey) {
  return driverNames.reduce((summary, driverName) => {
    const status = getWeekAcknowledgement(driverName, weekKey).status;
    summary.total += 1;
    summary[status] += 1;
    return summary;
  }, {
    total: 0,
    pending: 0,
    sent: 0,
    viewed: 0,
    confirmed: 0
  });
}

function getWeekWorkflow(weekKey) {
  const fallback = WEEK_STATUS_META.draft;
  if (!weekKey) return { status: "draft", label: fallback.label, tone: fallback.tone, updatedAt: "", updatedBy: "" };
  const store = readWeekWorkflowStore();
  const saved = store[weekKey] || {};
  const status = Object.prototype.hasOwnProperty.call(WEEK_STATUS_META, saved.status) ? saved.status : "draft";
  return {
    status,
    label: WEEK_STATUS_META[status].label,
    tone: WEEK_STATUS_META[status].tone,
    updatedAt: saved.updatedAt || "",
    updatedBy: saved.updatedBy || ""
  };
}

function setWeekWorkflowStatus(weekKey, status) {
  if (!weekKey || !Object.prototype.hasOwnProperty.call(WEEK_STATUS_META, status)) return;
  const store = readWeekWorkflowStore();
  store[weekKey] = {
    status,
    updatedAt: new Date().toISOString(),
    updatedBy: auth.user.username
  };
  writeWeekWorkflowStore(store);
  window.OPXAuth?.recordAuditEvent?.({
    actor: {
      actorUserId: auth.user.id,
      actorUsername: auth.user.username,
      actorRoleId: auth.user.roleId
    },
    action: "update",
    area: "roster",
    targetType: "week",
    targetId: weekKey,
    targetName: `Roster week ${weekKey}`,
    summary: `Set roster week ${weekKey} to ${WEEK_STATUS_META[status].label}`,
    details: {
      weekKey,
      workflowStatus: status
    }
  });
}

function renderWeekWorkflowBadge(weekKey, compact = false) {
  const workflow = getWeekWorkflow(weekKey);
  const label = compact ? workflow.label : `Week ${workflow.label}`;
  const title = workflow.updatedAt ? ` title="Updated ${escapeHtml(formatAcknowledgementTime(workflow.updatedAt))} by ${escapeHtml(workflow.updatedBy || "System")}"` : "";
  return `<span class="ack-chip ack-chip-${workflow.tone}"${title}>${escapeHtml(label)}</span>`;
}

function normalizeDriverNameKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function canonicalDriverName(value) {
  const trimmed = String(value || "").trim().replace(/\s+/g, " ");
  return LEGACY_DRIVER_NAME_ALIASES.get(normalizeDriverNameKey(trimmed)) || trimmed;
}

function isAutoTemplateBlockedDriver(driverName) {
  return AUTO_TEMPLATE_BLOCKED_DRIVERS.has(normalizeDriverNameKey(driverName));
}

function firstFilledValue(...values) {
  for (const value of values) {
    if (String(value ?? "").trim()) return value;
  }
  return "";
}

function normalizeDriverRecords(rows) {
  const mergedByName = new Map();
  rows
    .filter((item) => item && typeof item === "object")
    .forEach((item, index) => {
      const normalizedName = canonicalDriverName(item.name);
      if (!normalizedName) return;
      const normalized = { ...item, id: item.id || `legacy-driver-${index}`, name: normalizedName };
      const existing = mergedByName.get(normalizedName);
      if (!existing) {
        mergedByName.set(normalizedName, normalized);
        return;
      }
      mergedByName.set(normalizedName, {
        ...existing,
        ...normalized,
        id: existing.id || normalized.id,
        name: normalizedName,
        phone: firstFilledValue(existing.phone, normalized.phone),
        email: firstFilledValue(existing.email, normalized.email),
        licenseNumber: firstFilledValue(existing.licenseNumber, normalized.licenseNumber),
        licenseExpiry: firstFilledValue(existing.licenseExpiry, normalized.licenseExpiry),
        hireDate: firstFilledValue(existing.hireDate, normalized.hireDate),
        status: firstFilledValue(existing.status, normalized.status),
        address: firstFilledValue(existing.address, normalized.address),
        emergencyContact: firstFilledValue(existing.emergencyContact, normalized.emergencyContact)
      });
    });
  return Array.from(mergedByName.values());
}

function normalizeRosterRow(item) {
  const originalDriverName = String(item?.driverName || "").trim();
  const driverName = canonicalDriverName(originalDriverName);
  const aliasChanged = Boolean(driverName && driverName !== originalDriverName);
  const configuredTruck = getConfiguredPrimaryTruckForDriver(driverName);
  const away = isAwayStatus(item?.status);
  const unpackedRoute = unpackRouteValue(item?.route || "");
  return normalizeRosterPayload({
    ...item,
    route: unpackedRoute.route || String(item?.route || "").trim(),
    startLocation: item?.startLocation || unpackedRoute.startLocation || "",
    driverName,
    truckNumber: aliasChanged && !away ? (configuredTruck || String(item?.truckNumber || "").trim()) : String(item?.truckNumber || "").trim()
  });
}

function normalizeRosterRows(rows) {
  return dedupeRosterRows(
    rows
      .filter((item) => item && typeof item === "object")
      .map((item) => normalizeRosterRow(item))
  );
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createNodeFromMarkup(markup) {
  const template = document.createElement("template");
  template.innerHTML = String(markup || "").trim();
  return template.content.firstElementChild;
}

function patchKeyedChildren(container, items, keyAttr) {
  if (!container) return;
  const existing = new Map(Array.from(container.children).map((child) => [child.getAttribute(keyAttr), child]));

  items.forEach((item, index) => {
    const key = String(item.key || "");
    const signature = String(item.signature || "");
    let child = existing.get(key);

    if (!child) {
      child = createNodeFromMarkup(item.markup);
      if (!child) return;
      container.insertBefore(child, container.children[index] || null);
    } else if (child.getAttribute("data-render-signature") !== signature) {
      const nextChild = createNodeFromMarkup(item.markup);
      if (!nextChild) return;
      child.replaceWith(nextChild);
      child = nextChild;
    }

    const currentAtIndex = container.children[index];
    if (currentAtIndex !== child) {
      container.insertBefore(child, currentAtIndex || null);
    }

    existing.delete(key);
  });

  existing.forEach((child) => child.remove());
}

function setMarkupIfChanged(node, markup) {
  if (!node) return;
  if (node.innerHTML !== markup) node.innerHTML = markup;
}

function setTextIfChanged(node, text) {
  if (!node) return;
  if (node.textContent !== text) node.textContent = text;
}

function saveData() {
  localStorage.setItem(KEY, JSON.stringify(state.roster));
  if (useSupabase) {
    clearRosterSyncRetry(false);
    setRosterSyncStatus("Syncing roster changes...", "syncing");
    scheduleRosterSync();
  } else {
    setRosterSyncStatus("Saved on this device only.", "local");
  }
}

function scheduleRosterSync(delay = 300) {
  if (!useSupabase) return;
  window.clearTimeout(rosterSyncTimerId);
  clearRosterSyncRetry(false);
  rosterSyncTimerId = window.setTimeout(() => {
    rosterSyncTimerId = 0;
    if (rosterSyncInFlight) {
      rosterSyncQueued = true;
      return;
    }
    void syncRosterToSupabase();
  }, delay);
}

function scheduleWeekSearchRefresh() {
  window.clearTimeout(rosterSearchTimerId);
  rosterSearchTimerId = window.setTimeout(() => {
    rosterSearchTimerId = 0;
    refreshWeekView();
  }, 120);
}

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toDbRoster(item) {
  return {
    id: item.id,
    driver_name: item.driverName || "",
    truck_number: item.truckNumber || "",
    run_type: item.nightRun ? "Night Run +" : "",
    shift_date: item.shiftDate || null,
    shift_time: item.shiftTime || "",
    route: packRouteValue(item.route || "", item.startLocation || ""),
    status: item.status || "Scheduled"
  };
}

function fromDbRoster(row) {
  const runType = String(row.run_type || "").trim().toLowerCase();
  const unpackedRoute = unpackRouteValue(row.route || "");
  return {
    id: row.id,
    driverName: row.driver_name || "",
    truckNumber: row.truck_number || "",
    nightRun: runType === "night run" || runType === "night run +",
    shiftDate: row.shift_date || "",
    shiftTime: row.shift_time || "",
    route: unpackedRoute.route,
    startLocation: unpackedRoute.startLocation,
    status: row.status || "Scheduled"
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

function fromDbTruck(row) {
  return {
    id: row.id,
    truckNumber: row.truck_number || "",
    registration: row.registration || "",
    model: row.model || "",
    capacity: Number(row.capacity || 0),
    serviceDueDate: row.service_due_date || "",
    regoExpiryDate: row.rego_expiry_date || "",
    status: row.status || "",
    notes: row.notes || ""
  };
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

function rosterIdList(rows = state.roster) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : [])
    .map((item) => String(item?.id || "").trim())
    .filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function scheduleSharedRosterPull(delay = 0) {
  if (!useSupabase) return;
  window.clearTimeout(rosterPullTimerId);
  rosterPullTimerId = window.setTimeout(() => {
    rosterPullTimerId = 0;
    if (navigator.onLine === false) return;
    if (rosterSyncInFlight || rosterSyncQueued || rosterRetryTimerId || rosterRetryAttempt) {
      rosterPullQueued = true;
      return;
    }
    rosterPullQueued = false;
    rosterLastPullAt = Date.now();
    void hydrateRosterFromSupabase({ silent: true });
  }, Math.max(0, Number(delay) || 0));
}

function queueThrottledSharedRosterPull() {
  if (!useSupabase) return;
  const sinceLastPull = Date.now() - rosterLastPullAt;
  const delay = sinceLastPull >= ROSTER_PULL_THROTTLE_MS
    ? 0
    : (ROSTER_PULL_THROTTLE_MS - sinceLastPull);
  scheduleSharedRosterPull(delay);
}

function initRosterRealtimeSync() {
  if (!useSupabase || typeof supabase?.channel !== "function") return;
  try {
    rosterRealtimeChannel = supabase
      .channel("opx-roster-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: ROSTER_TABLE },
        () => {
          queueThrottledSharedRosterPull();
        }
      )
      .subscribe();
  } catch (error) {
    console.warn("Realtime roster sync failed to start:", error?.message || error);
  }
}

function stopRosterRealtimeSync() {
  window.clearInterval(rosterPullIntervalId);
  rosterPullIntervalId = 0;
  window.clearTimeout(rosterPullTimerId);
  rosterPullTimerId = 0;
  if (rosterRealtimeChannel && typeof supabase?.removeChannel === "function") {
    void supabase.removeChannel(rosterRealtimeChannel);
  }
  rosterRealtimeChannel = null;
}

async function syncRosterToSupabase() {
  if (!useSupabase || rosterSyncInFlight) return false;
  rosterSyncInFlight = true;
  const rows = state.roster.map(toDbRoster);
  const currentIds = rosterIdList(state.roster);
  const currentIdSet = new Set(currentIds);
  const previouslySyncedIds = Array.isArray(state.syncedRosterIds) ? state.syncedRosterIds : [];
  const idsToDelete = previouslySyncedIds.filter((id) => !currentIdSet.has(id));
  try {
    if (!rows.length) {
      if (previouslySyncedIds.length) {
        const wipe = await supabase.from(ROSTER_TABLE).delete().in("id", previouslySyncedIds);
        if (wipe.error) {
          console.error("Supabase delete sync failed for roster:", wipe.error.message);
          queueRosterSyncRetry(wipe.error.message);
          return false;
        }
      }
      clearRosterSyncRetry();
      state.syncedRosterIds = [];
      setRosterSyncStatus("Roster changes saved and synced.", "live");
      return true;
    }

    const { error } = await supabase.from(ROSTER_TABLE).upsert(rows, { onConflict: "id" });
    if (error) {
      console.error("Supabase sync failed for roster:", error.message);
      queueRosterSyncRetry(error.message);
      return false;
    }

    if (idsToDelete.length) {
      const cleanup = await supabase.from(ROSTER_TABLE).delete().in("id", idsToDelete);
      if (cleanup.error) {
        console.error("Supabase cleanup failed for roster:", cleanup.error.message);
        queueRosterSyncRetry(cleanup.error.message);
        return false;
      }
    }
    clearRosterSyncRetry();
    state.syncedRosterIds = currentIds;
    setRosterSyncStatus("Roster changes saved and synced.", "live");
    return true;
  } finally {
    rosterSyncInFlight = false;
    if (rosterPullQueued) {
      rosterPullQueued = false;
      scheduleSharedRosterPull(250);
    }
    if (rosterSyncQueued) {
      rosterSyncQueued = false;
      scheduleRosterSync(0);
    }
  }
}

async function hydrateRosterFromSupabase({ silent = false } = {}) {
  if (!useSupabase) return;
  if (!silent) {
    setRosterSyncStatus("Checking shared roster data...", "syncing");
  }
  const { data, error } = await supabase.from(ROSTER_TABLE).select("*");
  if (error) {
    console.error("Supabase load failed for roster:", error.message);
    if (!silent) {
      setRosterSyncStatus("Shared roster sync unavailable. Using this device's saved data.", "local");
    }
    return;
  }

  if (!Array.isArray(data)) return;

  if (!data.length && state.roster.length) {
    console.warn("Supabase roster table is empty; keeping local roster and seeding Supabase.");
    await syncRosterToSupabase();
    setRosterSyncStatus("Local roster data copied into shared storage.", "live");
    refresh();
    return;
  }

  const hydratedRoster = data.map(fromDbRoster);
  const normalizedRoster = normalizeRosterRows(hydratedRoster);
  const rosterChanged = JSON.stringify(hydratedRoster) !== JSON.stringify(normalizedRoster);
  state.roster = normalizedRoster;
  state.syncedRosterIds = rosterIdList(normalizedRoster);
  localStorage.setItem(KEY, JSON.stringify(state.roster));
  if (!silent) {
    setRosterSyncStatus("Shared roster data loaded.", "live");
  }
  refresh();
  if (rosterChanged) scheduleRosterSync(0);
}

async function hydrateRosterReferencesFromSupabase() {
  if (!useSupabase) return;

  const localDrivers = normalizeDriverRecords(readArray(DRIVERS_KEY));
  const localTrucks = readArray(TRUCKS_KEY);

  const [driversRes, trucksRes] = await Promise.all([
    supabase.from(DRIVERS_TABLE).select("*"),
    supabase.from(TRUCKS_TABLE).select("*")
  ]);

  if (!driversRes.error && Array.isArray(driversRes.data)) {
    if (!driversRes.data.length && localDrivers.length) {
      const { error } = await supabase.from(DRIVERS_TABLE).upsert(localDrivers.map(toDbDriver), { onConflict: "id" });
      if (error) {
        console.error("Supabase seed failed for roster drivers:", error.message);
      } else {
        localStorage.setItem(DRIVERS_KEY, JSON.stringify(localDrivers));
      }
    } else {
      const remoteDrivers = normalizeDriverRecords(driversRes.data.map(fromDbDriver));
      const mergedDrivers = normalizeDriverRecords([...localDrivers, ...remoteDrivers]);
      localStorage.setItem(DRIVERS_KEY, JSON.stringify(mergedDrivers));

      // Keep freshly-added local drivers visible immediately, then backfill shared store.
      if (JSON.stringify(mergedDrivers) !== JSON.stringify(remoteDrivers)) {
        const { error } = await supabase.from(DRIVERS_TABLE).upsert(mergedDrivers.map(toDbDriver), { onConflict: "id" });
        if (error) {
          console.error("Supabase merge sync failed for roster drivers:", error.message);
        }
      }
    }
  } else if (driversRes.error) {
    console.error("Supabase load failed for roster drivers:", driversRes.error.message);
  }

  if (!trucksRes.error && Array.isArray(trucksRes.data)) {
    if (!trucksRes.data.length && localTrucks.length) {
      const { error } = await supabase.from(TRUCKS_TABLE).upsert(localTrucks.map(toDbTruck), { onConflict: "id" });
      if (error) {
        console.error("Supabase seed failed for roster trucks:", error.message);
      } else {
        localStorage.setItem(TRUCKS_KEY, JSON.stringify(localTrucks));
      }
    } else {
      localStorage.setItem(TRUCKS_KEY, JSON.stringify(trucksRes.data.map(fromDbTruck)));
    }
  } else if (trucksRes.error) {
    console.error("Supabase load failed for roster trucks:", trucksRes.error.message);
  }

  refresh();
}

function parseDateOnly(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  let year;
  let month;
  let day;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    [year, month, day] = raw.split("-").map(Number);
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    [day, month, year] = raw.split("/").map(Number);
  } else {
    const native = new Date(raw);
    if (Number.isNaN(native.getTime())) return null;
    native.setHours(0, 0, 0, 0);
    return native;
  }
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function todayKey() {
  return dateToKey(new Date());
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const body = rows.map((r) => headers.map((h) => esc(r[h])).join(",")).join("\n");
  return `${headers.join(",")}\n${body}`;
}

function normalizeRosterPayload(payload) {
  if (!isAwayStatus(payload.status)) {
    const route = normalizeLegacyRoute(payload.route);
    return {
      ...payload,
      route: route || DEFAULT_ROUTE,
      startLocation: normalizeStartLocation(payload.startLocation, route),
      leaveStartDate: "",
      returnDate: ""
    };
  }
  const shiftDate = String(payload.shiftDate || payload.leaveStartDate || "").trim();
  const returnDate = String(payload.returnDate || payload.leaveReturnDate || shiftDate).trim();
  return {
    ...payload,
    truckNumber: "",
    nightRun: false,
    shiftDate,
    shiftTime: payload.shiftTime || defaultAwayShiftTime(payload.status),
    route: payload.route || defaultAwayRoute(payload.status),
    startLocation: "",
    leaveStartDate: isLeaveStatus(payload.status) ? shiftDate : "",
    returnDate: isLeaveStatus(payload.status) ? returnDate : ""
  };
}

function inferStartLocationFromRoute(route) {
  const text = String(route || "").trim().toLowerCase();
  if (!text || text === LEAVE_ROUTE.toLowerCase()) return "";
  if (text.includes("allied") || text.includes("broadmeadows") || text.includes("north")) {
    return START_LOCATION_OPTIONS[1];
  }
  if (text.includes("lg") || text.includes("altona") || text.includes("west") || text.includes("south")) {
    return START_LOCATION_OPTIONS[0];
  }
  return DEFAULT_START_LOCATION;
}

function normalizeStartLocation(value, fallbackRoute = "") {
  const trimmed = String(value || "").trim();
  if (START_LOCATION_OPTIONS.includes(trimmed)) return trimmed;
  return inferStartLocationFromRoute(fallbackRoute) || DEFAULT_START_LOCATION;
}

function unpackRouteValue(value) {
  const text = String(value || "").trim();
  if (!text) return { route: "", startLocation: "" };
  const parts = text.split(ROUTE_LOCATION_SEPARATOR);
  if (parts.length > 1) {
    const [rawLocation, ...rest] = parts;
    const route = rest.join(ROUTE_LOCATION_SEPARATOR).trim();
    return {
      route,
      startLocation: normalizeStartLocation(rawLocation, route)
    };
  }
  return {
    route: text,
    startLocation: inferStartLocationFromRoute(text)
  };
}

function packRouteValue(route, startLocation) {
  const cleanRoute = String(route || "").trim();
  if (!cleanRoute || cleanRoute === LEAVE_ROUTE) return cleanRoute;
  return `${normalizeStartLocation(startLocation, cleanRoute)}${ROUTE_LOCATION_SEPARATOR}${cleanRoute}`;
}

function dedupeRosterRows(rows) {
  const latestByDriverDate = new Map();
  rows.forEach((row) => {
    const driverName = String(row.driverName || "").trim();
    const shiftDate = String(row.shiftDate || "").trim();
    if (!driverName || !shiftDate) return;
    latestByDriverDate.set(`${driverName}__${shiftDate}`, row);
  });
  return rows.filter((row) => {
    const driverName = String(row.driverName || "").trim();
    const shiftDate = String(row.shiftDate || "").trim();
    if (!driverName || !shiftDate) return true;
    return latestByDriverDate.get(`${driverName}__${shiftDate}`) === row;
  });
}

function mondayOf(dateStr) {
  const d = parseDateOnly(dateStr);
  if (!d || Number.isNaN(d.getTime())) return null;
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + offset);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function dateToKey(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isAwayStatus(status) {
  return AWAY_STATUSES.has(String(status || "").trim());
}

function isLeaveStatus(status) {
  return String(status || "").trim() === "Leave";
}

function defaultAwayShiftTime(status) {
  return isLeaveStatus(status) ? LEAVE_SHIFT_TIME : ABSENT_SHIFT_TIME;
}

function defaultAwayRoute(status) {
  return isLeaveStatus(status) ? LEAVE_ROUTE : ABSENT_ROUTE;
}

function normalizeLegacyRoute(route) {
  const text = String(route || "").trim();
  if (!text) return "";
  return LEGACY_ROUTE_ALIASES.get(text) || text;
}

function awayDisplayTitle(status) {
  return isLeaveStatus(status) ? "On Leave" : "Absent";
}

function awayBadgeLabel(status) {
  return isLeaveStatus(status) ? "Away" : "Absent";
}

function awayChipClass(status) {
  return isLeaveStatus(status) ? "board-chip-leave" : "board-chip-absent";
}

function awayBadgeClass(status) {
  return isLeaveStatus(status) ? "board-badge-leave" : "board-badge-absent";
}

function awayRowClass(status) {
  return isLeaveStatus(status) ? "row-leave-highlight" : "row-absent-highlight";
}

function displayRosterStatus(status) {
  if (isLeaveStatus(status)) return "On Leave";
  if (String(status || "").trim() === "Absent") return "Absent Today";
  return String(status || "").trim() || "Scheduled";
}

function getDateRangeKeys(startKey, endKey) {
  const start = parseDateOnly(startKey);
  const end = parseDateOnly(endKey);
  if (!start || !end) return [];
  const from = start.getTime() <= end.getTime() ? start : end;
  const to = start.getTime() <= end.getTime() ? end : start;
  const dates = [];
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    dates.push(dateToKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function getWeekDates(startKey) {
  const start = parseDateOnly(startKey);
  if (!start) return [];
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const x = new Date(start);
    x.setDate(start.getDate() + i);
    days.push(x);
  }
  return days;
}

function selectedWeekStartKey() {
  const field = document.getElementById("weekStart");
  const fromValue = field?.value || "";
  const fromDateObject = field?.valueAsDate instanceof Date && !Number.isNaN(field.valueAsDate.getTime())
    ? dateToKey(field.valueAsDate)
    : "";
  const monday = mondayOf(fromValue || fromDateObject || todayKey());
  return monday ? dateToKey(monday) : "";
}

function getWeekContext() {
  const weekKey = selectedWeekStartKey();
  const weekDates = getWeekDates(weekKey);
  const weekKeys = weekDates.map(dateToKey);
  const weekSet = new Set(weekKeys);
  const actualWeekRows = state.roster.filter((r) => weekSet.has(r.shiftDate));
  const weekRows = [...actualWeekRows, ...buildWeekTemplateRows(weekKeys, actualWeekRows)];

  return { weekKey, weekDates, weekKeys, weekSet, weekRows, actualWeekRows };
}

function readRosterDriverPoolNames() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ROSTER_DRIVER_POOL_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((name) => canonicalDriverName(name)).map((name) => String(name || "").trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

function writeRosterDriverPoolNames(names) {
  const normalized = [...new Set((Array.isArray(names) ? names : []).map((name) => canonicalDriverName(name)).map((name) => String(name || "").trim()).filter(Boolean))];
  localStorage.setItem(ROSTER_DRIVER_POOL_KEY, JSON.stringify(normalized));
}

function getAvailableDriverRecords() {
  const rows = normalizeDriverRecords(readArray(DRIVERS_KEY));
  const source = rows.length ? rows : FALLBACK_DRIVERS;
  const filtered = source
    .filter((item) => String(item.status || "").toLowerCase() !== "inactive")
    .map((item) => ({ ...item, name: String(item.name || "").trim() }))
    .filter((item) => !ROSTER_EXCLUDED_DRIVER_NAMES.has(normalizeDriverNameKey(item.name)))
    .filter((item) => item.name);

  const byName = new Map(filtered.map((item) => [item.name.toLowerCase(), item]));
  REQUIRED_DRIVER_NAMES.forEach((name) => {
    if (!byName.has(name.toLowerCase())) {
      filtered.push({ id: `required-${name.toLowerCase().replace(/\s+/g, "-")}`, name, status: "Active" });
    }
  });

  return filtered.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function getActiveDrivers() {
  const available = getAvailableDriverRecords();
  const selectedNames = readRosterDriverPoolNames();
  if (!selectedNames.length) return available;

  const selectedKeys = new Set(selectedNames.map((name) => normalizeDriverNameKey(name)));
  const filtered = available.filter((item) => selectedKeys.has(normalizeDriverNameKey(item.name)));
  return filtered.length ? filtered : available;
}

function addDriverToRosterPool(driverName) {
  const name = canonicalDriverName(driverName);
  if (!name) return false;
  const available = getAvailableDriverRecords();
  const availableKeys = new Set(available.map((item) => normalizeDriverNameKey(item.name)));
  const nameKey = normalizeDriverNameKey(name);
  if (!availableKeys.has(nameKey)) return false;

  const current = readRosterDriverPoolNames();
  const base = current.length ? current : available.map((item) => item.name);
  if (base.some((item) => normalizeDriverNameKey(item) === nameKey)) return false;
  writeRosterDriverPoolNames([...base, name]);
  return true;
}

function ensureDriverInRosterPool(driverName) {
  const name = canonicalDriverName(driverName);
  if (!name) return false;
  const current = readRosterDriverPoolNames();
  if (!current.length) return false;
  const nameKey = normalizeDriverNameKey(name);
  if (current.some((item) => normalizeDriverNameKey(item) === nameKey)) return false;
  writeRosterDriverPoolNames([...current, name]);
  return true;
}

function removeDriverFromRosterPool(driverName, { removeShifts = false } = {}) {
  const name = canonicalDriverName(driverName);
  if (!name) return { removed: false, reason: "invalid" };
  const available = getAvailableDriverRecords();
  const base = readRosterDriverPoolNames();
  const current = base.length ? base : available.map((item) => item.name);
  const nameKey = normalizeDriverNameKey(name);
  if (!current.some((item) => normalizeDriverNameKey(item) === nameKey)) {
    return { removed: false, reason: "missing" };
  }
  if (current.length <= 1) {
    return { removed: false, reason: "last-driver" };
  }

  const next = current.filter((item) => normalizeDriverNameKey(item) !== nameKey);
  writeRosterDriverPoolNames(next);

  if (removeShifts) {
    const beforeCount = state.roster.length;
    state.roster = state.roster.filter((row) => normalizeDriverNameKey(row.driverName) !== nameKey);
    if (state.roster.length !== beforeCount) {
      saveData();
    }
  }

  return { removed: true, remaining: next.length };
}

function getRosterDriverPoolNamesForView() {
  const available = getAvailableDriverRecords().map((item) => String(item.name || "").trim()).filter(Boolean);
  const selected = readRosterDriverPoolNames();
  if (!selected.length) return available;
  const selectedKeys = new Set(selected.map((name) => normalizeDriverNameKey(name)));
  const filtered = available.filter((name) => selectedKeys.has(normalizeDriverNameKey(name)));
  return filtered.length ? filtered : available;
}

function drawRosterDriverPoolManager() {
  const chipsWrap = document.getElementById("rosterDriverPoolChips");
  const addSelect = document.getElementById("rosterDriverQuickAdd");
  const addBtn = document.getElementById("addRosterDriverBtn");
  const status = document.getElementById("rosterDriverPoolStatus");
  if (!chipsWrap || !addSelect || !addBtn || !status) return;

  const availableNames = getAvailableDriverRecords().map((item) => String(item.name || "").trim()).filter(Boolean);
  const includedNames = getRosterDriverPoolNamesForView();
  const includedKeys = new Set(includedNames.map((name) => normalizeDriverNameKey(name)));
  const addableNames = availableNames.filter((name) => !includedKeys.has(normalizeDriverNameKey(name)));

  setSelectOptions("rosterDriverQuickAdd", addableNames, "Select driver to add", addableNames[0] || "");
  addBtn.disabled = !addableNames.length;

  chipsWrap.innerHTML = includedNames.map((name) => `
    <button type="button" class="contact-link contact-link-neutral" data-action="remove-roster-driver" data-driver-name="${escapeHtml(name)}" title="Remove ${escapeHtml(name)} from this roster">
      ${escapeHtml(name)} &times;
    </button>
  `).join("");

  status.textContent = `${includedNames.length} driver${includedNames.length === 1 ? "" : "s"} included in this roster.`;
}

function purgeExcludedDriversFromRoster() {
  const before = state.roster.length;
  state.roster = state.roster.filter((row) => !ROSTER_EXCLUDED_DRIVER_NAMES.has(normalizeDriverNameKey(row.driverName)));
  if (state.roster.length !== before) {
    saveData();
  }
}

function purgeExcludedDriversFromDriverStore() {
  const currentDrivers = normalizeDriverRecords(readArray(DRIVERS_KEY));
  const filteredDrivers = currentDrivers.filter((driver) => !ROSTER_EXCLUDED_DRIVER_NAMES.has(normalizeDriverNameKey(driver.name)));
  if (filteredDrivers.length === currentDrivers.length) return;
  localStorage.setItem(DRIVERS_KEY, JSON.stringify(filteredDrivers));
  const updatedAt = String(Date.now());
  localStorage.setItem(DRIVERS_UPDATED_KEY, updatedAt);
  window.dispatchEvent(new CustomEvent("opx:drivers-updated", { detail: { updatedAt } }));
  try {
    driversChannel?.postMessage({ type: "drivers-updated", updatedAt });
  } catch {
    // no-op
  }
}

function takeDriverOffSelectedWeek(driverName) {
  const canonicalName = canonicalDriverName(driverName);
  if (!canonicalName) return;
  const weekKey = selectedWeekStartKey();
  const weekKeys = getWeekDates(weekKey).map(dateToKey);
  if (!weekKeys.length) return;
  const weekSet = new Set(weekKeys);
  const nameKey = normalizeDriverNameKey(canonicalName);
  const before = state.roster.length;
  state.roster = state.roster.filter((row) => {
    if (!weekSet.has(String(row.shiftDate || "").trim())) return true;
    return normalizeDriverNameKey(row.driverName) !== nameKey;
  });
  if (state.roster.length !== before) {
    saveData();
  }
  removeDriverFromRosterPool(canonicalName);
}

function getActiveTrucks() {
  const rows = readArray(TRUCKS_KEY);
  const source = rows.length ? rows : FALLBACK_TRUCKS;
  return source
    .filter((item) => String(item.status || "").toLowerCase() !== "under repair")
    .sort((a, b) => String(a.truckNumber || "").localeCompare(String(b.truckNumber || "")));
}

function ensureRosterReferenceFallbacks() {
  const drivers = readArray(DRIVERS_KEY);
  const trucks = readArray(TRUCKS_KEY);
  const normalizedDrivers = normalizeDriverRecords(drivers);

  if (!drivers.length) {
    localStorage.setItem(DRIVERS_KEY, JSON.stringify(FALLBACK_DRIVERS));
  } else if (JSON.stringify(drivers) !== JSON.stringify(normalizedDrivers)) {
    localStorage.setItem(DRIVERS_KEY, JSON.stringify(normalizedDrivers));
  }
  if (!trucks.length) {
    localStorage.setItem(TRUCKS_KEY, JSON.stringify(FALLBACK_TRUCKS));
  }
}

function getConfiguredPrimaryTruckForDriver(driverName) {
  return PRIMARY_TRUCK_BY_DRIVER.get(String(driverName || "").trim()) || "";
}

function getMatchedTruckForDriver(driverName) {
  const name = String(driverName || "").trim();
  if (!name) return "";

  const activeTruckNumbers = new Set(getActiveTrucks().map((item) => String(item.truckNumber || "").trim()).filter(Boolean));
  for (let index = state.roster.length - 1; index >= 0; index -= 1) {
    const row = state.roster[index];
    if (row.driverName === name && activeTruckNumbers.has(String(row.truckNumber || "").trim())) {
      return row.truckNumber;
    }
  }

  const configuredTruck = getConfiguredPrimaryTruckForDriver(name);
  if (configuredTruck && activeTruckNumbers.has(configuredTruck)) {
    return configuredTruck;
  }

  const activeDrivers = getActiveDrivers();
  const activeTrucks = getActiveTrucks();
  const matchIndex = activeDrivers.findIndex((item) => item.name === name);
  return matchIndex >= 0 ? (activeTrucks[matchIndex]?.truckNumber || "") : "";
}

function getPreferredTruckForDriver(driverName) {
  const matched = getMatchedTruckForDriver(driverName);
  if (matched) return matched;
  const configuredTruck = getConfiguredPrimaryTruckForDriver(driverName);
  if (configuredTruck) return configuredTruck;
  const activeDrivers = getActiveDrivers();
  const activeTrucks = getActiveTrucks();
  const matchIndex = activeDrivers.findIndex((item) => item.name === driverName);
  return matchIndex >= 0 ? (activeTrucks[matchIndex]?.truckNumber || "") : "";
}

function buildWeekTemplateRows(weekKeys, actualWeekRows = []) {
  const uniqueActualRows = dedupeRosterRows(actualWeekRows);
  const weekStartKey = String(weekKeys?.[0] || "").trim();
  const activeDrivers = getActiveDrivers().slice(0, TARGET_DRIVERS);
  const establishedDriverNames = new Set(
    state.roster
      .filter((row) => row && typeof row === "object" && !row.isTemplate)
      .filter((row) => {
        const shiftDate = String(row.shiftDate || "").trim();
        if (!shiftDate || !weekStartKey) return false;
        return shiftDate < weekStartKey;
      })
      .map((row) => canonicalDriverName(row.driverName))
      .filter(Boolean)
  );
  const hasDriverHistory = establishedDriverNames.size > 0;
  const existingDriverDates = new Set();
  const existingTruckDates = new Set();
  const templateRows = [];

  uniqueActualRows.forEach((row) => {
    const driverName = String(row.driverName || "").trim();
    const truckNumber = String(row.truckNumber || "").trim();
    const shiftDate = String(row.shiftDate || "").trim();
    if (driverName && shiftDate) existingDriverDates.add(`${driverName}__${shiftDate}`);
    if (truckNumber && shiftDate) existingTruckDates.add(`${truckNumber}__${shiftDate}`);
  });

  activeDrivers.forEach((driver, index) => {
    const driverName = String(driver.name || "").trim();
    if (isAutoTemplateBlockedDriver(driverName)) return;
    if (hasDriverHistory && !establishedDriverNames.has(driverName)) return;
    const truckNumber = String(getPreferredTruckForDriver(driverName) || "").trim();
    if (!driverName || !truckNumber) return;

    weekKeys.slice(0, 5).forEach((shiftDate) => {
      if (existingDriverDates.has(`${driverName}__${shiftDate}`) || existingTruckDates.has(`${truckNumber}__${shiftDate}`)) return;
      templateRows.push({
        id: `template-${shiftDate}-${driver.id || index}`,
        driverName,
        truckNumber,
        nightRun: false,
        shiftDate,
        shiftTime: DEFAULT_SHIFT_TIME,
        startLocation: DEFAULT_START_LOCATION,
        route: DEFAULT_ROUTE,
        status: "Scheduled",
        isTemplate: true
      });
    });
  });

  return templateRows;
}

function getAssignedTruckNumbersForDate(dateKey, excludeId = "") {
  if (!dateKey) return new Set();
  return new Set(
    state.roster
      .filter((row) => row.shiftDate === dateKey && row.id !== excludeId)
      .map((row) => String(row.truckNumber || "").trim())
      .filter(Boolean)
  );
}

function getAvailableTruckNumbers(dateKey, excludeId = "") {
  const activeTruckNumbers = getActiveTrucks().map((item) => String(item.truckNumber || "").trim()).filter(Boolean);
  if (!dateKey) return activeTruckNumbers;
  const assigned = getAssignedTruckNumbersForDate(dateKey, excludeId);
  return activeTruckNumbers.filter((truckNumber) => !assigned.has(truckNumber));
}

function setSelectOptions(selectId, values, placeholder, currentValue = "") {
  const select = document.getElementById(selectId);
  if (!select) return;

  const uniqueValues = [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  if (currentValue && !uniqueValues.includes(currentValue)) {
    uniqueValues.unshift(currentValue);
  }

  select.innerHTML = [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...uniqueValues.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
  ].join("");

  select.value = currentValue || "";
}

function populateRosterPickers(selectedDriver = "", selectedTruck = "", options = {}) {
  const driverNames = getActiveDrivers().map((item) => item.name || "");
  setSelectOptions("driverName", driverNames, "Select driver", selectedDriver);

  const shiftDate = document.getElementById("shiftDate")?.value || "";
  const editId = document.getElementById("rosterId")?.value || "";
  const availableTruckNumbers = getAvailableTruckNumbers(shiftDate, editId);
  const matchedTruck = getMatchedTruckForDriver(selectedDriver);
  const placeholder = shiftDate ? "Select available truck" : "Select truck";

  let nextTruck = selectedTruck;
  if (options.preferMatched) {
    nextTruck = availableTruckNumbers.includes(matchedTruck) ? matchedTruck : (availableTruckNumbers[0] || "");
  } else if (!nextTruck || !availableTruckNumbers.includes(nextTruck)) {
    nextTruck = availableTruckNumbers.includes(matchedTruck) ? matchedTruck : (availableTruckNumbers[0] || "");
  }

  if (options.preserveSelectedTruck && selectedTruck) {
    nextTruck = selectedTruck;
  }

  setSelectOptions("truckNumber", availableTruckNumbers, placeholder, nextTruck);
}

function syncStatusDependentFields() {
  const statusField = document.getElementById("rosterStatus");
  const truckField = document.getElementById("truckNumber");
  const timeField = document.getElementById("shiftTime");
  const startLocationField = document.getElementById("startLocation");
  const routeField = document.getElementById("route");
  const nightRunField = document.getElementById("rosterNightRun");
  const leaveRangeWrap = document.getElementById("leaveRangeWrap");
  const leaveStartField = document.getElementById("leaveStartDate");
  const returnField = document.getElementById("returnDate");
  const shiftDateField = document.getElementById("shiftDate");
  if (!statusField || !truckField || !timeField || !startLocationField || !routeField || !nightRunField || !leaveRangeWrap || !leaveStartField || !returnField || !shiftDateField) return;

  if (isAwayStatus(statusField.value)) {
    truckField.required = false;
    truckField.disabled = true;
    truckField.value = "";
    startLocationField.required = false;
    startLocationField.disabled = true;
    startLocationField.value = "";
    nightRunField.checked = false;
    nightRunField.disabled = true;
    if (!timeField.value || timeField.value === DEFAULT_SHIFT_TIME) timeField.value = defaultAwayShiftTime(statusField.value);
    if (!routeField.value || routeField.value === DEFAULT_ROUTE) routeField.value = defaultAwayRoute(statusField.value);
    if (isLeaveStatus(statusField.value)) {
      leaveRangeWrap.hidden = false;
      leaveStartField.required = true;
      returnField.required = true;
      if (!leaveStartField.value) leaveStartField.value = shiftDateField.value || todayKey();
      if (!returnField.value) returnField.value = leaveStartField.value;
    } else {
      leaveRangeWrap.hidden = true;
      leaveStartField.required = false;
      returnField.required = false;
      leaveStartField.value = "";
      returnField.value = "";
    }
    return;
  }

  leaveRangeWrap.hidden = true;
  leaveStartField.required = false;
  returnField.required = false;
  leaveStartField.value = "";
  returnField.value = "";
  truckField.disabled = false;
  truckField.required = true;
  startLocationField.disabled = false;
  startLocationField.required = true;
  if (!startLocationField.value) startLocationField.value = DEFAULT_START_LOCATION;
  nightRunField.disabled = false;
  if (timeField.value === LEAVE_SHIFT_TIME || timeField.value === ABSENT_SHIFT_TIME) timeField.value = DEFAULT_SHIFT_TIME;
  if (routeField.value === LEAVE_ROUTE || routeField.value === ABSENT_ROUTE) routeField.value = DEFAULT_ROUTE;
}

function inferLeaveRange(driverName, shiftDate) {
  const targetKey = String(shiftDate || "").trim();
  const name = String(driverName || "").trim();
  if (!name || !targetKey) return { start: targetKey, end: targetKey };
  const leaveDates = new Set(
    state.roster
      .filter((row) => row.driverName === name && row.status === "Leave")
      .map((row) => String(row.shiftDate || "").trim())
      .filter(Boolean)
  );
  if (!leaveDates.has(targetKey)) return { start: targetKey, end: targetKey };
  let start = targetKey;
  let end = targetKey;
  let cursor = parseDateOnly(targetKey);
  while (cursor) {
    cursor.setDate(cursor.getDate() - 1);
    const prevKey = dateToKey(cursor);
    if (!leaveDates.has(prevKey)) break;
    start = prevKey;
  }
  cursor = parseDateOnly(targetKey);
  while (cursor) {
    cursor.setDate(cursor.getDate() + 1);
    const nextKey = dateToKey(cursor);
    if (!leaveDates.has(nextKey)) break;
    end = nextKey;
  }
  return { start, end };
}

function scrollFormIntoView() {
  document.getElementById("rosterForm")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

function loadTemplateIntoForm(item) {
  document.getElementById("rosterForm").reset();
  document.getElementById("rosterId").value = "";
  document.getElementById("shiftDate").value = item.shiftDate || "";
  document.getElementById("driverName").value = item.driverName || "";
  document.getElementById("truckNumber").value = item.truckNumber || "";
  document.getElementById("rosterNightRun").checked = Boolean(item.nightRun);
  document.getElementById("shiftTime").value = item.shiftTime || DEFAULT_SHIFT_TIME;
  document.getElementById("startLocation").value = item.startLocation || DEFAULT_START_LOCATION;
  document.getElementById("route").value = item.route || DEFAULT_ROUTE;
  document.getElementById("rosterStatus").value = item.status || "Scheduled";
  document.getElementById("leaveStartDate").value = item.leaveStartDate || item.shiftDate || "";
  document.getElementById("returnDate").value = item.returnDate || item.shiftDate || "";
  populateRosterPickers(item.driverName || "", item.truckNumber || "", { preserveSelectedTruck: true });
  syncStatusDependentFields();
  resetBatchControls();
  scrollFormIntoView();
}

function hasTruckConflict(truckNumber, shiftDate, excludeIds = []) {
  if (!truckNumber || !shiftDate) return false;
  const exclusions = new Set(excludeIds);
  return state.roster.some((row) => row.shiftDate === shiftDate && row.truckNumber === truckNumber && !exclusions.has(row.id));
}

function applyBoardMoveOrSwap(sourceId, targetMeta, targetShiftId = "") {
  const source = state.roster.find((row) => row.id === sourceId);
  if (!source) return;

  const targetDriverName = String(targetMeta?.driverName || "").trim();
  const targetShiftDate = String(targetMeta?.shiftDate || "").trim();
  const targetTruckNumber = String(targetMeta?.truckNumber || "").trim() || getPreferredTruckForDriver(targetDriverName);
  if (!targetDriverName || !targetShiftDate) return;

  if (targetShiftId && targetShiftId !== sourceId) {
    const target = state.roster.find((row) => row.id === targetShiftId);
    if (!target) return;

    const nextSource = normalizeRosterPayload({
      ...source,
      driverName: target.driverName,
      shiftDate: target.shiftDate,
      truckNumber: isAwayStatus(source.status) ? "" : (target.truckNumber || getPreferredTruckForDriver(target.driverName))
    });
    const nextTarget = normalizeRosterPayload({
      ...target,
      driverName: source.driverName,
      shiftDate: source.shiftDate,
      truckNumber: isAwayStatus(target.status) ? "" : (source.truckNumber || getPreferredTruckForDriver(source.driverName))
    });

    if (nextSource.truckNumber && hasTruckConflict(nextSource.truckNumber, nextSource.shiftDate, [source.id, target.id])) {
      alert(`Truck ${nextSource.truckNumber} is already assigned on ${nextSource.shiftDate}.`);
      return;
    }
    if (nextTarget.truckNumber && hasTruckConflict(nextTarget.truckNumber, nextTarget.shiftDate, [source.id, target.id])) {
      alert(`Truck ${nextTarget.truckNumber} is already assigned on ${nextTarget.shiftDate}.`);
      return;
    }

    state.roster = state.roster.map((row) => {
      if (row.id === source.id) return nextSource;
      if (row.id === target.id) return nextTarget;
      return row;
    });
    saveData();
    refreshWeekView();
    return;
  }

  const nextSource = normalizeRosterPayload({
    ...source,
    driverName: targetDriverName,
    shiftDate: targetShiftDate,
    truckNumber: isAwayStatus(source.status) ? "" : (targetTruckNumber || source.truckNumber)
  });

  if (nextSource.truckNumber && hasTruckConflict(nextSource.truckNumber, nextSource.shiftDate, [source.id])) {
    alert(`Truck ${nextSource.truckNumber} is already assigned on ${nextSource.shiftDate}.`);
    return;
  }

  state.roster = state.roster.map((row) => row.id === source.id ? nextSource : row);
  saveData();
  refreshWeekView();
}

function getBatchToggle() {
  return document.getElementById("batchAddWeekdays");
}

function getBatchWeekdayInputs() {
  return Array.from(document.querySelectorAll("input[name='weekdayBatch']"));
}

function syncBatchControls() {
  const toggle = getBatchToggle();
  const grid = document.getElementById("weekdayBatchGrid");
  if (!toggle || !grid) return;

  const isEditing = Boolean(document.getElementById("rosterId")?.value);
  const batchActive = !isEditing && toggle.checked;
  toggle.disabled = isEditing;
  grid.classList.toggle("is-disabled", !batchActive);
  getBatchWeekdayInputs().forEach((input) => {
    input.disabled = !batchActive;
  });
}

function resetBatchControls() {
  const toggle = getBatchToggle();
  if (toggle) toggle.checked = false;
  getBatchWeekdayInputs().forEach((input) => {
    input.checked = true;
  });
  syncBatchControls();
}

function getBatchShiftDates(anchorDate) {
  const toggle = getBatchToggle();
  if (!toggle || !toggle.checked) return [];

  const monday = mondayOf(anchorDate);
  if (!monday) return [];

  return getBatchWeekdayInputs()
    .filter((input) => input.checked)
    .map((input) => Number(input.value))
    .filter((offset) => Number.isInteger(offset) && offset >= 0 && offset <= 4)
    .map((offset) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + offset);
      return dateToKey(date);
    });
}

function isTruckAvailableForDate(truckNumber, shiftDate, excludeId = "") {
  if (!truckNumber || !shiftDate) return false;
  return !getAssignedTruckNumbersForDate(shiftDate, excludeId).has(String(truckNumber || "").trim());
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
  if (target === "_self") {
    window.location.assign(url);
    return;
  }

  const popup = window.open(url, target, "noopener,noreferrer");
  if (popup) return;

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = target;
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function openWhatsAppContact(phone, text, driverName) {
  const whatsappNumber = toWhatsAppNumber(phone);
  if (!whatsappNumber) {
    alert(`WhatsApp number is not valid for ${driverName}.`);
    return;
  }

  const url = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`;
  launchLink(url);
}

function buildDriverLookup() {
  const contacts = readContacts();
  return new Map(readArray(DRIVERS_KEY).map((driver) => [
    driver.name,
    {
      id: driver.id,
      name: driver.name || "",
      phone: driver.phone || "",
      email: String(driver.email || contacts?.[driver.id]?.email || "").trim()
    }
  ]));
}

function getDriverContactByName(driverName) {
  return buildDriverLookup().get(driverName) || { id: "", name: driverName || "", phone: "", email: "" };
}

function renderRosterContactButtons(item) {
  const contact = getDriverContactByName(item.driverName);
  const hasPhone = Boolean(cleanPhone(contact.phone));
  const weekKey = selectedWeekStartKey();
  return `<div class='contact-actions'>
    <button type='button' class='contact-link contact-link-sms' data-action='sms-shift' data-id='${item.id}' ${hasPhone ? "" : "disabled"}>SMS</button>
    <button type='button' class='contact-link contact-link-email' data-action='email-shift' data-id='${item.id}' ${contact.email ? "" : "disabled"}>Email</button>
    ${renderAcknowledgementBadge(item.driverName, weekKey, true)}
  </div>`;
}

function displayTruckNumber(item) {
  return isAwayStatus(item.status) ? "-" : (item.truckNumber || "-");
}

function displayShiftTime(item) {
  return item.shiftTime || (isAwayStatus(item.status) ? defaultAwayShiftTime(item.status) : DEFAULT_SHIFT_TIME);
}

function displayRoute(item) {
  return normalizeLegacyRoute(item.route) || (isAwayStatus(item.status) ? defaultAwayRoute(item.status) : DEFAULT_ROUTE);
}

function displayStartLocation(item) {
  if (isAwayStatus(item.status)) return "";
  return normalizeStartLocation(item.startLocation, item.route);
}

function getContactWeekKeys(item) {
  const selectedWeekKey = selectedWeekStartKey();
  const selectedWeekKeys = getWeekDates(selectedWeekKey).map(dateToKey);
  if (selectedWeekKeys.includes(item.shiftDate)) return selectedWeekKeys;

  const monday = mondayOf(item.shiftDate);
  return monday ? getWeekDates(dateToKey(monday)).map(dateToKey) : [];
}

function buildRosterConfirmationUrl(driverName, weekKey) {
  const name = canonicalDriverName(driverName);
  if (!name || !weekKey) return "";
  const url = new URL("./roster-confirm.html", window.location.href);
  url.searchParams.set("driver", name);
  url.searchParams.set("week", weekKey);
  return url.toString();
}

function weekKeyFromWeekKeys(weekKeys, fallbackShiftDate = "") {
  if (Array.isArray(weekKeys) && weekKeys.length) return String(weekKeys[0] || "").trim();
  const monday = mondayOf(fallbackShiftDate || todayKey());
  return monday ? dateToKey(monday) : "";
}

function summarizeDriverDay(entries) {
  if (!entries.length) return "Off";
  if (entries.some((entry) => entry.status === "Leave")) return "On Leave";
  if (entries.some((entry) => entry.status === "Absent")) return "Absent";

  return entries.map((entry) => {
    const truck = displayTruckNumber(entry);
    const dispatchLabel = truck === "-" ? "Delivery run" : `Truck ${truck} delivery run`;
    const startLocation = displayStartLocation(entry);
    return `${startLocation} | ${dispatchLabel}${entry.nightRun ? " + Night Run" : ""}`.trim();
  }).join(" | ");
}

function buildWeeklyWhatsAppMessage(item) {
  const weekKeys = getContactWeekKeys(item);
  const weekKey = weekKeyFromWeekKeys(weekKeys, item.shiftDate);
  const confirmationUrl = buildRosterConfirmationUrl(item.driverName, weekKey);
  if (!weekKeys.length) {
    const truckLabel = displayTruckNumber(item) === "-" ? "No truck assigned" : `Truck ${displayTruckNumber(item)}`;
    const lines = [
      `Hi ${item.driverName},`,
      `Your Onpoint Express shift for ${item.shiftDate}:`,
      [displayStartLocation(item), `${truckLabel}${item.nightRun ? " + Night Run" : ""}`, displayShiftTime(item), `${item.status}.`].filter(Boolean).join(" | "),
      ""
    ];
    if (confirmationUrl) {
      lines.push(`Confirm here: ${confirmationUrl}`, "");
    }
    lines.push("Please confirm when received.");
    return lines.join("\n");
  }

  const driverWeekRows = dedupeRosterRows(
    state.roster.filter((row) => row.driverName === item.driverName && weekKeys.includes(row.shiftDate))
  );

  const dayLines = weekKeys.map((dateKey, index) => {
    const entries = driverWeekRows
      .filter((row) => row.shiftDate === dateKey)
      .sort((a, b) => String(displayShiftTime(a)).localeCompare(String(displayShiftTime(b))));
    return `${DAY_NAMES[index]}: ${summarizeDriverDay(entries)}`;
  });

  const lines = [
    `Hi ${item.driverName},`,
    `Your Onpoint Express roster for this week:`,
    ...dayLines,
    ""
  ];
  if (confirmationUrl) {
    lines.push(`Confirm here: ${confirmationUrl}`, "");
  }
  lines.push("Please confirm when received.");
  return lines.join("\n");
}

function buildWeeklyDriverMessage(driverName, weekKeys, sourceRows = state.roster) {
  const name = String(driverName || "").trim();
  if (!name || !weekKeys.length) return "";
  const driverRows = dedupeRosterRows(
    sourceRows.filter((row) => row.driverName === name && weekKeys.includes(row.shiftDate))
  );

  const dayLines = weekKeys.map((dateKey, index) => {
    const entries = driverRows
      .filter((row) => row.shiftDate === dateKey)
      .sort((a, b) => String(displayShiftTime(a)).localeCompare(String(displayShiftTime(b))));
    return `${DAY_NAMES[index]}: ${summarizeDriverDay(entries)}`;
  });

  const confirmationUrl = buildRosterConfirmationUrl(name, weekKeyFromWeekKeys(weekKeys));
  const lines = [
    `Hi ${name},`,
    "Your Onpoint Express roster for this week:",
    ...dayLines,
    ""
  ];
  if (confirmationUrl) {
    lines.push(`Confirm here: ${confirmationUrl}`, "");
  }
  lines.push("Please confirm when received.");
  return lines.join("\n");
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    return successMessage || "Copied to clipboard.";
  } catch (error) {
    console.warn("Clipboard copy failed:", error);
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    return successMessage || "Copied to clipboard.";
  }
}

function setDispatchStatus(message, tone = "muted") {
  const status = document.getElementById("rosterDispatchStatus");
  if (!status) return;
  status.textContent = message || "";
  status.className = `data-status ${tone}`.trim();
}

function drawWeekWorkflow() {
  const weekKey = selectedWeekStartKey();
  const title = document.getElementById("weekWorkflowTitle");
  const meta = document.getElementById("weekWorkflowMeta");
  const badgeWrap = document.getElementById("weekWorkflowBadgeWrap");
  if (!title || !meta || !badgeWrap) return;

  if (!weekKey) {
    title.textContent = "Draft";
    meta.textContent = "Choose a week to manage its approval flow.";
    badgeWrap.innerHTML = renderWeekWorkflowBadge("", false);
    return;
  }

  const workflow = getWeekWorkflow(weekKey);
  title.textContent = workflow.label;
  meta.textContent = workflow.updatedAt
    ? `Updated ${formatAcknowledgementTime(workflow.updatedAt)} by ${workflow.updatedBy || "System"}.`
    : `This week is currently ${workflow.label.toLowerCase()}.`;
  badgeWrap.innerHTML = renderWeekWorkflowBadge(weekKey, false);
}

function drawWhatsAppDispatch() {
  const container = document.getElementById("rosterWhatsAppDispatch");
  if (!container) return;

  const { weekKey, weekKeys, weekRows } = getWeekContext();
  if (!weekKey) {
    setMarkupIfChanged(container, "");
    setDispatchStatus("Choose a valid week first.", "error-text");
    return;
  }

  const driverNames = [...new Set([
    ...getActiveDrivers().map((driver) => String(driver.name || "").trim()).filter(Boolean),
    ...weekRows.map((row) => String(row.driverName || "").trim()).filter(Boolean)
  ])];

  if (!driverNames.length) {
    setMarkupIfChanged(container, "");
    setDispatchStatus("No drivers are available for this week yet.");
    return;
  }

  const weekWorkflowBadge = renderWeekWorkflowBadge(weekKey, true);
  const cards = driverNames.map((driverName) => {
    const contact = getDriverContactByName(driverName);
    const phone = cleanPhone(contact.phone);
    const hasPhone = Boolean(phone);
    const message = buildWeeklyDriverMessage(driverName, weekKeys, weekRows);
    const workedDays = new Set(weekRows.filter((row) => row.driverName === driverName && !isAwayStatus(row.status)).map((row) => row.shiftDate)).size;
    const awayDays = new Set(weekRows.filter((row) => row.driverName === driverName && isAwayStatus(row.status)).map((row) => row.shiftDate)).size;
    const acknowledgement = getWeekAcknowledgement(driverName, weekKey);
    return `
      <article class="note-card">
        <p>Driver Dispatch</p>
        <h3>${escapeHtml(driverName)}</h3>
        <span>${hasPhone ? `WhatsApp ready for ${escapeHtml(phone)}` : "Missing phone number on Drivers page."}</span>
        <span>${workedDays} planned day${workedDays === 1 ? "" : "s"} | ${awayDays} away day${awayDays === 1 ? "" : "s"}</span>
        <div class="ack-row">
          ${renderAcknowledgementBadge(driverName, weekKey)}
          ${weekWorkflowBadge}
          <span class="muted">${escapeHtml(formatAcknowledgementTime(acknowledgement.updatedAt))}</span>
        </div>
        <div class="table-actions table-actions-stack">
          <div class="contact-actions">
            <button type="button" class="contact-link contact-link-whatsapp" data-action="whatsapp-week-driver" data-driver-name="${escapeHtml(driverName)}" ${hasPhone ? "" : "disabled"}>WhatsApp</button>
            <button type="button" class="contact-link contact-link-sms" data-action="copy-week-driver" data-driver-name="${escapeHtml(driverName)}">Copy Message</button>
            <button type="button" class="contact-link contact-link-email" data-action="copy-confirm-link" data-driver-name="${escapeHtml(driverName)}">Copy Confirm Link</button>
          </div>
          <div class="contact-actions">
            <button type="button" class="contact-link contact-link-neutral" data-action="ack-week-driver" data-driver-name="${escapeHtml(driverName)}" data-status="sent">Mark Sent</button>
            <button type="button" class="contact-link contact-link-viewed" data-action="ack-week-driver" data-driver-name="${escapeHtml(driverName)}" data-status="viewed">Mark Viewed</button>
            <button type="button" class="contact-link contact-link-confirmed" data-action="ack-week-driver" data-driver-name="${escapeHtml(driverName)}" data-status="confirmed">Mark Confirmed</button>
          </div>
          <span class="muted">${escapeHtml(message.split("\n").slice(0, 2).join(" "))}</span>
        </div>
      </article>
    `;
  }).join("");

  setMarkupIfChanged(container, cards);
  const readyCount = driverNames.filter((driverName) => Boolean(cleanPhone(getDriverContactByName(driverName).phone))).length;
  const missingCount = driverNames.length - readyCount;
  const counts = acknowledgementCounts(driverNames, weekKey);
  const sharedAckNote = state.sharedAcknowledgementsConfigured
    ? ""
    : " Shared confirmation sync is not configured yet, so acknowledgement status is local on this device.";
  setDispatchStatus(
    `${readyCount}/${driverNames.length} drivers have WhatsApp-ready phone numbers for week ${weekKey}. ${counts.confirmed}/${counts.total} confirmed, ${counts.viewed} viewed, ${counts.sent} sent.${missingCount ? ` ${missingCount} still need a phone number on the Drivers page.` : ""}${sharedAckNote}`,
    state.sharedAcknowledgementsConfigured ? "muted" : "warning-text"
  );
}

function buildAllDriversWeekSummary() {
  const { weekKey, weekKeys, weekRows } = getWeekContext();
  const driverNames = [...new Set([
    ...getActiveDrivers().map((driver) => String(driver.name || "").trim()).filter(Boolean),
    ...weekRows.map((row) => String(row.driverName || "").trim()).filter(Boolean)
  ])];
  const messages = driverNames.map((driverName) => buildWeeklyDriverMessage(driverName, weekKeys, weekRows));

  return [
    `Onpoint Express Week View ${weekKey}`,
    "",
    messages.join("\n\n--------------------\n\n")
  ].join("\n");
}

function openShiftContact(channel, item) {
  const contact = getDriverContactByName(item.driverName);
  const phone = cleanPhone(contact.phone);
  const truckLabel = displayTruckNumber(item) === "-" ? "No truck assigned" : `Truck ${displayTruckNumber(item)}`;
  const message = [
    `Hi ${item.driverName},`,
    `Your Onpoint Express shift for ${item.shiftDate}:`,
    [displayStartLocation(item), `${truckLabel}${item.nightRun ? " + Night Run" : ""}`, displayShiftTime(item), `${item.status}.`].filter(Boolean).join(" | "),
    "",
    "Please confirm when received."
  ].join("\n");

  if (channel === "email") {
    if (!contact.email) {
      alert(`No email saved for ${item.driverName} yet.`);
      return;
    }
    const subject = encodeURIComponent(`Onpoint Express shift update for ${item.driverName}`);
    const body = encodeURIComponent(`${message}\n\nPlease confirm when received.`);
    launchLink(`mailto:${contact.email}?subject=${subject}&body=${body}`, "_self");
    return;
  }

  if (!phone) {
    alert(`No phone number saved for ${item.driverName} yet.`);
    return;
  }

  if (channel === "sms") {
    launchLink(`sms:${phone}?body=${encodeURIComponent(message)}`, "_self");
    return;
  }

  if (channel === "whatsapp") {
    openWhatsAppContact(phone, buildWeeklyWhatsAppMessage(item), item.driverName);
  }
}

function normalizeRouteLabel(route) {
  const text = String(route || "").trim();
  if (!text) return "Run";
  return text.length > 24 ? `${text.slice(0, 21)}...` : text;
}

function firstTruckForDriver(rows) {
  return rows.find((row) => row.truckNumber)?.truckNumber || "-";
}

function buildDriverPlans(weekRows) {
  const activeDrivers = getActiveDrivers();
  const activeDriverNames = activeDrivers.map((item) => item.name).filter(Boolean);
  const namesFromRoster = [...new Set(weekRows.map((item) => item.driverName).filter(Boolean))];
  const combined = [...new Set([...activeDriverNames, ...namesFromRoster])].slice(0, TARGET_DRIVERS);

  while (combined.length < TARGET_DRIVERS) {
    combined.push(`Open Driver Slot ${combined.length + 1}`);
  }

  return combined.map((driverName) => {
    const driverRows = weekRows.filter((row) => row.driverName === driverName);
    const assignments = {};

    driverRows.forEach((row) => {
      if (!assignments[row.shiftDate]) assignments[row.shiftDate] = [];
      assignments[row.shiftDate].push(row);
    });

    const plannedDays = Object.keys(assignments).length;
    const weekdayDays = Object.keys(assignments).filter((dateKey) => {
      const date = parseDateOnly(dateKey);
      const day = date?.getDay?.() ?? -1;
      return day >= 1 && day <= 5;
    }).length;
    const weekendDays = Object.keys(assignments).filter((dateKey) => {
      const date = parseDateOnly(dateKey);
      const day = date?.getDay?.() ?? -1;
      return day === 0 || day === 6;
    }).length;

    return {
      driverName,
      truckNumber: firstTruckForDriver(driverRows),
      assignments,
      plannedDays,
      weekdayDays,
      weekendDays,
      isPlaceholder: driverRows.length === 0 && driverName.startsWith("Open Driver Slot ")
    };
  });
}

function targetTone(plannedDays) {
  if (plannedDays >= TARGET_DAYS_PER_DRIVER) return "on-target";
  if (plannedDays >= TARGET_DAYS_PER_DRIVER - 1) return "near-target";
  return "under-target";
}

function drawBoardLegend() {
  const legend = document.getElementById("rosterBoardLegend");
  if (!legend) return;

  const items = [
    { tone: "live", label: "Scheduled" },
    { tone: "done", label: "Completed" },
    { tone: "leave", label: "Leave" },
    { tone: "absent", label: "Absent" },
    { tone: "night", label: "Night Run +" },
    { tone: "weekend", label: "Weekend lane" }
  ];

  legend.innerHTML = items.map((item) => `<div class="legend-chip"><span class="legend-dot ${item.tone}"></span>${item.label}</div>`).join("");
}

function drawStats() {
  const panel = document.getElementById("rosterStats");
  if (!auth.can("viewStats")) {
    panel.style.display = "none";
    return;
  }

  const { weekRows } = getWeekContext();
  const activeDrivers = getActiveDrivers();
  const activeTrucks = getActiveTrucks();
  const driversPlanned = new Set(weekRows.map((item) => item.driverName).filter(Boolean)).size;
  const trucksAssigned = new Set(weekRows.map((item) => item.truckNumber).filter(Boolean)).size;
  const driverPlans = buildDriverPlans(weekRows);
  const targetHit = driverPlans.filter((item) => item.plannedDays >= TARGET_DAYS_PER_DRIVER).length;
  const weekendShifts = weekRows.filter((item) => {
    const date = parseDateOnly(item.shiftDate);
    const day = date?.getDay?.() ?? -1;
    return day === 0 || day === 6;
  }).length;

  const stats = [
    { label: "Drivers Planned", value: `${driversPlanned}/${Math.min(activeDrivers.length || TARGET_DRIVERS, TARGET_DRIVERS)}` },
    { label: "Trucks Assigned", value: `${trucksAssigned}/${Math.min(activeTrucks.length || TARGET_TRUCKS, TARGET_TRUCKS)}` },
    { label: "Drivers At 5 Days", value: String(targetHit) },
    { label: "Weekday Shifts", value: String(weekRows.filter((x) => {
      const date = parseDateOnly(x.shiftDate);
      const day = date?.getDay?.() ?? -1;
      return day >= 1 && day <= 5;
    }).length) },
    { label: "Weekend Shifts", value: String(weekendShifts) }
  ];

  panel.style.display = "grid";
  panel.innerHTML = stats.map((s) => `<article class='stat-card'><p>${s.label}</p><h3>${s.value}</h3></article>`).join("");
}

function drawRosterModel() {
  const strip = document.getElementById("rosterRuleStrip");
  const activeDrivers = getActiveDrivers();
  const activeTrucks = getActiveTrucks();

  const items = [
    { label: "Active drivers", value: `${Math.min(activeDrivers.length, TARGET_DRIVERS)}/${TARGET_DRIVERS}` },
    { label: "Active trucks", value: `${Math.min(activeTrucks.length, TARGET_TRUCKS)}/${TARGET_TRUCKS}` },
    { label: "Driver target", value: `${TARGET_DAYS_PER_DRIVER} days` },
    { label: "Core pattern", value: "Mon-Fri" },
    { label: "Overflow", value: "Sat-Sun when required" }
  ];

  strip.innerHTML = items.map((item) => `<div class='rule-pill'><span>${item.label}</span><strong>${item.value}</strong></div>`).join("");
}

function buildBoardRowMarkup(plan, weekKeys) {
  const weekKey = weekKeys[0] || "";
  const acknowledgementBadge = plan.isPlaceholder ? "" : renderAcknowledgementBadge(plan.driverName, weekKey, true);
  const cells = weekKeys.map((dayKey, index) => {
    const items = plan.assignments[dayKey] || [];
    if (!items.length) {
      return `<td class='board-cell board-cell-empty ${index >= 5 ? "weekend-col" : ""}' data-drop-date='${dayKey}' data-drop-driver='${escapeHtml(plan.driverName)}' data-drop-truck='${escapeHtml(plan.truckNumber || "")}'><span>Off</span></td>`;
    }

    const cellBody = items.map((item) => {
      const isAway = isAwayStatus(item.status);
      const tone = isAway ? awayBadgeClass(item.status) : item.status === "Completed" ? "board-badge-done" : "board-badge-live";
      const runLabel = item.nightRun ? "<span>Night Run +</span>" : "";
      const templateLabel = item.isTemplate ? "<span>Template</span>" : "";
      const deleteButton = !item.isTemplate && auth.can("editRoster")
        ? `<button type='button' class='board-chip-delete' data-board-delete='${escapeHtml(item.id)}' aria-label='Delete shift for ${escapeHtml(item.driverName)} on ${escapeHtml(item.shiftDate)}' title='Delete shift'>&times;</button>`
        : "";
      const primaryLabel = isAway ? awayDisplayTitle(item.status) : displayTruckNumber(item);
      const detailLabel = isAway ? "Unavailable today" : normalizeRouteLabel(displayRoute(item));
      const badgeLabel = isAway ? awayBadgeLabel(item.status) : item.status;
      return `<div class='board-chip ${item.isTemplate ? "board-chip-template" : "board-chip-movable"} ${isAway ? awayChipClass(item.status) : ""} ${item.nightRun ? "board-chip-night" : ""} ${index >= 5 ? "weekend-col" : ""}'
        data-board-id='${escapeHtml(item.id)}'
        data-board-driver='${escapeHtml(item.driverName)}'
        data-board-date='${escapeHtml(item.shiftDate)}'
        data-board-truck='${escapeHtml(item.truckNumber || "")}'
        data-board-status='${escapeHtml(item.status)}'
        data-board-shift-time='${escapeHtml(item.shiftTime || "")}'
        data-board-start-location='${escapeHtml(item.startLocation || "")}'
        data-board-route='${escapeHtml(item.route || "")}'
        data-board-night-run='${item.nightRun ? "true" : "false"}'
        data-template='${item.isTemplate ? "true" : "false"}'
        draggable='${!item.isTemplate && auth.can("editRoster") ? "true" : "false"}'
        title='${item.isTemplate ? "Click to load this template into the form." : auth.can("editRoster") ? "Click to edit or drag to move/swap this shift." : "Shift card"}'>
        ${deleteButton}
        <strong>${primaryLabel}</strong>
        ${templateLabel}
        ${runLabel}
        <span>${detailLabel}</span>
        <em class='board-badge ${tone}'>${badgeLabel}</em>
      </div>`;
    }).join("");

    return `<td class='board-cell ${index >= 5 ? "weekend-col" : ""}' data-drop-date='${dayKey}' data-drop-driver='${escapeHtml(plan.driverName)}' data-drop-truck='${escapeHtml(plan.truckNumber || "")}'>${cellBody}</td>`;
  }).join("");

  const tone = targetTone(plan.plannedDays);
  const fillPercent = Math.min((plan.plannedDays / TARGET_DAYS_PER_DRIVER) * 100, 100);
  const nightRuns = Object.values(plan.assignments).flat().filter((item) => item.nightRun).length;
  const awayDays = Object.values(plan.assignments).flat().filter((item) => isAwayStatus(item.status)).length;
  const signature = [
    plan.driverName,
    plan.truckNumber,
    plan.plannedDays,
    plan.weekdayDays,
    plan.weekendDays,
    nightRuns,
    awayDays,
    weekKeys.map((dayKey) => (plan.assignments[dayKey] || []).map((item) => `${item.id}:${item.status}:${item.truckNumber}:${item.startLocation || ""}:${item.route || ""}:${item.nightRun ? 1 : 0}:${item.isTemplate ? 1 : 0}`).join("|")).join("~")
  ].join("::");

  return {
    key: plan.driverName,
    signature,
    markup: `<tr data-driver-key='${escapeHtml(plan.driverName)}' data-render-signature='${escapeHtml(signature)}'>
      <td class='board-driver-cell'>
        <div class='board-driver-name'>
          <strong>${plan.driverName}</strong>
          ${plan.isPlaceholder ? "<span class='board-slot-badge'>Open slot</span>" : `<span class='board-driver-meta'>Primary truck ${plan.truckNumber || "-"} | ${nightRuns} night run${nightRuns === 1 ? "" : "s"} | ${awayDays} away day${awayDays === 1 ? "" : "s"} | ${acknowledgementBadge}</span>`}
        </div>
      </td>
      ${cells}
      <td>
        <div class='load-indicator ${tone}'>
          <strong>${plan.plannedDays}/${TARGET_DAYS_PER_DRIVER}</strong>
          <span>${plan.weekdayDays} weekday | ${plan.weekendDays} weekend</span>
          <div class='load-meter'><span class='load-meter-fill' style='width:${fillPercent}%;'></span></div>
        </div>
      </td>
    </tr>`
  };
}

function drawDriverBoard() {
  const body = document.getElementById("rosterDriverBoardBody");
  const summary = document.getElementById("rosterBoardSummary");
  const notes = document.getElementById("rosterCoverageNotes");
  const { weekRows, weekKeys } = getWeekContext();
  const driverPlans = buildDriverPlans(weekRows);

  if (!driverPlans.length) {
    setMarkupIfChanged(body, `<tr><td colspan='9' class='empty'>No active drivers found yet. Add drivers on the Drivers page or create shifts for this week.</td></tr>`);
    setTextIfChanged(summary, "Weekly board is waiting for driver assignments.");
    setMarkupIfChanged(notes, "");
    return;
  }

  patchKeyedChildren(body, driverPlans.map((plan) => buildBoardRowMarkup(plan, weekKeys)), "data-driver-key");

  const onTarget = driverPlans.filter((plan) => plan.plannedDays >= TARGET_DAYS_PER_DRIVER).length;
  const underTarget = driverPlans.filter((plan) => plan.plannedDays < TARGET_DAYS_PER_DRIVER).length;
  const weekendDrivers = driverPlans.filter((plan) => plan.weekendDays > 0).length;
  const nightRunDrivers = driverPlans.filter((plan) => Object.values(plan.assignments).flat().some((item) => item.nightRun)).length;
  setTextIfChanged(summary, `${driverPlans.length} drivers are shown on the weekly board. ${onTarget} have hit the 5-day target, ${underTarget} still need more coverage, ${weekendDrivers} are carrying weekend work, and ${nightRunDrivers} are covering Night Run +.`);

  const coverageItems = [
    {
      label: "5-day target",
      value: `${onTarget}/${driverPlans.length} drivers`,
      detail: underTarget ? `${underTarget} drivers are still below target for the week.` : "All listed drivers have reached the weekly target."
    },
    {
      label: "Driver coverage",
      value: `${new Set(weekRows.map((item) => item.driverName).filter(Boolean)).size}/${TARGET_DRIVERS}`,
      detail: "Use this as the live check for whether all 7 roster slots are covered."
    },
    {
      label: "Truck coverage",
      value: `${new Set(weekRows.map((item) => item.truckNumber).filter(Boolean)).size}/${TARGET_TRUCKS}`,
      detail: "Truck count shows how many fleet units are actually assigned this week."
    },
    {
      label: "Weekend usage",
      value: `${weekendDrivers} drivers`,
      detail: weekendDrivers ? "Weekend shifts are being used as overflow coverage." : "No weekend shifts planned right now."
    },
    {
      label: "Night Run +",
      value: `${nightRunDrivers} drivers`,
      detail: nightRunDrivers ? "Night Run coverage is assigned as an extra layer after the main shift." : "No Night Run + cover is marked this week."
    }
  ];

  setMarkupIfChanged(notes, coverageItems.map((item) => `<article class='note-card'><p>${item.label}</p><h3>${item.value}</h3><span>${item.detail}</span></article>`).join(""));
}

function drawWeekTable() {
  const tbody = document.getElementById("weeklyRosterTableBody");
  const { weekKey, weekDates, weekRows } = getWeekContext();
  const query = (document.getElementById("rosterSearch")?.value || "").trim().toLowerCase();
  const statusFilter = document.getElementById("rosterFilterStatus")?.value || "";
  if (!weekKey) {
    setMarkupIfChanged(tbody, `<tr><td colspan='8' class='empty'>Choose a valid week start.</td></tr>`);
    return;
  }

  const rows = [];

  weekDates.forEach((dateObj, idx) => {
    const key = dateToKey(dateObj);
    const entries = weekRows
      .filter((x) => x.shiftDate === key)
      .filter((x) => !statusFilter || x.status === statusFilter)
      .filter((x) => {
        if (!query) return true;
        const hay = `${x.driverName} ${x.truckNumber} ${x.nightRun ? "night run" : ""} ${x.shiftTime} ${x.startLocation || ""} ${x.route} ${x.status} ${x.isTemplate ? "template" : ""}`.toLowerCase();
        return hay.includes(query);
      })
      .sort((a, b) => {
        const timeCompare = a.shiftTime.localeCompare(b.shiftTime);
        if (timeCompare !== 0) return timeCompare;
        return String(a.driverName || "").localeCompare(String(b.driverName || ""));
      });

    if (!entries.length) {
      rows.push(`<tr><td>${DAY_NAMES[idx]}</td><td>${key}</td><td colspan='6' class='muted'>No shifts</td></tr>`);
      return;
    }

    entries.forEach((item, rowIndex) => {
      const rowClass = [
        isAwayStatus(item.status) ? awayRowClass(item.status) : "",
        item.isTemplate ? "row-template-highlight" : ""
      ].filter(Boolean).join(" ");
      const acknowledgementBadge = item.isTemplate ? "" : renderAcknowledgementBadge(item.driverName, weekKey, true);
      const rowActions = item.isTemplate ? "<span class='muted'>Week template</span>" : renderRosterContactButtons(item);
      const adminActions = item.isTemplate
        ? "<span class='muted'>Template</span>"
        : auth.can("editRoster")
        ? `<div class='table-actions'><button data-action='edit' data-id='${item.id}'>Edit</button><button data-action='delete' data-id='${item.id}'>Delete</button></div>`
        : "<span class='muted'>View only</span>";
      rows.push(`<tr class='${rowClass}'>
        <td>${rowIndex === 0 ? DAY_NAMES[idx] : ""}</td>
        <td>${rowIndex === 0 ? key : ""}</td>
        <td>${item.driverName}</td>
        <td>${item.nightRun ? "Yes" : "-"}</td>
        <td>${displayShiftTime(item)}</td>
        <td>${displayRoute(item)}</td>
        <td>${displayRosterStatus(item.status)}</td>
        <td><div class='table-actions table-actions-stack'>${acknowledgementBadge ? `<div>${acknowledgementBadge}</div>` : ""}${rowActions}${adminActions}</div></td>
      </tr>`);
    });
  });

  setMarkupIfChanged(tbody, rows.join(""));
}

function refreshWeekViewNow() {
  void loadSharedWeekAcknowledgements(selectedWeekStartKey());
  drawStats();
  drawWeekWorkflow();
  drawDriverBoard();
  drawWeekTable();
  drawWhatsAppDispatch();
}

function refreshWeekView() {
  if (weekRenderState.queued) return;
  weekRenderState.queued = true;
  window.requestAnimationFrame(() => {
    weekRenderState.queued = false;
    refreshWeekViewNow();
  });
}

function refresh() {
  const isEditing = Boolean(document.getElementById("rosterId")?.value);
  populateRosterPickers(
    document.getElementById("driverName")?.value || "",
    document.getElementById("truckNumber")?.value || "",
    { preserveSelectedTruck: isEditing }
  );
  drawRosterDriverPoolManager();
  syncBatchControls();
  drawBoardLegend();
  drawRosterModel();
  refreshWeekViewNow();
}

function setForm(item) {
  document.getElementById("rosterId").value = item.id;
  document.getElementById("shiftDate").value = item.shiftDate;
  document.getElementById("driverName").value = item.driverName;
  document.getElementById("truckNumber").value = item.truckNumber;
  document.getElementById("rosterNightRun").checked = Boolean(item.nightRun);
  document.getElementById("shiftTime").value = item.shiftTime;
  document.getElementById("startLocation").value = item.startLocation || DEFAULT_START_LOCATION;
  document.getElementById("route").value = item.route;
  document.getElementById("rosterStatus").value = item.status;
  const leaveRange = item.status === "Leave"
    ? inferLeaveRange(item.driverName, item.shiftDate)
    : { start: item.shiftDate, end: item.shiftDate };
  document.getElementById("leaveStartDate").value = item.leaveStartDate || leaveRange.start || "";
  document.getElementById("returnDate").value = item.returnDate || leaveRange.end || "";
  populateRosterPickers(item.driverName, item.truckNumber, { preserveSelectedTruck: true });
  syncStatusDependentFields();
  resetBatchControls();
}

function materializeWeekTemplate() {
  const { weekKeys, actualWeekRows } = getWeekContext();
  const templateRows = buildWeekTemplateRows(weekKeys, actualWeekRows).map(({ isTemplate, ...row }) => ({
    ...row,
    id: uid()
  }));
  if (!templateRows.length) {
    alert("This week template is already saved.");
    return;
  }
  state.roster = [...state.roster, ...templateRows];
  state.roster = dedupeRosterRows(state.roster);
  saveData();
  refreshWeekView();
}

function applyAccess() {
  document.getElementById("currentUserChip").textContent = `User: ${auth.user.username}`;
  if (!auth.can("accessControlPanel")) document.getElementById("controlPanelLink").style.display = "none";
  if (!auth.can("viewReports")) {
    const reportsLink = document.getElementById("reportsLink");
    if (reportsLink) reportsLink.style.display = "none";
  }
  if (!auth.can("accessLogs")) document.querySelector("a[href='./log.html']").style.display = "none";
  if (!(auth.can("viewTruckIncome") || auth.can("viewSpending") || auth.can("viewPayslips") || auth.can("viewStats"))) {
    const link = document.getElementById("financeLink");
    if (link) link.style.display = "none";
  }
  if (!(auth.can("viewSpending") || auth.can("editSpending") || auth.can("accessControlPanel"))) {
    const link = document.getElementById("receiptsLink");
    if (link) link.style.display = "none";
  }

  if (!auth.can("editRoster")) {
    const form = document.getElementById("rosterForm");
    Array.from(form.elements).forEach((el) => { if (el.type !== "hidden") el.disabled = true; });
    document.getElementById("exportRoster").style.display = "none";
    const manager = document.getElementById("rosterDriverManager");
    if (manager) manager.style.display = "none";
  }
}

document.getElementById("logoutBtn").addEventListener("click", () => {
  window.OPXAuth.logout();
  window.location.href = "./login.html";
});

document.getElementById("rosterForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!auth.can("editRoster")) return;

  const statusValue = document.getElementById("rosterStatus").value;
  const leaveStartDateValue = document.getElementById("leaveStartDate").value;
  const returnDateValue = document.getElementById("returnDate").value;
  const id = document.getElementById("rosterId").value;
  const basePayload = normalizeRosterPayload({
    driverName: document.getElementById("driverName").value.trim(),
    truckNumber: document.getElementById("truckNumber").value.trim(),
    nightRun: document.getElementById("rosterNightRun").checked,
    shiftDate: statusValue === "Leave" ? leaveStartDateValue : document.getElementById("shiftDate").value,
    shiftTime: document.getElementById("shiftTime").value.trim(),
    startLocation: document.getElementById("startLocation").value.trim(),
    route: document.getElementById("route").value.trim(),
    status: statusValue,
    leaveStartDate: leaveStartDateValue,
    returnDate: returnDateValue
  });

  if (!basePayload.driverName || !basePayload.shiftDate) {
    alert("Choose a driver and date first.");
    return;
  }
  if (basePayload.status === "Leave") {
    const leaveDates = getDateRangeKeys(leaveStartDateValue, returnDateValue);
    if (!leaveStartDateValue || !returnDateValue || !leaveDates.length) {
      alert("Choose a valid leave start date and return date first.");
      return;
    }
  }
  if (!isAwayStatus(basePayload.status) && (!basePayload.truckNumber || !basePayload.shiftTime || !basePayload.startLocation || !basePayload.route)) {
    alert("Driver, truck, time, depot, and route are required for a real shift.");
    return;
  }

  const existingItem = id ? state.roster.find((row) => row.id === id) : null;
  if (id && basePayload.status !== "Leave") {
    if (basePayload.truckNumber && !isTruckAvailableForDate(basePayload.truckNumber, basePayload.shiftDate, id)) {
      alert(`Truck ${basePayload.truckNumber} is already assigned on ${basePayload.shiftDate}. Choose another truck or date.`);
      return;
    }
    const payload = { ...basePayload, id };
    const previousLeaveRange = existingItem?.status === "Leave"
      ? inferLeaveRange(existingItem.driverName, existingItem.shiftDate)
      : null;
    const previousLeaveDates = previousLeaveRange ? new Set(getDateRangeKeys(previousLeaveRange.start, previousLeaveRange.end)) : null;
    state.roster = [
      ...state.roster.filter((row) => {
        if (row.id === id) return false;
        if (!previousLeaveDates) return !(row.driverName === payload.driverName && row.shiftDate === payload.shiftDate);
        if (row.driverName === existingItem.driverName && previousLeaveDates.has(row.shiftDate)) return false;
        return !(row.driverName === payload.driverName && row.shiftDate === payload.shiftDate);
      }),
      payload
    ];
  } else if (!id) {
    const batchDates = getBatchShiftDates(basePayload.shiftDate);
    if (getBatchToggle()?.checked && !batchDates.length) {
      alert("Choose at least one weekday for the batch add, or untick Weekday Batch for a single shift.");
      return;
    }
    const targetDates = batchDates.length ? batchDates : [basePayload.shiftDate];
    const createdRows = [];
    const skippedDates = [];

    targetDates.forEach((shiftDate) => {
      if (basePayload.truckNumber && !isTruckAvailableForDate(basePayload.truckNumber, shiftDate)) {
        skippedDates.push(shiftDate);
        return;
      }
      createdRows.push({
        ...basePayload,
        id: uid(),
        shiftDate
      });
    });

    if (!createdRows.length) {
      alert(`Truck ${basePayload.truckNumber} is already assigned on the selected day(s). Choose another truck or date.`);
      return;
    }

    const targetKeys = new Set(createdRows.map((row) => `${row.driverName}__${row.shiftDate}`));
    state.roster = [
      ...state.roster.filter((row) => !targetKeys.has(`${row.driverName}__${row.shiftDate}`)),
      ...createdRows
    ];
    if (skippedDates.length) {
      alert(`Created ${createdRows.length} shift(s). Skipped these dates because truck ${basePayload.truckNumber} is already assigned: ${skippedDates.join(", ")}`);
    }
  } else {
    const previousLeaveRange = existingItem?.status === "Leave"
      ? inferLeaveRange(existingItem.driverName, existingItem.shiftDate)
      : null;
    const nextDates = getDateRangeKeys(leaveStartDateValue, returnDateValue);
    const removableDates = new Set([
      ...nextDates,
      ...((previousLeaveRange && getDateRangeKeys(previousLeaveRange.start, previousLeaveRange.end)) || [])
    ]);
    const createdRows = nextDates.map((shiftDate, index) => ({
      ...basePayload,
      id: index === 0 ? id : uid(),
      shiftDate,
      leaveStartDate: leaveStartDateValue,
      returnDate: returnDateValue
    }));
    state.roster = [
      ...state.roster.filter((row) => !(row.driverName === basePayload.driverName && removableDates.has(row.shiftDate))),
      ...createdRows
    ];
  }

  state.roster = dedupeRosterRows(state.roster);
  saveData();
  e.target.reset();
  document.getElementById("rosterId").value = "";
  resetBatchControls();
  populateRosterPickers();

  const monday = mondayOf(basePayload.shiftDate);
  if (monday) {
    document.getElementById("weekStart").value = dateToKey(monday);
  }

  refreshWeekView();
});

document.getElementById("cancelRosterEdit").addEventListener("click", () => {
  document.getElementById("rosterForm").reset();
  document.getElementById("rosterId").value = "";
  resetBatchControls();
  populateRosterPickers();
});

document.getElementById("exportRoster").addEventListener("click", () => {
  if (!auth.can("editRoster")) return;
  const csv = toCsv(state.roster);
  if (!csv) return alert("No records to export.");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "weekly_roster.csv";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("weekStart").addEventListener("change", refreshWeekView);
document.getElementById("rosterSearch").addEventListener("input", scheduleWeekSearchRefresh);
document.getElementById("rosterSearch").addEventListener("search", scheduleWeekSearchRefresh);
document.getElementById("rosterSearch").addEventListener("change", scheduleWeekSearchRefresh);
document.getElementById("rosterFilterStatus").addEventListener("change", refreshWeekView);
document.getElementById("rosterStatus").addEventListener("change", () => {
  syncStatusDependentFields();
  populateRosterPickers(
    document.getElementById("driverName").value,
    document.getElementById("truckNumber").value,
    { preferMatched: true, preserveSelectedTruck: isAwayStatus(document.getElementById("rosterStatus").value) }
  );
});
document.getElementById("driverName").addEventListener("change", () => {
  populateRosterPickers(
    document.getElementById("driverName").value,
    document.getElementById("truckNumber").value,
    { preferMatched: true }
  );
});
document.getElementById("shiftDate").addEventListener("change", () => {
  if (document.getElementById("rosterStatus").value === "Leave" && !document.getElementById("leaveStartDate").value) {
    document.getElementById("leaveStartDate").value = document.getElementById("shiftDate").value;
    document.getElementById("returnDate").value = document.getElementById("shiftDate").value;
  }
  populateRosterPickers(
    document.getElementById("driverName").value,
    document.getElementById("truckNumber").value,
    { preferMatched: true }
  );
});
document.getElementById("leaveStartDate")?.addEventListener("change", () => {
  if (!document.getElementById("returnDate").value) {
    document.getElementById("returnDate").value = document.getElementById("leaveStartDate").value;
  }
});
getBatchToggle()?.addEventListener("change", syncBatchControls);
document.getElementById("saveWeekTemplate")?.addEventListener("click", () => {
  if (!auth.can("editRoster")) return;
  materializeWeekTemplate();
});
document.getElementById("setWeekDraft")?.addEventListener("click", () => {
  if (!auth.can("editRoster")) return;
  const weekKey = selectedWeekStartKey();
  if (!weekKey) return;
  setWeekWorkflowStatus(weekKey, "draft");
  drawWeekWorkflow();
  setDispatchStatus(`Week ${weekKey} is back in draft.`);
});
document.getElementById("approveWeekPlan")?.addEventListener("click", () => {
  if (!auth.can("editRoster")) return;
  const weekKey = selectedWeekStartKey();
  if (!weekKey) return;
  setWeekWorkflowStatus(weekKey, "approved");
  drawWeekWorkflow();
  setDispatchStatus(`Week ${weekKey} approved and ready for dispatch.`);
});
document.getElementById("markWeekSent")?.addEventListener("click", () => {
  if (!auth.can("editRoster")) return;
  const weekKey = selectedWeekStartKey();
  if (!weekKey) return;
  setWeekWorkflowStatus(weekKey, "sent");
  drawWeekWorkflow();
  setDispatchStatus(`Week ${weekKey} marked sent to drivers.`);
});
document.getElementById("clearRosterFilters").addEventListener("click", () => {
  document.getElementById("rosterSearch").value = "";
  document.getElementById("rosterFilterStatus").value = "";
  const monday = mondayOf(todayKey());
  if (monday) {
    document.getElementById("weekStart").value = dateToKey(monday);
  } else {
    document.getElementById("weekStart").value = "";
  }
  refreshWeekView();
});
document.getElementById("openWhatsAppWeekDispatch")?.addEventListener("click", () => {
  const weekKey = selectedWeekStartKey();
  if (weekKey) {
    const currentStatus = getWeekWorkflow(weekKey).status;
    if (currentStatus === "draft") {
      setWeekWorkflowStatus(weekKey, "approved");
    }
  }
  drawWhatsAppDispatch();
  drawWeekWorkflow();
  document.getElementById("rosterWhatsAppDispatch")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
});
document.getElementById("copyWeekViewSummary")?.addEventListener("click", async () => {
  const summary = buildAllDriversWeekSummary();
  const message = await copyText(summary, "Full week view copied. You can paste it into WhatsApp or any message.");
  setDispatchStatus(message);
});
document.getElementById("addRosterDriverBtn")?.addEventListener("click", () => {
  if (!auth.can("editRoster")) return;
  const select = document.getElementById("rosterDriverQuickAdd");
  const name = canonicalDriverName(select?.value || "");
  if (!name) return;
  if (!addDriverToRosterPool(name)) {
    setDispatchStatus(`${name} is already in this roster.`, "warning-text");
    return;
  }
  setDispatchStatus(`${name} added to this roster.`, "success-text");
  refresh();
});
document.getElementById("resetRosterDriversBtn")?.addEventListener("click", () => {
  if (!auth.can("editRoster")) return;
  localStorage.removeItem(ROSTER_DRIVER_POOL_KEY);
  setDispatchStatus("Roster driver list reset to all active drivers.", "muted");
  refresh();
});

document.body.addEventListener("click", (e) => {
  const boardDelete = e.target.closest(".board-chip-delete[data-board-delete]");
  if (boardDelete) {
    e.stopPropagation();
    if (!auth.can("editRoster")) return;
    const id = boardDelete.dataset.boardDelete || "";
    const item = state.roster.find((row) => row.id === id);
    if (!item) return;
    if (!confirm(`Delete shift for ${item.driverName} on ${item.shiftDate}?`)) return;
    state.roster = state.roster.filter((row) => row.id !== id);
    saveData();
    refreshWeekView();
    return;
  }

  const boardChip = e.target.closest(".board-chip[data-board-id]");
  if (boardChip) {
    const boardItem = {
      id: boardChip.dataset.boardId || "",
      driverName: boardChip.dataset.boardDriver || "",
      shiftDate: boardChip.dataset.boardDate || "",
      truckNumber: boardChip.dataset.boardTruck || "",
      status: boardChip.dataset.boardStatus || "Scheduled",
      shiftTime: boardChip.dataset.boardShiftTime || "",
      startLocation: boardChip.dataset.boardStartLocation || "",
      route: boardChip.dataset.boardRoute || "",
      nightRun: boardChip.dataset.boardNightRun === "true",
      isTemplate: boardChip.dataset.template === "true"
    };

    if (boardItem.isTemplate) {
      loadTemplateIntoForm(boardItem);
    } else {
      const saved = state.roster.find((row) => row.id === boardItem.id);
      if (saved) setForm(saved);
    }
    return;
  }

  const button = e.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;
  const item = state.roster.find((r) => r.id === id);

  if (action === "email-shift" || action === "sms-shift") {
    if (!item) return;
    if (action === "email-shift") openShiftContact("email", item);
    if (action === "sms-shift") openShiftContact("sms", item);
    return;
  }

  if (action === "whatsapp-week-driver" || action === "copy-week-driver" || action === "copy-confirm-link") {
    const driverName = button.dataset.driverName || "";
    const { weekKeys, weekRows } = getWeekContext();
    const weekKey = selectedWeekStartKey();
    const message = buildWeeklyDriverMessage(driverName, weekKeys, weekRows);
    const confirmationUrl = buildRosterConfirmationUrl(driverName, weekKey);
    const contact = getDriverContactByName(driverName);
    if (action === "copy-week-driver") {
      copyText(message, `Copied ${driverName}'s week view.`).then((status) => setDispatchStatus(status));
      return;
    }
    if (action === "copy-confirm-link") {
      if (!confirmationUrl) {
        setDispatchStatus(`A confirmation link is not ready for ${driverName} yet.`, "error-text");
        return;
      }
      copyText(confirmationUrl, `Copied ${driverName}'s confirmation link.`).then((status) => setDispatchStatus(status));
      return;
    }
    if (!cleanPhone(contact.phone)) {
      setDispatchStatus(`${driverName} does not have a saved phone number on the Drivers page.`, "error-text");
      return;
    }
    ensureWeekAcknowledgementAtLeast(driverName, weekKey, "sent", "whatsapp");
    if (weekKey) {
      const workflow = getWeekWorkflow(weekKey).status;
      if (workflow === "draft" || workflow === "approved") {
        setWeekWorkflowStatus(weekKey, "sent");
      }
    }
    openWhatsAppContact(contact.phone, message, driverName);
    drawWhatsAppDispatch();
    drawWeekWorkflow();
    drawDriverBoard();
    drawWeekTable();
    setDispatchStatus(`Opened WhatsApp for ${driverName}.`);
    return;
  }

  if (action === "ack-week-driver") {
    const driverName = button.dataset.driverName || "";
    const status = button.dataset.status || "";
    const weekKey = selectedWeekStartKey();
    if (!driverName || !weekKey || !Object.prototype.hasOwnProperty.call(ACK_STATUS_META, status)) return;
    setWeekAcknowledgement(driverName, weekKey, status, { source: "crm" });
    drawWhatsAppDispatch();
    drawDriverBoard();
    drawWeekTable();
    setDispatchStatus(`${driverName} marked ${ACK_STATUS_META[status].label.toLowerCase()} for week ${weekKey}.`);
    return;
  }

  if (action === "remove-roster-driver") {
    if (!auth.can("editRoster")) return;
    const driverName = button.dataset.driverName || "";
    if (!driverName) return;
    if (!confirm(`Remove ${driverName} from this roster driver list?`)) return;
    const removeShifts = confirm(`Also delete all saved shifts for ${driverName}?`);
    const result = removeDriverFromRosterPool(driverName, { removeShifts });
    if (!result.removed) {
      if (result.reason === "last-driver") {
        alert("At least one driver must stay in the roster list.");
      }
      return;
    }
    setDispatchStatus(removeShifts ? `${driverName} removed from roster and saved shifts deleted.` : `${driverName} removed from this roster list.`, "warning-text");
    refresh();
    return;
  }

  if (!auth.can("editRoster")) return;

  if (action === "edit") {
    if (item) setForm(item);
    return;
  }

  if (action === "delete") {
    state.roster = state.roster.filter((r) => r.id !== id);
    saveData();
    refreshWeekView();
  }
});

document.body.addEventListener("dragstart", (event) => {
  const chip = event.target.closest(".board-chip[data-board-id]");
  if (!chip || chip.dataset.template === "true" || !auth.can("editRoster")) return;
  boardDragState.shiftId = chip.dataset.boardId || "";
  chip.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", boardDragState.shiftId);
});

document.body.addEventListener("dragend", (event) => {
  const chip = event.target.closest(".board-chip[data-board-id]");
  if (chip) chip.classList.remove("is-dragging");
  boardDragState.shiftId = "";
  document.querySelectorAll(".board-cell.is-drop-target").forEach((cell) => cell.classList.remove("is-drop-target"));
});

document.body.addEventListener("dragover", (event) => {
  const cell = event.target.closest(".board-cell[data-drop-date]");
  if (!cell || !boardDragState.shiftId || !auth.can("editRoster")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  cell.classList.add("is-drop-target");
});

document.body.addEventListener("dragleave", (event) => {
  const cell = event.target.closest(".board-cell[data-drop-date]");
  if (cell) cell.classList.remove("is-drop-target");
});

document.body.addEventListener("drop", (event) => {
  const cell = event.target.closest(".board-cell[data-drop-date]");
  if (!cell || !boardDragState.shiftId || !auth.can("editRoster")) return;
  event.preventDefault();
  cell.classList.remove("is-drop-target");

  const targetChip = event.target.closest(".board-chip[data-board-id]");
  const targetShiftId = targetChip && targetChip.dataset.template !== "true" ? (targetChip.dataset.boardId || "") : "";
  applyBoardMoveOrSwap(
    boardDragState.shiftId,
    {
      driverName: cell.dataset.dropDriver || "",
      shiftDate: cell.dataset.dropDate || "",
      truckNumber: cell.dataset.dropTruck || ""
    },
    targetShiftId
  );
});

applyAccess();
ensureRosterReferenceFallbacks();
purgeExcludedDriversFromDriverStore();
purgeExcludedDriversFromRoster();
ensureDriverInRosterPool("Soleh Sungkar");
const todayMonday = mondayOf(todayKey());
if (todayMonday) {
  document.getElementById("weekStart").value = dateToKey(todayMonday);
}
resetBatchControls();
syncStatusDependentFields();
refresh();
if (!restoreRosterSyncStatus()) {
  setRosterSyncStatus(useSupabase ? "Shared roster sync ready." : "Local-only mode on this device.", useSupabase ? "neutral" : "local", { persist: false });
}
void hydrateRosterReferencesFromSupabase();
void hydrateRosterFromSupabase();
if (useSupabase) {
  rosterPullIntervalId = window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (navigator.onLine === false) return;
    queueThrottledSharedRosterPull();
  }, ROSTER_PULL_INTERVAL_MS);
  initRosterRealtimeSync();
}

if (!useSupabase) {
  window.addEventListener("opx:supabase-ready", () => {
    window.location.reload();
  }, { once: true });
}

window.addEventListener("storage", (event) => {
  if (event.key === ROSTER_DRIVER_POOL_KEY) {
    refresh();
    return;
  }
  if (event.key === DRIVERS_KEY || event.key === DRIVERS_UPDATED_KEY || event.key === TRUCKS_KEY) {
    refresh();
    return;
  }
  if (event.key === ROSTER_WEEK_STATUS_KEY) {
    refreshWeekView();
    return;
  }
  if (event.key === ROSTER_ACK_KEY) {
    refreshWeekView();
    return;
  }
  if (event.key === KEY) {
    state.roster = readData();
    setRosterSyncStatus("Roster updated in another tab.", "neutral");
    refresh();
  }
});

window.addEventListener("opx:drivers-updated", () => {
  refresh();
});

if (driversChannel) {
  driversChannel.addEventListener("message", (event) => {
    if (event?.data?.type !== "drivers-updated") return;
    refresh();
  });
}

window.addEventListener("offline", updateRosterQueueBanner);

window.addEventListener("online", () => {
  if (!useSupabase) return;
  if (rosterRetryAttempt || rosterRetryTimerId) {
    clearRosterSyncRetry(false);
    setRosterSyncStatus("Back online. Retrying shared roster sync...", "syncing");
    scheduleRosterSync(0);
    return;
  }
  updateRosterQueueBanner();
});

window.addEventListener("focus", () => {
  if (useSupabase && navigator.onLine !== false) {
    queueThrottledSharedRosterPull();
  }
  void loadSharedWeekAcknowledgements(selectedWeekStartKey(), { force: true });
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if (useSupabase && navigator.onLine !== false) {
      queueThrottledSharedRosterPull();
    }
    void loadSharedWeekAcknowledgements(selectedWeekStartKey(), { force: true });
  }
});

window.addEventListener("beforeunload", stopRosterRealtimeSync, { once: true });
