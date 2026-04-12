const auth = window.OPXAuth?.requireAuth("./login.html");
if (!auth) throw new Error("Authentication required");

if (!auth.can("accessCRM") || !auth.can("viewTrucks")) {
  document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>You do not have permission to access the Trucks page.</p></section></main>";
  throw new Error("No trucks access");
}

const KEY = "transport_crm_trucks";
const TRUCKS_TABLE = "trucks";
const supabase = window.OPXSupabase?.client || null;
const useSupabase = Boolean(window.OPXSupabase?.isReady && supabase);
const REGO_NOTIFY_KEY = "transport_crm_rego_notify_state";
const REGO_ALERT_WINDOW_DAYS = 30;
const state = { trucks: readData() };

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
    if (isUuid(row.id)) return row;
    changed = true;
    return { ...row, id: newId() };
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

function saveData() {
  localStorage.setItem(KEY, JSON.stringify(state.trucks));
  if (useSupabase) {
    void syncTrucksToSupabase();
  }
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

async function syncTrucksToSupabase() {
  if (!useSupabase) return;
  const rows = state.trucks.map(toDbTruck);
  const { error } = await supabase.from(TRUCKS_TABLE).upsert(rows, { onConflict: "id" });
  if (error) {
    console.error("Supabase sync failed for trucks:", error.message);
    return;
  }

  const ids = rows.map((r) => r.id);
  if (!ids.length) {
    const wipe = await supabase.from(TRUCKS_TABLE).delete().not("id", "is", null);
    if (wipe.error) console.error("Supabase delete sync failed for trucks:", wipe.error.message);
    return;
  }

  const inList = `(${ids.map((id) => `"${String(id).replaceAll('"', "")}"`).join(",")})`;
  const cleanup = await supabase.from(TRUCKS_TABLE).delete().not("id", "in", inList);
  if (cleanup.error) {
    console.error("Supabase cleanup failed for trucks:", cleanup.error.message);
  }
}

async function hydrateTrucksFromSupabase() {
  if (!useSupabase) return;
  const { data, error } = await supabase.from(TRUCKS_TABLE).select("*");
  if (error) {
    console.error("Supabase load failed for trucks:", error.message);
    return;
  }
  if (!Array.isArray(data)) return;
  if (!data.length && state.trucks.length) {
    console.warn("Supabase trucks table is empty; keeping local data and seeding Supabase.");
    await syncTrucksToSupabase();
    refresh();
    return;
  }
  state.trucks = data.map(fromDbTruck);
  localStorage.setItem(KEY, JSON.stringify(state.trucks));
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
    list.innerHTML = "";
  } else {
    meta.textContent = `Rego alerts: ${alerts.overdue.length} overdue, ${alerts.dueSoon.length} due within ${REGO_ALERT_WINDOW_DAYS} days.`;
    const rows = [];

    alerts.overdue.forEach((entry) => {
      rows.push(`<p class="error-text">Overdue: Truck ${entry.truck.truckNumber} (${entry.truck.registration}) expired ${Math.abs(entry.days)} day(s) ago on ${entry.truck.regoExpiryDate}.</p>`);
    });

    alerts.dueSoon.forEach((entry) => {
      rows.push(`<p class="muted">Due soon: Truck ${entry.truck.truckNumber} (${entry.truck.registration}) expires in ${entry.days} day(s) on ${entry.truck.regoExpiryDate}.</p>`);
    });

    list.innerHTML = rows.join("");
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
  const query = (document.getElementById("trucksSearch")?.value || "").trim().toLowerCase();
  const filtered = state.trucks.filter((item) => {
    if (!query) return true;
    const hay = `${item.truckNumber} ${item.registration} ${item.model} ${item.status} ${item.regoExpiryDate || ""} ${item.notes || ""}`.toLowerCase();
    return hay.includes(query);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan='8' class='empty'>No trucks yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .sort((a, b) => a.truckNumber.localeCompare(b.truckNumber))
    .map((item) => {
      const regoDays = daysUntil(item.regoExpiryDate);
      const rowClass = regoDays == null ? "" : regoDays < 0 ? "row-rego-overdue" : regoDays <= REGO_ALERT_WINDOW_DAYS ? "row-rego-soon" : "";
      return `<tr class='${rowClass}'><td>${item.truckNumber}</td><td>${item.registration}</td><td>${item.model}</td><td>${item.capacity}</td><td>${item.serviceDueDate}</td><td>${item.regoExpiryDate || ""}</td><td>${item.status}</td><td>${auth.can("editTrucks") ? `<div class='table-actions'><button data-action='edit' data-id='${item.id}'>Edit</button><button data-action='delete' data-id='${item.id}'>Delete</button></div>` : "<span class='muted'>View only</span>"}</td></tr>`;
    })
    .join("");
}

function refresh() {
  drawStats();
  drawRegoAlerts();
  drawTable();
  updateInfoBar();
}

function updateInfoBar(message = "") {
  const info = document.getElementById("trucksInfo");
  const exportBtn = document.getElementById("exportTrucks");

  if (message) {
    info.textContent = message;
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
}

function applyAccessControl() {
  document.getElementById("currentUserChip").textContent = `User: ${auth.user.username}`;
  if (!auth.can("accessControlPanel")) document.getElementById("controlPanelLink").style.display = "none";

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
  document.getElementById("trucksForm").reset();
  document.getElementById("truckDetailsId").value = "";
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

document.getElementById("trucksSearch").addEventListener("input", refresh);
document.getElementById("clearTrucksFilters").addEventListener("click", () => {
  document.getElementById("trucksSearch").value = "";
  refresh();
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
  if (!button || !auth.can("editTrucks")) return;

  const { action, id } = button.dataset;
  if (action === "edit") {
    const item = state.trucks.find((t) => t.id === id);
    if (item) setForm(item);
    return;
  }

  if (action === "delete") {
    state.trucks = state.trucks.filter((t) => t.id !== id);
    saveData();
    refresh();
  }
});

applyAccessControl();
refresh();
void hydrateTrucksFromSupabase();

