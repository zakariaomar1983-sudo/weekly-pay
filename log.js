const auth = window.OPXAuth?.requireAuth("./login.html");
if (!auth) {
  throw new Error("Authentication required");
}

if (!auth.can("accessLogs")) {
  document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>You do not have permission to access the Log page.</p></section></main>";
  throw new Error("No logs access");
}

const LOG_KEY = "transport_crm_logs";
const LOG_BACKUP_KEY = "transport_crm_logs_recovery_snapshots";
const LOG_TABLE = "app_logs";

const state = {
  logs: readData()
};

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}${Math.random().toString(16).slice(2, 10)}`.slice(0, 32);
}

function ensureUuidLogs(rows) {
  let changed = false;
  const normalized = rows.map((row) => {
    if (isUuid(row.id)) return row;
    changed = true;
    return { ...row, id: newId() };
  });
  if (changed) {
    localStorage.setItem(LOG_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

function readData() {
  try {
    return ensureUuidLogs(JSON.parse(localStorage.getItem(LOG_KEY) || "[]"));
  } catch {
    return [];
  }
}

function readLogSnapshots() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOG_BACKUP_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLogSnapshot(reason = "auto") {
  const rows = readData();
  if (!rows.length) return;

  const snapshots = readLogSnapshots();
  snapshots.unshift({
    reason,
    savedAt: new Date().toISOString(),
    rows
  });
  localStorage.setItem(LOG_BACKUP_KEY, JSON.stringify(snapshots.slice(0, 8)));
}

function latestSnapshotRows() {
  return readLogSnapshots()
    .flatMap((snapshot) => Array.isArray(snapshot?.rows) ? snapshot.rows : []);
}

function mergeLogRows(...groups) {
  const byId = new Map();
  groups.flat().forEach((row) => {
    if (!row || typeof row !== "object") return;
    const id = String(row.id || "").trim() || newId();
    const normalized = { ...row, id };
    const existing = byId.get(id);
    const existingTime = Date.parse(existing?.updatedAt || existing?.savedAt || existing?.logDate || "") || 0;
    const nextTime = Date.parse(normalized.updatedAt || normalized.savedAt || normalized.logDate || "") || 0;
    if (!existing || nextTime >= existingTime) byId.set(id, normalized);
  });

  return ensureUuidLogs(Array.from(byId.values()));
}

function saveData() {
  saveLogSnapshot("before-save");
  localStorage.setItem(LOG_KEY, JSON.stringify(state.logs));
  if (isSupabaseReady()) {
    void syncLogsToSupabase();
  }
}

function uid() {
  return newId();
}

function toDbLog(item) {
  return {
    id: item.id,
    log_date: item.logDate || null,
    log_type: item.logType || "Operations",
    driver: item.driver || "",
    truck_number: item.truck || "",
    reference: item.reference || "",
    status: item.status || "Open",
    description: item.description || ""
  };
}

function fromDbLog(row) {
  return {
    id: row.id,
    logDate: row.log_date || "",
    logType: row.log_type || "Operations",
    driver: row.driver || "",
    truck: row.truck_number || "",
    reference: row.reference || "",
    status: row.status || "Open",
    description: row.description || "",
    updatedAt: row.updated_at || row.created_at || ""
  };
}

function getSupabaseClient() {
  return window.OPXSupabase?.client || null;
}

function isSupabaseReady() {
  return Boolean(window.OPXSupabase?.isReady && getSupabaseClient());
}

async function syncLogsToSupabase() {
  if (!isSupabaseReady()) return;
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const rows = state.logs.map(toDbLog);
  if (!rows.length) return;
  const { error } = await supabase.from(LOG_TABLE).upsert(rows, { onConflict: "id" });
  if (error) {
    console.error("Supabase sync failed for app_logs:", error.message);
  }
}

async function hydrateLogsFromSupabase() {
  if (!isSupabaseReady()) return;
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const { data, error } = await supabase.from(LOG_TABLE).select("*");
  if (error) {
    console.error("Supabase load failed for app_logs:", error.message);
    const recoveredRows = mergeLogRows(latestSnapshotRows(), state.logs);
    if (recoveredRows.length > state.logs.length) {
      state.logs = recoveredRows;
      localStorage.setItem(LOG_KEY, JSON.stringify(state.logs));
      refresh();
    }
    return;
  }

  if (!Array.isArray(data)) return;

  const remoteLogs = data.map(fromDbLog);
  const mergedLogs = mergeLogRows(latestSnapshotRows(), state.logs, remoteLogs);
  if (!data.length && mergedLogs.length) {
    console.warn("Supabase app_logs table is empty; keeping local/recovered logs and seeding Supabase.");
  }

  if (mergedLogs.length) {
    state.logs = mergedLogs;
    localStorage.setItem(LOG_KEY, JSON.stringify(state.logs));
    await syncLogsToSupabase();
    refresh();
    return;
  }

  state.logs = [];
  localStorage.setItem(LOG_KEY, JSON.stringify(state.logs));
  refresh();
}

async function deleteLogFromSupabase(id) {
  if (!isSupabaseReady() || !id) return;
  const supabase = getSupabaseClient();
  const { error } = await supabase.from(LOG_TABLE).delete().eq("id", id);
  if (error) console.error("Supabase delete failed for app_logs:", error.message);
}

async function clearLogsFromSupabase() {
  if (!isSupabaseReady()) return;
  const supabase = getSupabaseClient();
  const { error } = await supabase.from(LOG_TABLE).delete().not("id", "is", null);
  if (error) console.error("Supabase clear failed for app_logs:", error.message);
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const body = rows.map((r) => headers.map((h) => esc(r[h])).join(",")).join("\n");
  return `${headers.join(",")}\n${body}`;
}

function downloadCsv(filename, rows) {
  if (!auth.can("editLogs")) {
    alert("You do not have permission to export logs.");
    return;
  }

  const csv = toCsv(rows);
  if (!csv) {
    alert("No log records to export.");
    return;
  }

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function drawStats() {
  const openCount = state.logs.filter((x) => x.status === "Open").length;
  const followUpCount = state.logs.filter((x) => x.status === "Follow-up").length;

  const stats = [
    { label: "Total Logs", value: String(state.logs.length) },
    { label: "Open Logs", value: String(openCount) },
    { label: "Follow-up", value: String(followUpCount) }
  ];

  const grid = document.getElementById("logStatsGrid");
  if (!auth.can("viewStats")) {
    grid.style.display = "none";
    return;
  }

  grid.style.display = "grid";
  grid.innerHTML = stats.map((s) => `<article class="stat-card"><p>${s.label}</p><h3>${s.value}</h3></article>`).join("");
}

function drawLogs() {
  const tbody = document.getElementById("logsTableBody");
  const query = (document.getElementById("logsSearch")?.value || "").trim().toLowerCase();
  const statusFilter = document.getElementById("logsFilterStatus")?.value || "";
  const fromDate = document.getElementById("logsFromDate")?.value || "";
  const toDate = document.getElementById("logsToDate")?.value || "";

  const filtered = state.logs
    .filter((item) => !statusFilter || item.status === statusFilter)
    .filter((item) => !fromDate || item.logDate >= fromDate)
    .filter((item) => !toDate || item.logDate <= toDate)
    .filter((item) => {
      if (!query) return true;
      const hay = `${item.logType} ${item.driver || ""} ${item.truck || ""} ${item.reference || ""} ${item.status} ${item.description || ""}`.toLowerCase();
      return hay.includes(query);
    });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">No logs yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .sort((a, b) => a.logDate < b.logDate ? 1 : -1)
    .map((item) => `<tr>
      <td>${item.logDate}</td>
      <td>${item.logType}</td>
      <td>${item.driver || "-"}</td>
      <td>${item.truck || "-"}</td>
      <td>${item.reference || "-"}</td>
      <td>${item.status}</td>
      <td>${item.description}</td>
      <td>${auth.can("editLogs") ? `<div class="table-actions"><button data-action="edit-log" data-id="${item.id}">Edit</button><button data-action="delete-log" data-id="${item.id}">Delete</button></div>` : "<span class='muted'>View only</span>"}</td>
    </tr>`)
    .join("");
}

function refresh() {
  drawStats();
  drawLogs();
}

function setForm(item) {
  document.getElementById("logId").value = item.id;
  document.getElementById("logDate").value = item.logDate;
  document.getElementById("logType").value = item.logType;
  document.getElementById("logDriver").value = item.driver || "";
  document.getElementById("logTruck").value = item.truck || "";
  document.getElementById("logReference").value = item.reference || "";
  document.getElementById("logStatus").value = item.status;
  document.getElementById("logDescription").value = item.description;
}

function applyAccessControl() {
  document.getElementById("currentUserChip").textContent = `User: ${auth.user.username}`;

  const controlPanelLink = document.getElementById("controlPanelLink");
  if (!auth.can("accessControlPanel")) {
    controlPanelLink.style.display = "none";
  }

  if (!(auth.can("viewTruckIncome") || auth.can("viewSpending") || auth.can("viewPayslips") || auth.can("viewStats"))) {
    const financeLink = document.getElementById("financeLink");
    if (financeLink) financeLink.style.display = "none";
  }

  if (!auth.can("viewRoster")) {
    const rosterLink = document.getElementById("rosterLink");
    if (rosterLink) rosterLink.style.display = "none";
  }

  if (!auth.can("editLogs")) {
    const form = document.getElementById("logForm");
    Array.from(form.elements).forEach((element) => {
      if (element.type !== "hidden") element.disabled = true;
    });

    document.getElementById("clearLogsBtn").style.display = "none";
    document.getElementById("exportLogs").style.display = "none";
  }
}

document.getElementById("logoutBtn").addEventListener("click", () => {
  window.OPXAuth.logout();
  window.location.href = "./login.html";
});

document.getElementById("logForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!auth.can("editLogs")) return;

  const id = document.getElementById("logId").value;
  const payload = {
    id: id || uid(),
    logDate: document.getElementById("logDate").value,
    logType: document.getElementById("logType").value,
    driver: document.getElementById("logDriver").value.trim(),
    truck: document.getElementById("logTruck").value.trim(),
    reference: document.getElementById("logReference").value.trim(),
    status: document.getElementById("logStatus").value,
    description: document.getElementById("logDescription").value.trim()
  };

  state.logs = id ? state.logs.map((item) => item.id === id ? payload : item) : [...state.logs, payload];

  saveData();
  e.target.reset();
  document.getElementById("logId").value = "";
  refresh();
});

document.getElementById("cancelLogEdit").addEventListener("click", () => {
  document.getElementById("logForm").reset();
  document.getElementById("logId").value = "";
});

document.getElementById("exportLogs").addEventListener("click", () => {
  downloadCsv("operations_log.csv", state.logs);
});

document.getElementById("logsSearch").addEventListener("input", refresh);
document.getElementById("logsFilterStatus").addEventListener("change", refresh);
document.getElementById("logsFromDate").addEventListener("change", refresh);
document.getElementById("logsToDate").addEventListener("change", refresh);
document.getElementById("clearLogsFilters").addEventListener("click", () => {
  document.getElementById("logsSearch").value = "";
  document.getElementById("logsFilterStatus").value = "";
  document.getElementById("logsFromDate").value = "";
  document.getElementById("logsToDate").value = "";
  refresh();
});

document.body.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button || !auth.can("editLogs")) return;

  const { action, id } = button.dataset;
  if (action === "edit-log") {
    const item = state.logs.find((x) => x.id === id);
    if (item) setForm(item);
    return;
  }

  if (action === "delete-log") {
    saveLogSnapshot("before-delete");
    state.logs = state.logs.filter((x) => x.id !== id);
    void deleteLogFromSupabase(id);
    saveData();
    refresh();
  }
});

document.getElementById("clearLogsBtn").addEventListener("click", () => {
  if (!auth.can("editLogs")) return;

  const ok = confirm("Delete all log records? This cannot be undone.");
  if (!ok) return;

  saveLogSnapshot("before-clear-all");
  state.logs = [];
  void clearLogsFromSupabase();
  localStorage.setItem(LOG_KEY, JSON.stringify(state.logs));
  saveData();
  document.getElementById("logForm").reset();
  document.getElementById("logId").value = "";
  refresh();
});

applyAccessControl();
refresh();

if (isSupabaseReady()) {
  void hydrateLogsFromSupabase();
}

window.addEventListener("opx:supabase-ready", () => {
  void hydrateLogsFromSupabase();
});

setTimeout(() => {
  if (isSupabaseReady()) {
    void hydrateLogsFromSupabase();
  }
}, 1500);


