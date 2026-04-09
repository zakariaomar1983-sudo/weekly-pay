const auth = window.OPXAuth?.requireAuth("./login.html");
if (!auth) throw new Error("Authentication required");

if (!auth.can("accessCRM") || !auth.can("viewTrucks")) {
  document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>You do not have permission to access the Trucks page.</p></section></main>";
  throw new Error("No trucks access");
}

const KEY = "transport_crm_trucks";
const state = { trucks: readData() };

function readData() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function saveData() {
  localStorage.setItem(KEY, JSON.stringify(state.trucks));
}

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
    const hay = `${item.truckNumber} ${item.registration} ${item.model} ${item.status} ${item.notes || ""}`.toLowerCase();
    return hay.includes(query);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan='7' class='empty'>No trucks yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .sort((a, b) => a.truckNumber.localeCompare(b.truckNumber))
    .map((item) => `<tr><td>${item.truckNumber}</td><td>${item.registration}</td><td>${item.model}</td><td>${item.capacity}</td><td>${item.serviceDueDate}</td><td>${item.status}</td><td>${auth.can("editTrucks") ? `<div class='table-actions'><button data-action='edit' data-id='${item.id}'>Edit</button><button data-action='delete' data-id='${item.id}'>Delete</button></div>` : "<span class='muted'>View only</span>"}</td></tr>`)
    .join("");
}

function refresh() {
  drawStats();
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

