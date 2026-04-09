const auth = window.OPXAuth?.requireAuth("./login.html");
if (!auth) throw new Error("Authentication required");

const canAccessFinance = auth.can("accessCRM") && (auth.can("viewTruckIncome") || auth.can("viewSpending") || auth.can("viewPayslips") || auth.can("viewStats"));
if (!canAccessFinance) {
  document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>You do not have permission to access the Finance page.</p></section></main>";
  throw new Error("No finance access");
}

const KEYS = {
  income: "transport_crm_truck_income",
  expense: "transport_crm_spending",
  pay: "transport_crm_payslips"
};

const state = {
  income: readData(KEYS.income),
  expense: readData(KEYS.expense),
  pay: readData(KEYS.pay)
};

const money = (value) => `$${Number(value || 0).toFixed(2)}`;
const NIGHT_DROP_DEFAULT_RATE = 90;
const DAILY_RATE_BY_TRUCK_NUMBER = {
  "881": 330,
  "853": 330,
  "855": 330,
  "840": 325,
  "841": 325,
  "672": 320,
  "620": 320
};

function readData(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}

function saveData(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
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

function downloadCsv(filename, rows) {
  const csv = toCsv(rows);
  if (!csv) {
    alert("No records to export.");
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

function netPay(item) {
  const daysWorked = Number(item.daysWorked ?? item.hoursWorked ?? 0);
  const dailyRate = Number(item.dailyRate ?? item.hourlyRate ?? 0);
  const nightRunDrops = Number(item.nightRunDrops ?? 0);
  const dropRate = NIGHT_DROP_DEFAULT_RATE;
  const nightRunPay = nightRunDrops * dropRate;
  const driverBonus = Number(item.driverBonus ?? 0);
  return daysWorked * dailyRate + nightRunPay + driverBonus - Number(item.deductions || 0);
}

function normalizeCode(value) {
  return String(value || "").trim();
}

function updateNightRunPayPreview() {
  const drops = Number(document.getElementById("nightRunDrops")?.value || 0);
  const preview = drops * NIGHT_DROP_DEFAULT_RATE;
  const nightRunPayInput = document.getElementById("nightRunPay");
  if (nightRunPayInput) {
    nightRunPayInput.value = preview.toFixed(2);
  }
}

function applyConfiguredRatesIfMatch() {
  const truckInput = document.getElementById("payTruckNumber");
  const dailyRateInput = document.getElementById("dailyRate");
  const truckNumber = normalizeCode(truckInput?.value);

  if (Object.prototype.hasOwnProperty.call(DAILY_RATE_BY_TRUCK_NUMBER, truckNumber)) {
    dailyRateInput.value = DAILY_RATE_BY_TRUCK_NUMBER[truckNumber];
  }
}

function weekStartFromDate(dateString) {
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return null;

  const day = d.getDay();
  const shift = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + shift);
  start.setHours(0, 0, 0, 0);
  return start;
}

function weekKey(dateString) {
  const start = weekStartFromDate(dateString);
  if (!start) return "";
  return start.toISOString().slice(0, 10);
}

function weekLabel(key) {
  const start = new Date(key);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = { day: "2-digit", month: "short", year: "numeric" };
  return `${start.toLocaleDateString("en-AU", fmt)} - ${end.toLocaleDateString("en-AU", fmt)}`;
}

function buildWeeklySummary() {
  const summaryMap = new Map();

  function ensure(week) {
    if (!summaryMap.has(week)) {
      summaryMap.set(week, { week, income: 0, expense: 0, driverPay: 0 });
    }
    return summaryMap.get(week);
  }

  state.income.forEach((item) => {
    const wk = weekKey(item.incomeDate);
    if (!wk) return;
    ensure(wk).income += Number(item.amount || 0);
  });

  state.expense.forEach((item) => {
    const wk = weekKey(item.date);
    if (!wk) return;
    ensure(wk).expense += Number(item.amount || 0);
  });

  state.pay.forEach((item) => {
    const wk = weekKey(item.paymentDate);
    if (!wk) return;
    ensure(wk).driverPay += netPay(item);
  });

  return Array.from(summaryMap.values())
    .map((row) => ({ ...row, profit: row.income - row.expense - row.driverPay }))
    .sort((a, b) => a.week < b.week ? 1 : -1);
}

function drawStats() {
  const stats = document.getElementById("financeStats");
  if (!auth.can("viewStats")) {
    stats.style.display = "none";
    return;
  }

  const incomeTotal = state.income.reduce((sum, x) => sum + Number(x.amount || 0), 0);
  const expenseTotal = state.expense.reduce((sum, x) => sum + Number(x.amount || 0), 0);
  const driverPayTotal = state.pay.reduce((sum, x) => sum + netPay(x), 0);
  const profit = incomeTotal - expenseTotal - driverPayTotal;

  stats.style.display = "grid";
  stats.innerHTML = [
    { label: "Truck Income", value: money(incomeTotal) },
    { label: "Truck Expense", value: money(expenseTotal) },
    { label: "Driver Pay", value: money(driverPayTotal) },
    { label: "Profit", value: money(profit) }
  ].map((s) => `<article class='stat-card'><p>${s.label}</p><h3>${s.value}</h3></article>`).join("");
}

function drawWeeklySummary() {
  const panel = document.getElementById("weeklyProfitPanel");
  if (!auth.can("viewStats")) {
    panel.style.display = "none";
    return;
  }

  panel.style.display = "block";
  const tbody = document.getElementById("weeklySummaryTableBody");
  const rows = buildWeeklySummary();

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan='5' class='empty'>No weekly data yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((row) => `<tr><td>${weekLabel(row.week)}</td><td>${money(row.income)}</td><td>${money(row.expense)}</td><td>${money(row.driverPay)}</td><td>${money(row.profit)}</td></tr>`)
    .join("");
}

function drawIncome() {
  const panel = document.getElementById("incomePanel");
  if (!auth.can("viewTruckIncome")) {
    panel.style.display = "none";
    return;
  }

  panel.style.display = "block";
  const tbody = document.getElementById("incomeTableBody");
  const query = (document.getElementById("incomeSearch")?.value || "").trim().toLowerCase();
  const filtered = state.income.filter((item) => {
    if (!query) return true;
    const hay = `${item.incomeDate} ${item.truckNumber} ${item.jobRef} ${item.client} ${item.status} ${item.notes || ""}`.toLowerCase();
    return hay.includes(query);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan='7' class='empty'>No income records yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .sort((a, b) => a.incomeDate < b.incomeDate ? 1 : -1)
    .map((item) => `<tr><td>${item.incomeDate}</td><td>${item.truckNumber}</td><td>${item.jobRef}</td><td>${item.client}</td><td>${money(item.amount)}</td><td>${item.status}</td><td>${auth.can("editTruckIncome") ? `<div class='table-actions'><button data-action='edit-income' data-id='${item.id}'>Edit</button><button data-action='delete-income' data-id='${item.id}'>Delete</button></div>` : "<span class='muted'>View only</span>"}</td></tr>`)
    .join("");
}

function drawExpense() {
  const panel = document.getElementById("expensePanel");
  if (!auth.can("viewSpending")) {
    panel.style.display = "none";
    return;
  }

  panel.style.display = "block";
  const tbody = document.getElementById("expenseTableBody");
  const query = (document.getElementById("expenseSearch")?.value || "").trim().toLowerCase();
  const filtered = state.expense.filter((item) => {
    if (!query) return true;
    const hay = `${item.date} ${item.truckNumber || ""} ${item.category} ${item.vendor} ${item.notes || ""}`.toLowerCase();
    return hay.includes(query);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan='7' class='empty'>No expense records yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .sort((a, b) => a.date < b.date ? 1 : -1)
    .map((item) => `<tr><td>${item.date}</td><td>${item.truckNumber || "-"}</td><td>${item.category}</td><td>${money(item.amount)}</td><td>${item.vendor}</td><td>${item.notes || "-"}</td><td>${auth.can("editSpending") ? `<div class='table-actions'><button data-action='edit-expense' data-id='${item.id}'>Edit</button><button data-action='delete-expense' data-id='${item.id}'>Delete</button></div>` : "<span class='muted'>View only</span>"}</td></tr>`)
    .join("");
}

function drawPay() {
  const panel = document.getElementById("payPanel");
  if (!auth.can("viewPayslips")) {
    panel.style.display = "none";
    return;
  }

  panel.style.display = "block";
  const tbody = document.getElementById("payTableBody");
  const query = (document.getElementById("paySearch")?.value || "").trim().toLowerCase();
  const filtered = state.pay.filter((item) => {
    if (!query) return true;
    const hay = `${item.driver} ${item.truckNumber || ""} ${item.payPeriod} ${item.paymentDate} ${item.autoPay || ""} ${item.autoPayRef || ""}`.toLowerCase();
    return hay.includes(query);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan='15' class='empty'>No driver pay records yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .sort((a, b) => a.paymentDate < b.paymentDate ? 1 : -1)
    .map((item) => `<tr><td>${item.driver}</td><td>${item.truckNumber || "-"}</td><td>${item.payPeriod}</td><td>${item.daysWorked ?? item.hoursWorked ?? 0}</td><td>${money(item.dailyRate ?? item.hourlyRate ?? 0)}</td><td>${item.nightRunDrops ?? 0}</td><td>${money(item.dropRate ?? NIGHT_DROP_DEFAULT_RATE)}</td><td>${money((Number(item.nightRunDrops ?? 0) * NIGHT_DROP_DEFAULT_RATE))}</td><td>${money(item.driverBonus ?? 0)}</td><td>${money(item.deductions)}</td><td>${money(netPay(item))}</td><td>${item.paymentDate}</td><td>${item.autoPay ?? "No"}</td><td>${item.autoPayRef || "-"}</td><td>${auth.can("editPayslips") ? `<div class='table-actions'><button data-action='edit-pay' data-id='${item.id}'>Edit</button><button data-action='delete-pay' data-id='${item.id}'>Delete</button></div>` : "<span class='muted'>View only</span>"}</td></tr>`)
    .join("");
}

function refresh() {
  drawStats();
  drawWeeklySummary();
  drawIncome();
  drawExpense();
  drawPay();
}

function applyAccess() {
  document.getElementById("currentUserChip").textContent = `User: ${auth.user.username}`;
  if (!auth.can("accessControlPanel")) document.getElementById("controlPanelLink").style.display = "none";
  if (!auth.can("accessLogs")) document.querySelector("a[href='./log.html']").style.display = "none";
  if (!auth.can("viewRoster")) {
    const rosterLink = document.getElementById("rosterLink");
    if (rosterLink) rosterLink.style.display = "none";
  }

  if (!auth.can("editTruckIncome")) {
    const form = document.getElementById("incomeForm");
    Array.from(form.elements).forEach((el) => { if (el.type !== "hidden") el.disabled = true; });
    document.getElementById("exportIncome").style.display = "none";
  }

  if (!auth.can("editSpending")) {
    const form = document.getElementById("expenseForm");
    Array.from(form.elements).forEach((el) => { if (el.type !== "hidden") el.disabled = true; });
    document.getElementById("exportExpense").style.display = "none";
  }

  if (!auth.can("editPayslips")) {
    const form = document.getElementById("payForm");
    Array.from(form.elements).forEach((el) => { if (el.type !== "hidden") el.disabled = true; });
    document.getElementById("exportPay").style.display = "none";
  }
}

document.getElementById("logoutBtn").addEventListener("click", () => {
  window.OPXAuth.logout();
  window.location.href = "./login.html";
});

document.getElementById("incomeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!auth.can("editTruckIncome")) return;

  const id = document.getElementById("incomeId").value;
  const payload = {
    id: id || uid(),
    incomeDate: document.getElementById("incomeDate").value,
    truckNumber: document.getElementById("incomeTruckNumber").value.trim(),
    jobRef: document.getElementById("incomeJobRef").value.trim(),
    client: document.getElementById("incomeClient").value.trim(),
    amount: Number(document.getElementById("incomeAmount").value),
    status: document.getElementById("incomeStatus").value,
    notes: document.getElementById("incomeNotes").value.trim()
  };

  state.income = id ? state.income.map((x) => x.id === id ? payload : x) : [...state.income, payload];
  saveData(KEYS.income, state.income);
  e.target.reset();
  document.getElementById("incomeId").value = "";
  refresh();
});

document.getElementById("expenseForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!auth.can("editSpending")) return;

  const id = document.getElementById("expenseId").value;
  const payload = {
    id: id || uid(),
    date: document.getElementById("expenseDate").value,
    truckNumber: document.getElementById("expenseTruckNumber").value.trim(),
    category: document.getElementById("expenseCategory").value.trim(),
    amount: Number(document.getElementById("expenseAmount").value),
    vendor: document.getElementById("expenseVendor").value.trim(),
    notes: document.getElementById("expenseNotes").value.trim()
  };

  state.expense = id ? state.expense.map((x) => x.id === id ? payload : x) : [...state.expense, payload];
  saveData(KEYS.expense, state.expense);
  e.target.reset();
  document.getElementById("expenseId").value = "";
  refresh();
});

document.getElementById("payForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!auth.can("editPayslips")) return;

  const id = document.getElementById("payId").value;
  const payload = {
    id: id || uid(),
    driver: document.getElementById("payDriver").value.trim(),
    truckNumber: document.getElementById("payTruckNumber").value.trim(),
    payPeriod: document.getElementById("payPeriod").value.trim(),
    daysWorked: Number(document.getElementById("daysWorked").value),
    dailyRate: Number(document.getElementById("dailyRate").value),
    nightRunDrops: Number(document.getElementById("nightRunDrops").value),
    dropRate: NIGHT_DROP_DEFAULT_RATE,
    nightRunPay: Number(document.getElementById("nightRunPay").value || 0),
    driverBonus: Number(document.getElementById("driverBonus").value),
    deductions: Number(document.getElementById("deductions").value),
    paymentDate: document.getElementById("paymentDate").value,
    autoPay: document.getElementById("autoPay").value,
    autoPayRef: document.getElementById("autoPayRef").value.trim()
  };

  state.pay = id ? state.pay.map((x) => x.id === id ? payload : x) : [...state.pay, payload];
  saveData(KEYS.pay, state.pay);
  e.target.reset();
  document.getElementById("payId").value = "";
  document.getElementById("nightRunPay").value = "0.00";
  refresh();
});

document.getElementById("cancelIncomeEdit").addEventListener("click", () => {
  document.getElementById("incomeForm").reset();
  document.getElementById("incomeId").value = "";
});

document.getElementById("cancelExpenseEdit").addEventListener("click", () => {
  document.getElementById("expenseForm").reset();
  document.getElementById("expenseId").value = "";
});

document.getElementById("cancelPayEdit").addEventListener("click", () => {
  document.getElementById("payForm").reset();
  document.getElementById("payId").value = "";
  document.getElementById("nightRunPay").value = "0.00";
});

document.getElementById("exportIncome").addEventListener("click", () => {
  if (!auth.can("editTruckIncome")) return;
  downloadCsv("truck_income.csv", state.income);
});

document.getElementById("exportExpense").addEventListener("click", () => {
  if (!auth.can("editSpending")) return;
  downloadCsv("truck_expense.csv", state.expense);
});

document.getElementById("exportPay").addEventListener("click", () => {
  if (!auth.can("editPayslips")) return;
  const rows = state.pay.map((item) => ({ ...item, netPay: netPay(item).toFixed(2) }));
  downloadCsv("driver_pay.csv", rows);
});

document.getElementById("incomeSearch").addEventListener("input", refresh);
document.getElementById("expenseSearch").addEventListener("input", refresh);
document.getElementById("paySearch").addEventListener("input", refresh);
document.getElementById("clearIncomeFilters").addEventListener("click", () => {
  document.getElementById("incomeSearch").value = "";
  refresh();
});
document.getElementById("clearExpenseFilters").addEventListener("click", () => {
  document.getElementById("expenseSearch").value = "";
  refresh();
});
document.getElementById("clearPayFilters").addEventListener("click", () => {
  document.getElementById("paySearch").value = "";
  refresh();
});

document.body.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;

  if (action === "edit-income" && auth.can("editTruckIncome")) {
    const item = state.income.find((x) => x.id === id);
    if (!item) return;
    document.getElementById("incomeId").value = item.id;
    document.getElementById("incomeDate").value = item.incomeDate;
    document.getElementById("incomeTruckNumber").value = item.truckNumber;
    document.getElementById("incomeJobRef").value = item.jobRef;
    document.getElementById("incomeClient").value = item.client;
    document.getElementById("incomeAmount").value = item.amount;
    document.getElementById("incomeStatus").value = item.status;
    document.getElementById("incomeNotes").value = item.notes || "";
    return;
  }

  if (action === "delete-income" && auth.can("editTruckIncome")) {
    state.income = state.income.filter((x) => x.id !== id);
    saveData(KEYS.income, state.income);
    refresh();
    return;
  }

  if (action === "edit-expense" && auth.can("editSpending")) {
    const item = state.expense.find((x) => x.id === id);
    if (!item) return;
    document.getElementById("expenseId").value = item.id;
    document.getElementById("expenseDate").value = item.date;
    document.getElementById("expenseTruckNumber").value = item.truckNumber || "";
    document.getElementById("expenseCategory").value = item.category;
    document.getElementById("expenseAmount").value = item.amount;
    document.getElementById("expenseVendor").value = item.vendor;
    document.getElementById("expenseNotes").value = item.notes || "";
    return;
  }

  if (action === "delete-expense" && auth.can("editSpending")) {
    state.expense = state.expense.filter((x) => x.id !== id);
    saveData(KEYS.expense, state.expense);
    refresh();
    return;
  }

  if (action === "edit-pay" && auth.can("editPayslips")) {
    const item = state.pay.find((x) => x.id === id);
    if (!item) return;
    document.getElementById("payId").value = item.id;
    document.getElementById("payDriver").value = item.driver;
    document.getElementById("payTruckNumber").value = item.truckNumber || "";
    document.getElementById("payPeriod").value = item.payPeriod;
    document.getElementById("daysWorked").value = item.daysWorked ?? item.hoursWorked ?? 0;
    document.getElementById("dailyRate").value = item.dailyRate ?? item.hourlyRate ?? 0;
    document.getElementById("nightRunDrops").value = item.nightRunDrops ?? 0;
    document.getElementById("nightRunPay").value = ((Number(item.nightRunDrops ?? 0)) * NIGHT_DROP_DEFAULT_RATE).toFixed(2);
    document.getElementById("driverBonus").value = item.driverBonus ?? 0;
    document.getElementById("deductions").value = item.deductions;
    document.getElementById("paymentDate").value = item.paymentDate;
    document.getElementById("autoPay").value = item.autoPay ?? "No";
    document.getElementById("autoPayRef").value = item.autoPayRef || "";
    return;
  }

  if (action === "delete-pay" && auth.can("editPayslips")) {
    state.pay = state.pay.filter((x) => x.id !== id);
    saveData(KEYS.pay, state.pay);
    refresh();
  }
});

applyAccess();
document.getElementById("nightRunPay").value = "0.00";
document.getElementById("payTruckNumber").addEventListener("change", applyConfiguredRatesIfMatch);
document.getElementById("payTruckNumber").addEventListener("blur", applyConfiguredRatesIfMatch);
document.getElementById("nightRunDrops").addEventListener("input", updateNightRunPayPreview);
document.getElementById("nightRunDrops").addEventListener("change", updateNightRunPayPreview);
refresh();
