const auth = window.OPXAuth?.requireAuth("./login.html");
if (!auth) throw new Error("Authentication required");

if (!auth.can("accessCRM") || !auth.can("viewDrivers")) {
  document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>You do not have permission to access the Drivers page.</p></section></main>";
  throw new Error("No drivers access");
}

const KEY = "transport_crm_drivers";
const DRIVERS_TABLE = "drivers";
const supabase = window.OPXSupabase?.client || null;
const useSupabase = Boolean(window.OPXSupabase?.isReady && supabase);
const state = { drivers: readData() };

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

function readData() {
  try {
    return ensureUuidDrivers(JSON.parse(localStorage.getItem(KEY) || "[]"));
  } catch {
    return [];
  }
}

function saveData() {
  localStorage.setItem(KEY, JSON.stringify(state.drivers));
  if (useSupabase) {
    void syncDriversToSupabase();
  }
}

function uid() {
  return newId();
}

function toDbDriver(item) {
  return {
    id: item.id,
    name: item.name || "",
    phone: item.phone || "",
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
    licenseNumber: row.license_number || "",
    licenseExpiry: row.license_expiry || "",
    hireDate: row.hire_date || "",
    status: row.status || "",
    address: row.address || "",
    emergencyContact: row.emergency_contact || ""
  };
}

async function syncDriversToSupabase() {
  if (!useSupabase) return;
  const rows = state.drivers.map(toDbDriver);
  const { error } = await supabase.from(DRIVERS_TABLE).upsert(rows, { onConflict: "id" });
  if (error) {
    console.error("Supabase sync failed for drivers:", error.message);
    return;
  }

  const ids = rows.map((r) => r.id);
  if (!ids.length) {
    const wipe = await supabase.from(DRIVERS_TABLE).delete().not("id", "is", null);
    if (wipe.error) console.error("Supabase delete sync failed for drivers:", wipe.error.message);
    return;
  }

  const inList = `(${ids.map((id) => `"${String(id).replaceAll('"', "")}"`).join(",")})`;
  const cleanup = await supabase.from(DRIVERS_TABLE).delete().not("id", "in", inList);
  if (cleanup.error) {
    console.error("Supabase cleanup failed for drivers:", cleanup.error.message);
  }
}

async function hydrateDriversFromSupabase() {
  if (!useSupabase) return;
  const { data, error } = await supabase.from(DRIVERS_TABLE).select("*");
  if (error) {
    console.error("Supabase load failed for drivers:", error.message);
    return;
  }
  if (!Array.isArray(data)) return;
  if (!data.length && state.drivers.length) {
    console.warn("Supabase drivers table is empty; keeping local data and seeding Supabase.");
    await syncDriversToSupabase();
    refresh();
    return;
  }
  state.drivers = data.map(fromDbDriver);
  localStorage.setItem(KEY, JSON.stringify(state.drivers));
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
    const hay = `${item.name} ${item.phone} ${item.licenseNumber} ${item.status} ${item.emergencyContact || ""}`.toLowerCase();
    return hay.includes(query);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan='7' class='empty'>No drivers yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => `<tr><td>${item.name}</td><td>${item.phone}</td><td>${item.licenseNumber}</td><td>${item.licenseExpiry}</td><td>${item.status}</td><td>${item.emergencyContact || "-"}</td><td>${auth.can("editDrivers") ? `<div class='table-actions'><button data-action='edit' data-id='${item.id}'>Edit</button><button data-action='delete' data-id='${item.id}'>Delete</button></div>` : "<span class='muted'>View only</span>"}</td></tr>`)
    .join("");
}

function refresh() {
  drawStats();
  drawTable();
}

function setForm(item) {
  document.getElementById("driverDetailsId").value = item.id;
  document.getElementById("driverDetailsName").value = item.name;
  document.getElementById("driverPhone").value = item.phone;
  document.getElementById("licenseNumber").value = item.licenseNumber;
  document.getElementById("licenseExpiry").value = item.licenseExpiry;
  document.getElementById("hireDate").value = item.hireDate;
  document.getElementById("driverStatus").value = item.status;
  document.getElementById("driverAddress").value = item.address || "";
  document.getElementById("emergencyContact").value = item.emergencyContact || "";
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

  if (!auth.can("editDrivers")) {
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
  if (!auth.can("editDrivers")) return;

  const id = document.getElementById("driverDetailsId").value;
  const payload = {
    id: id || uid(),
    name: document.getElementById("driverDetailsName").value.trim(),
    phone: document.getElementById("driverPhone").value.trim(),
    licenseNumber: document.getElementById("licenseNumber").value.trim(),
    licenseExpiry: document.getElementById("licenseExpiry").value,
    hireDate: document.getElementById("hireDate").value,
    status: document.getElementById("driverStatus").value,
    address: document.getElementById("driverAddress").value.trim(),
    emergencyContact: document.getElementById("emergencyContact").value.trim()
  };

  state.drivers = id ? state.drivers.map((d) => d.id === id ? payload : d) : [...state.drivers, payload];
  saveData();
  e.target.reset();
  document.getElementById("driverDetailsId").value = "";
  refresh();
});

document.getElementById("cancelDriverEdit").addEventListener("click", () => {
  document.getElementById("driversForm").reset();
  document.getElementById("driverDetailsId").value = "";
});

document.getElementById("exportDrivers").addEventListener("click", () => {
  if (!auth.can("editDrivers")) return;
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

document.getElementById("driversSearch").addEventListener("input", refresh);
document.getElementById("clearDriversFilters").addEventListener("click", () => {
  document.getElementById("driversSearch").value = "";
  refresh();
});

document.body.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button || !auth.can("editDrivers")) return;

  const { action, id } = button.dataset;
  if (action === "edit") {
    const item = state.drivers.find((d) => d.id === id);
    if (item) setForm(item);
    return;
  }

  if (action === "delete") {
    state.drivers = state.drivers.filter((d) => d.id !== id);
    saveData();
    refresh();
  }
});

applyAccessControl();
refresh();
void hydrateDriversFromSupabase();

