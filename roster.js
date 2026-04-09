const auth = window.OPXAuth?.requireAuth("./login.html");
if (!auth) throw new Error("Authentication required");

if (!auth.can("accessCRM") || !auth.can("viewRoster")) {
  document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>You do not have permission to access the Weekly Roster page.</p></section></main>";
  throw new Error("No roster access");
}

const KEY = "transport_crm_roster";
const state = { roster: readData() };

function readData() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function saveData() {
  localStorage.setItem(KEY, JSON.stringify(state.roster));
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

function mondayOf(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + offset);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function dateToKey(d) {
  return d.toISOString().slice(0, 10);
}

function getWeekDates(startKey) {
  const start = new Date(startKey);
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const x = new Date(start);
    x.setDate(start.getDate() + i);
    days.push(x);
  }
  return days;
}

function selectedWeekStartKey() {
  const input = document.getElementById("weekStart").value;
  const monday = mondayOf(input || new Date().toISOString().slice(0, 10));
  return monday ? dateToKey(monday) : "";
}

function drawStats() {
  const panel = document.getElementById("rosterStats");
  if (!auth.can("viewStats")) {
    panel.style.display = "none";
    return;
  }

  const weekKey = selectedWeekStartKey();
  const weekSet = new Set(getWeekDates(weekKey).map(dateToKey));
  const weekRows = state.roster.filter((r) => weekSet.has(r.shiftDate));

  const stats = [
    { label: "Total Shifts", value: String(state.roster.length) },
    { label: "This Week", value: String(weekRows.length) },
    { label: "Completed", value: String(weekRows.filter((x) => x.status === "Completed").length) },
    { label: "Leave", value: String(weekRows.filter((x) => x.status === "Leave").length) }
  ];

  panel.style.display = "grid";
  panel.innerHTML = stats.map((s) => `<article class='stat-card'><p>${s.label}</p><h3>${s.value}</h3></article>`).join("");
}

function drawWeekTable() {
  const tbody = document.getElementById("weeklyRosterTableBody");
  const weekKey = selectedWeekStartKey();
  const query = (document.getElementById("rosterSearch")?.value || "").trim().toLowerCase();
  const statusFilter = document.getElementById("rosterFilterStatus")?.value || "";
  if (!weekKey) {
    tbody.innerHTML = `<tr><td colspan='8' class='empty'>Choose a valid week start.</td></tr>`;
    return;
  }

  const weekDates = getWeekDates(weekKey);
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const rows = [];

  weekDates.forEach((dateObj, idx) => {
    const key = dateToKey(dateObj);
    const entries = state.roster
      .filter((x) => x.shiftDate === key)
      .filter((x) => !statusFilter || x.status === statusFilter)
      .filter((x) => {
        if (!query) return true;
        const hay = `${x.driverName} ${x.truckNumber} ${x.shiftTime} ${x.route} ${x.status}`.toLowerCase();
        return hay.includes(query);
      })
      .sort((a, b) => a.shiftTime.localeCompare(b.shiftTime));

    if (!entries.length) {
      rows.push(`<tr><td>${dayNames[idx]}</td><td>${key}</td><td colspan='6' class='muted'>No shifts</td></tr>`);
      return;
    }

    entries.forEach((item, rowIndex) => {
      rows.push(`<tr>
        <td>${rowIndex === 0 ? dayNames[idx] : ""}</td>
        <td>${rowIndex === 0 ? key : ""}</td>
        <td>${item.driverName}</td>
        <td>${item.truckNumber}</td>
        <td>${item.shiftTime}</td>
        <td>${item.route}</td>
        <td>${item.status}</td>
        <td>${auth.can("editRoster") ? `<div class='table-actions'><button data-action='edit' data-id='${item.id}'>Edit</button><button data-action='delete' data-id='${item.id}'>Delete</button></div>` : "<span class='muted'>View only</span>"}</td>
      </tr>`);
    });
  });

  tbody.innerHTML = rows.join("");
}

function refresh() {
  drawStats();
  drawWeekTable();
}

function setForm(item) {
  document.getElementById("rosterId").value = item.id;
  document.getElementById("driverName").value = item.driverName;
  document.getElementById("truckNumber").value = item.truckNumber;
  document.getElementById("shiftDate").value = item.shiftDate;
  document.getElementById("shiftTime").value = item.shiftTime;
  document.getElementById("route").value = item.route;
  document.getElementById("rosterStatus").value = item.status;
}

function applyAccess() {
  document.getElementById("currentUserChip").textContent = `User: ${auth.user.username}`;
  if (!auth.can("accessControlPanel")) document.getElementById("controlPanelLink").style.display = "none";
  if (!auth.can("accessLogs")) document.querySelector("a[href='./log.html']").style.display = "none";
  if (!(auth.can("viewTruckIncome") || auth.can("viewSpending") || auth.can("viewPayslips") || auth.can("viewStats"))) {
    const link = document.getElementById("financeLink");
    if (link) link.style.display = "none";
  }

  if (!auth.can("editRoster")) {
    const form = document.getElementById("rosterForm");
    Array.from(form.elements).forEach((el) => { if (el.type !== "hidden") el.disabled = true; });
    document.getElementById("exportRoster").style.display = "none";
  }
}

document.getElementById("logoutBtn").addEventListener("click", () => {
  window.OPXAuth.logout();
  window.location.href = "./login.html";
});

document.getElementById("rosterForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!auth.can("editRoster")) return;

  const id = document.getElementById("rosterId").value;
  const payload = {
    id: id || uid(),
    driverName: document.getElementById("driverName").value.trim(),
    truckNumber: document.getElementById("truckNumber").value.trim(),
    shiftDate: document.getElementById("shiftDate").value,
    shiftTime: document.getElementById("shiftTime").value.trim(),
    route: document.getElementById("route").value.trim(),
    status: document.getElementById("rosterStatus").value
  };

  state.roster = id ? state.roster.map((r) => r.id === id ? payload : r) : [...state.roster, payload];
  saveData();
  e.target.reset();
  document.getElementById("rosterId").value = "";

  const monday = mondayOf(payload.shiftDate);
  if (monday) {
    document.getElementById("weekStart").value = dateToKey(monday);
  }

  refresh();
});

document.getElementById("cancelRosterEdit").addEventListener("click", () => {
  document.getElementById("rosterForm").reset();
  document.getElementById("rosterId").value = "";
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

document.getElementById("weekStart").addEventListener("change", refresh);
document.getElementById("rosterSearch").addEventListener("input", refresh);
document.getElementById("rosterFilterStatus").addEventListener("change", refresh);
document.getElementById("clearRosterFilters").addEventListener("click", () => {
  document.getElementById("rosterSearch").value = "";
  document.getElementById("rosterFilterStatus").value = "";
  const monday = mondayOf(new Date().toISOString().slice(0, 10));
  if (monday) {
    document.getElementById("weekStart").value = dateToKey(monday);
  } else {
    document.getElementById("weekStart").value = "";
  }
  refresh();
});

document.body.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button || !auth.can("editRoster")) return;

  const { action, id } = button.dataset;
  if (action === "edit") {
    const item = state.roster.find((r) => r.id === id);
    if (item) setForm(item);
    return;
  }

  if (action === "delete") {
    state.roster = state.roster.filter((r) => r.id !== id);
    saveData();
    refresh();
  }
});

applyAccess();
const todayMonday = mondayOf(new Date().toISOString().slice(0, 10));
if (todayMonday) {
  document.getElementById("weekStart").value = dateToKey(todayMonday);
}
refresh();
