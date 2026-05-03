const auth = window.OPXAuth?.requireAuth("./login.html");
if (!auth) throw new Error("Authentication required");

if (!auth.can("accessCRM") || !auth.can("viewStats")) {
  document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>You do not have permission to access the Reports page.</p></section></main>";
  throw new Error("No report access");
}

const KEYS = {
  drivers: "transport_crm_drivers",
  trucks: "transport_crm_trucks",
  roster: "transport_crm_roster",
  income: "transport_crm_truck_income",
  expense: "transport_crm_spending",
  pay: "transport_crm_payslips",
  logs: "transport_crm_logs"
};

const state = readAll();

function readArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readAll() {
  return {
    drivers: readArray(KEYS.drivers),
    trucks: readArray(KEYS.trucks),
    roster: readArray(KEYS.roster),
    income: readArray(KEYS.income),
    expense: readArray(KEYS.expense),
    pay: readArray(KEYS.pay),
    logs: readArray(KEYS.logs)
  };
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function parseDateOnly(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  const key = isoMatch?.[1] || text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function weekStartKey(dateValue) {
  const date = parseDateOnly(dateValue);
  if (!date) return "";
  const day = date.getDay();
  const shift = day === 0 ? -6 : 1 - day;
  const start = new Date(date);
  start.setDate(date.getDate() + shift);
  return dateKey(start);
}

function monthKey(dateValue) {
  const date = parseDateOnly(dateValue);
  if (!date) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function netPay(item) {
  const daysWorked = Number(item.daysWorked ?? item.hoursWorked ?? 0);
  const dailyRate = Number(item.dailyRate ?? item.hourlyRate ?? 0);
  const nightRunDrops = Number(item.nightRunDrops ?? 0);
  const dropRate = Number(item.dropRate ?? 90);
  const nightRunPay = Number(item.nightRunPay ?? (nightRunDrops * dropRate));
  const bonus = Number(item.driverBonus ?? 0);
  const deductions = Number(item.deductions ?? 0);
  return daysWorked * dailyRate + nightRunPay + bonus - deductions;
}

function drawStats() {
  const incomeTotal = state.income.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const expenseTotal = state.expense.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const payTotal = state.pay.reduce((sum, row) => sum + netPay(row), 0);
  const profitTotal = incomeTotal - expenseTotal - payTotal;

  const cards = [
    { label: "Drivers", value: String(state.drivers.length) },
    { label: "Trucks", value: String(state.trucks.length) },
    { label: "Roster Shifts", value: String(state.roster.length) },
    { label: "Income Total", value: money(incomeTotal) },
    { label: "Truck Expense Total", value: money(expenseTotal) },
    { label: "Driver Pay Total", value: money(payTotal) },
    { label: "Net Profit", value: money(profitTotal) },
    { label: "Log Records", value: String(state.logs.length) }
  ];

  document.getElementById("reportStats").innerHTML = cards
    .map((item) => `<article class='stat-card'><p>${item.label}</p><h3>${item.value}</h3></article>`)
    .join("");
}

function buildWeeklyMap() {
  const map = new Map();
  const ensure = (key) => {
    if (!key) return null;
    if (!map.has(key)) {
      map.set(key, { income: 0, expense: 0, pay: 0 });
    }
    return map.get(key);
  };

  state.income.forEach((row) => {
    const key = weekStartKey(row.incomeDate);
    const bucket = ensure(key);
    if (bucket) bucket.income += Number(row.amount || 0);
  });

  state.expense.forEach((row) => {
    const key = weekStartKey(row.date);
    const bucket = ensure(key);
    if (bucket) bucket.expense += Number(row.amount || 0);
  });

  state.pay.forEach((row) => {
    const key = weekStartKey(row.paymentDate);
    const bucket = ensure(key);
    if (bucket) bucket.pay += netPay(row);
  });

  return map;
}

function buildMonthlyMap() {
  const map = new Map();
  const ensure = (key) => {
    if (!key) return null;
    if (!map.has(key)) {
      map.set(key, { income: 0, expense: 0, pay: 0 });
    }
    return map.get(key);
  };

  state.income.forEach((row) => {
    const key = monthKey(row.incomeDate);
    const bucket = ensure(key);
    if (bucket) bucket.income += Number(row.amount || 0);
  });

  state.expense.forEach((row) => {
    const key = monthKey(row.date);
    const bucket = ensure(key);
    if (bucket) bucket.expense += Number(row.amount || 0);
  });

  state.pay.forEach((row) => {
    const key = monthKey(row.paymentDate);
    const bucket = ensure(key);
    if (bucket) bucket.pay += netPay(row);
  });

  return map;
}

function weekLabel(weekKeyValue) {
  const start = parseDateOnly(weekKeyValue);
  if (!start) return weekKeyValue;
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = { day: "2-digit", month: "short", year: "numeric" };
  return `${start.toLocaleDateString("en-AU", fmt)} - ${end.toLocaleDateString("en-AU", fmt)}`;
}

function drawWeeklyTable() {
  const body = document.getElementById("reportWeeklyBody");
  const weekly = [...buildWeeklyMap().entries()].sort((a, b) => a[0] < b[0] ? 1 : -1).slice(0, 12);
  document.getElementById("reportWeeklyMeta").textContent = weekly.length
    ? `Showing latest ${weekly.length} week(s).`
    : "No weekly records available yet.";

  if (!weekly.length) {
    body.innerHTML = "<tr><td colspan='5' class='empty'>No weekly financial records yet.</td></tr>";
    return;
  }

  body.innerHTML = weekly.map(([key, value]) => {
    const profit = value.income - value.expense - value.pay;
    return `<tr><td>${weekLabel(key)}</td><td>${money(value.income)}</td><td>${money(value.expense)}</td><td>${money(value.pay)}</td><td>${money(profit)}</td></tr>`;
  }).join("");
}

function drawMonthlyTable() {
  const body = document.getElementById("reportMonthlyBody");
  const monthly = [...buildMonthlyMap().entries()].sort((a, b) => a[0] < b[0] ? 1 : -1).slice(0, 12);
  document.getElementById("reportMonthlyMeta").textContent = monthly.length
    ? `Showing latest ${monthly.length} month(s).`
    : "No monthly records available yet.";

  if (!monthly.length) {
    body.innerHTML = "<tr><td colspan='5' class='empty'>No monthly financial records yet.</td></tr>";
    return;
  }

  body.innerHTML = monthly.map(([key, value]) => {
    const profit = value.income - value.expense - value.pay;
    return `<tr><td>${key}</td><td>${money(value.income)}</td><td>${money(value.expense)}</td><td>${money(value.pay)}</td><td>${money(profit)}</td></tr>`;
  }).join("");
}

function refresh() {
  const next = readAll();
  state.drivers = next.drivers;
  state.trucks = next.trucks;
  state.roster = next.roster;
  state.income = next.income;
  state.expense = next.expense;
  state.pay = next.pay;
  state.logs = next.logs;
  drawStats();
  drawWeeklyTable();
  drawMonthlyTable();
}

document.getElementById("currentUserChip").textContent = `User: ${auth.user.username}`;
if (!auth.can("accessControlPanel")) {
  document.getElementById("controlPanelLink").style.display = "none";
}

document.getElementById("logoutBtn").addEventListener("click", () => {
  window.OPXAuth.logout();
  window.location.href = "./login.html";
});

refresh();
window.addEventListener("opx:data-synced", refresh);
