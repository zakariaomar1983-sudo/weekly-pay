const auth = window.OPXAuth?.requireAuth("./login.html");
if (!auth) throw new Error("Authentication required");

if (!auth.can("accessCRM") || !auth.can("viewReports")) {
  document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>You do not have permission to access the Reports page.</p></section></main>";
  throw new Error("No reports access");
}

const STORAGE_KEYS = {
  income: "transport_crm_truck_income",
  expense: "transport_crm_spending",
  pay: "transport_crm_payslips",
  roster: "transport_crm_roster",
  drivers: "transport_crm_drivers",
  trucks: "transport_crm_trucks"
};
const REPORT_SCHEDULER_KEY = "transport_crm_report_scheduler";
const REPORT_SNAPSHOTS_KEY = "transport_crm_report_snapshots";
const REPORT_SNAPSHOT_LIMIT = 12;
const TABLE_BY_KEY = {
  [STORAGE_KEYS.income]: "truck_income",
  [STORAGE_KEYS.expense]: "truck_expense",
  [STORAGE_KEYS.pay]: "payslips",
  [STORAGE_KEYS.roster]: "roster",
  [STORAGE_KEYS.drivers]: "drivers",
  [STORAGE_KEYS.trucks]: "trucks"
};
const DATA_FIELD_BY_STORAGE_KEY = {
  [STORAGE_KEYS.income]: "income",
  [STORAGE_KEYS.expense]: "expense",
  [STORAGE_KEYS.pay]: "pay",
  [STORAGE_KEYS.roster]: "roster",
  [STORAGE_KEYS.drivers]: "drivers",
  [STORAGE_KEYS.trucks]: "trucks"
};
const AWAY_STATUSES = new Set(["leave", "absent"]);

const NIGHT_DROP_DEFAULT_RATE = 90;
const reportState = {
  financeRows: [],
  driverRows: [],
  truckRows: [],
  chartSeries: [],
  snapshots: [],
  emailConfigured: false,
  serverDeliveryActive: false,
  sharedData: null
};
const canEmailReports = auth.can("emailReports");

function readRows(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readObject(key, fallback = {}) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // ignore
  }
  return fallback;
}

function readSnapshots() {
  try {
    const parsed = JSON.parse(localStorage.getItem(REPORT_SNAPSHOTS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSnapshots(rows) {
  reportState.snapshots = rows;
  localStorage.setItem(REPORT_SNAPSHOTS_KEY, JSON.stringify(rows));
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, "\"\"")}"`;
  return text;
}

function downloadTextFile(filename, content, mimeType = "text/plain;charset=utf-8;") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportCsv(filename, columns, rows) {
  const header = columns.map((column) => csvCell(column.label)).join(",");
  const body = rows.map((row) =>
    columns.map((column) => csvCell(typeof column.value === "function" ? column.value(row) : row[column.value])).join(",")
  ).join("\n");
  downloadTextFile(filename, `${header}\n${body}`, "text/csv;charset=utf-8;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function keyOf(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `report-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function addDays(value, days) {
  const date = value instanceof Date ? new Date(value) : parseDateOnly(value);
  if (!date) return null;
  date.setDate(date.getDate() + days);
  return date;
}

function weekStartByDay(value, weekStartDay) {
  const date = value instanceof Date ? new Date(value) : parseDateOnly(value);
  if (!date) return null;
  date.setHours(0, 0, 0, 0);
  while (date.getDay() !== weekStartDay) {
    date.setDate(date.getDate() - 1);
  }
  return date;
}

function financeWeekKey(value) {
  const start = weekStartByDay(value, 4);
  return start ? keyOf(start) : "";
}

function rosterWeekKey(value) {
  const start = weekStartByDay(value, 1);
  return start ? keyOf(start) : "";
}

function latestWeekStart(rows, dateSelector, weekStartDay) {
  const dates = rows
    .map((row) => weekStartByDay(dateSelector(row), weekStartDay))
    .filter(Boolean)
    .sort((a, b) => b - a);
  return dates[0] || weekStartByDay(new Date(), weekStartDay);
}

function preferredRosterWeekStart(rows) {
  const summary = new Map();
  rows.forEach((row) => {
    const weekKey = rosterWeekKey(row.shiftDate);
    if (!weekKey) return;
    if (!summary.has(weekKey)) summary.set(weekKey, { total: 0, active: 0 });
    const bucket = summary.get(weekKey);
    bucket.total += 1;
    if (!isAwayRosterStatus(row.status)) bucket.active += 1;
  });
  const keys = Array.from(summary.keys()).sort().reverse();
  if (!keys.length) return weekStartByDay(new Date(), 1);
  const activeWeekKey = keys.find((key) => (summary.get(key)?.active || 0) > 0) || keys[0];
  return parseDateOnly(activeWeekKey) || weekStartByDay(new Date(), 1);
}

function formatShortDate(value) {
  const date = value instanceof Date ? value : parseDateOnly(value);
  if (!date) return "Unknown";
  return date.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

function formatWeekRange(start, end) {
  if (!start || !end) return "Unknown";
  return `${formatShortDate(start)} to ${formatShortDate(end)}`;
}

function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function moneyCompact(value) {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 1000000) return `$${(amount / 1000000).toFixed(1)}m`;
  if (Math.abs(amount) >= 1000) return `$${(amount / 1000).toFixed(1)}k`;
  return `$${amount.toFixed(0)}`;
}

function normalizeRosterStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function isAwayRosterStatus(value) {
  return AWAY_STATUSES.has(normalizeRosterStatus(value));
}

function shortWeekLabel(weekKey) {
  const start = parseDateOnly(weekKey);
  if (!start) return "Week";
  return start.toLocaleDateString("en-AU", { day: "2-digit", month: "short" });
}

function rollingWeekKeys(startDay, count = 6) {
  const latest = weekStartByDay(new Date(), startDay);
  const keys = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const week = addDays(latest, -(index * 7));
    keys.push(keyOf(week));
  }
  return keys;
}

function renderChartBars(values, formatter) {
  const maxValue = Math.max(...values.map((item) => Number(item.value || 0)), 0);
  return values.map((item) => {
    const amount = Number(item.value || 0);
    const fill = maxValue > 0 ? Math.max((amount / maxValue) * 100, 6) : 6;
    return `
      <div class="chart-bar-wrap">
        <div class="chart-bar-value">${formatter(amount)}</div>
        <div class="chart-bar-track">
          <div class="chart-bar-fill" style="height:${fill}%"></div>
        </div>
        <div class="chart-bar-label">${shortWeekLabel(item.week)}</div>
      </div>
    `;
  }).join("");
}

function schedulerDefaults() {
  return {
    active: true,
    day: 4,
    time: "08:00",
    recipients: "",
    autoEmail: false,
    lastPreparedRunKey: "",
    lastPreparedAt: "",
    lastEmailedRunKey: "",
    lastEmailedAt: ""
  };
}

function readScheduler() {
  return { ...schedulerDefaults(), ...readObject(REPORT_SCHEDULER_KEY, {}) };
}

function saveScheduler(nextValue) {
  localStorage.setItem(REPORT_SCHEDULER_KEY, JSON.stringify(nextValue));
}

function normalizeRecipientList(value) {
  return String(value || "")
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function withTime(date, timeValue) {
  const next = new Date(date);
  const [hours, minutes] = String(timeValue || "08:00").split(":").map((part) => Number(part || 0));
  next.setHours(hours || 0, minutes || 0, 0, 0);
  return next;
}

function mostRecentScheduledRun(schedule, now = new Date()) {
  let run = withTime(weekStartByDay(now, schedule.day), schedule.time);
  if (run > now) run = addDays(run, -7);
  return run;
}

function nextScheduledRun(schedule, now = new Date()) {
  let run = withTime(weekStartByDay(now, schedule.day), schedule.time);
  if (run <= now) run = addDays(run, 7);
  return run;
}

function payNetAmount(item) {
  const daysWorked = Number(item.daysWorked || 0);
  const dailyRate = Number(item.dailyRate || 0);
  const nightRunDrops = Number(item.nightRunDrops || 0);
  const bonus = Number(item.driverBonus || 0);
  const deductions = Number(item.deductions || 0);
  return (daysWorked * dailyRate) + (nightRunDrops * NIGHT_DROP_DEFAULT_RATE) + bonus - deductions;
}

function readLocalDataSnapshot() {
  return {
    income: readRows(STORAGE_KEYS.income),
    expense: readRows(STORAGE_KEYS.expense),
    pay: readRows(STORAGE_KEYS.pay),
    roster: readRows(STORAGE_KEYS.roster),
    drivers: readRows(STORAGE_KEYS.drivers),
    trucks: readRows(STORAGE_KEYS.trucks)
  };
}

function currentData() {
  return reportState.sharedData || readLocalDataSnapshot();
}

function getSupabaseClient() {
  return window.OPXSupabase?.client || null;
}

function isSupabaseReady() {
  return Boolean(window.OPXSupabase?.isReady && getSupabaseClient());
}

function fromDbIncome(row) {
  return {
    id: row.id,
    incomeDate: row.income_date || "",
    truckNumber: row.truck_number || "",
    jobRef: row.job_ref || "",
    client: row.client || "",
    amount: Number(row.amount || 0),
    status: row.status || "",
    notes: row.notes || ""
  };
}

function fromDbExpense(row) {
  return {
    id: row.id,
    date: row.expense_date || "",
    truckNumber: row.truck_number || "",
    category: row.category || "",
    amount: Number(row.amount || 0),
    vendor: row.vendor || "",
    notes: row.notes || ""
  };
}

function fromDbPay(row) {
  return {
    id: row.id,
    driver: row.driver || "",
    truckNumber: row.truck_number || "",
    payPeriod: row.pay_period || "",
    daysWorked: Number(row.days_worked || 0),
    dailyRate: Number(row.daily_rate || 0),
    nightRunDrops: Number(row.night_run_drops || 0),
    driverBonus: Number(row.driver_bonus || 0),
    deductions: Number(row.deductions || 0),
    paymentDate: row.payment_date || ""
  };
}

function fromDbRoster(row) {
  const runType = String(row.run_type || "").trim().toLowerCase();
  return {
    id: row.id,
    driverName: row.driver_name || "",
    truckNumber: row.truck_number || "",
    nightRun: runType === "night run" || runType === "night run +",
    shiftDate: row.shift_date || "",
    shiftTime: row.shift_time || "",
    route: row.route || "",
    status: row.status || "Scheduled"
  };
}

function fromDbDriver(row) {
  return {
    id: row.id,
    name: row.name || "",
    status: row.status || ""
  };
}

function fromDbTruck(row) {
  return {
    id: row.id,
    truckNumber: row.truck_number || "",
    status: row.status || ""
  };
}

function fromDbRows(key, rows) {
  if (key === STORAGE_KEYS.income) return rows.map(fromDbIncome);
  if (key === STORAGE_KEYS.expense) return rows.map(fromDbExpense);
  if (key === STORAGE_KEYS.pay) return rows.map(fromDbPay);
  if (key === STORAGE_KEYS.roster) return rows.map(fromDbRoster);
  if (key === STORAGE_KEYS.drivers) return rows.map(fromDbDriver);
  if (key === STORAGE_KEYS.trucks) return rows.map(fromDbTruck);
  return rows;
}

function primaryTruckMap(rosterRows, fallbackTrucks) {
  const map = new Map();
  rosterRows.forEach((row) => {
    const name = String(row.driverName || "").trim();
    const truck = String(row.truckNumber || "").trim();
    if (!name || !truck || map.has(name)) return;
    map.set(name, truck);
  });
  fallbackTrucks.forEach((truck) => {
    const name = String(truck.assignedDriver || "").trim();
    const truckNumber = String(truck.truckNumber || "").trim();
    if (!name || !truckNumber || map.has(name)) return;
    map.set(name, truckNumber);
  });
  return map;
}

function collectFinanceReportRows(data, selectedFinanceWeekKey) {
  const groups = new Map();
  const add = (key, field, amount) => {
    if (!key) return;
    if (!groups.has(key)) groups.set(key, { income: 0, expense: 0, pay: 0 });
    groups.get(key)[field] += Number(amount || 0);
  };

  data.income.forEach((row) => add(financeWeekKey(row.incomeDate || row.date), "income", row.amount));
  data.expense.forEach((row) => add(financeWeekKey(row.expenseDate || row.date), "expense", row.amount));
  data.pay.forEach((row) => add(financeWeekKey(row.paymentDate || row.periodStart || row.periodEnd), "pay", payNetAmount(row)));

  return Array.from(groups.keys()).sort().reverse().slice(0, 6).map((weekKey) => {
    const item = groups.get(weekKey) || { income: 0, expense: 0, pay: 0 };
    const start = parseDateOnly(weekKey);
    const end = addDays(start, 6);
    return {
      weekKey,
      week: selectedFinanceWeekKey === weekKey ? `${formatWeekRange(start, end)} (Selected)` : formatWeekRange(start, end),
      truckIncome: item.income,
      truckExpense: item.expense,
      driverPay: item.pay,
      profit: item.income - item.expense - item.pay
    };
  });
}

function buildWeeklyFinanceSummary(data, selectedFinanceWeekKey) {
  const tbody = document.getElementById("reportsFinanceTableBody");
  reportState.financeRows = collectFinanceReportRows(data, selectedFinanceWeekKey);
  if (!reportState.financeRows.length) {
    tbody.innerHTML = "<tr><td colspan='5' class='empty'>No finance records found yet.</td></tr>";
    return;
  }

  tbody.innerHTML = reportState.financeRows.map((row) => {
    return `<tr>
      <td>${row.week}</td>
      <td>${money(row.truckIncome)}</td>
      <td>${money(row.truckExpense)}</td>
      <td>${money(row.driverPay)}</td>
      <td>${money(row.profit)}</td>
    </tr>`;
  }).join("");
}

function buildReportsChartSeries(data) {
  const financeWeekKeys = rollingWeekKeys(4, 6);
  const rosterWeekKeys = rollingWeekKeys(1, 6);
  const incomeMap = new Map(financeWeekKeys.map((week) => [week, 0]));
  const expenseMap = new Map(financeWeekKeys.map((week) => [week, 0]));
  const payMap = new Map(financeWeekKeys.map((week) => [week, 0]));
  const completedMap = new Map(rosterWeekKeys.map((week) => [week, 0]));

  data.income.forEach((row) => {
    const week = financeWeekKey(row.incomeDate || row.date);
    if (incomeMap.has(week)) incomeMap.set(week, incomeMap.get(week) + Number(row.amount || 0));
  });

  data.expense.forEach((row) => {
    const week = financeWeekKey(row.expenseDate || row.date);
    if (expenseMap.has(week)) expenseMap.set(week, expenseMap.get(week) + Number(row.amount || 0));
  });

  data.pay.forEach((row) => {
    const week = financeWeekKey(row.paymentDate || row.periodStart || row.periodEnd);
    if (payMap.has(week)) payMap.set(week, payMap.get(week) + payNetAmount(row));
  });

  data.roster.forEach((row) => {
    if (String(row.status || "").trim().toLowerCase() !== "completed") return;
    const week = rosterWeekKey(row.shiftDate);
    if (completedMap.has(week)) completedMap.set(week, completedMap.get(week) + 1);
  });

  reportState.chartSeries = [
    {
      id: "income",
      label: "Truck Income",
      meta: "Last 6 finance weeks",
      tone: "live",
      formatter: moneyCompact,
      values: financeWeekKeys.map((week) => ({ week, value: incomeMap.get(week) || 0 }))
    },
    {
      id: "expense",
      label: "Truck Expense",
      meta: "Last 6 finance weeks",
      tone: "warning",
      formatter: moneyCompact,
      values: financeWeekKeys.map((week) => ({ week, value: expenseMap.get(week) || 0 }))
    },
    {
      id: "pay",
      label: "Driver Pay",
      meta: "Last 6 finance weeks",
      tone: "queue",
      formatter: moneyCompact,
      values: financeWeekKeys.map((week) => ({ week, value: payMap.get(week) || 0 }))
    },
    {
      id: "completed",
      label: "Completed Shifts",
      meta: "Last 6 roster weeks",
      tone: "neutral",
      formatter: (value) => String(Math.round(value)),
      values: rosterWeekKeys.map((week) => ({ week, value: completedMap.get(week) || 0 }))
    }
  ];
}

function drawReportsCharts() {
  const grid = document.getElementById("reportsChartsGrid");
  if (!grid) return;
  if (!reportState.chartSeries.length) {
    grid.innerHTML = "<p class='muted'>No chart data found yet.</p>";
    return;
  }
  grid.innerHTML = reportState.chartSeries.map((chart) => {
    const latest = chart.values[chart.values.length - 1]?.value || 0;
    return `
      <article class="chart-card chart-card-${chart.tone}">
        <div class="chart-card-head">
          <p>${chart.label}</p>
          <span>${chart.meta}</span>
        </div>
        <h3>${chart.formatter(latest)}</h3>
        <div class="chart-bars">
          ${renderChartBars(chart.values, chart.formatter)}
        </div>
      </article>
    `;
  }).join("");
}

function collectDriverReportRows(data, selectedRosterWeekKey) {
  const rows = data.roster.filter((row) => rosterWeekKey(row.shiftDate) === selectedRosterWeekKey);
  const drivers = data.drivers
    .map((row) => String(row.name || row.driverName || "").trim())
    .filter(Boolean);
  const names = Array.from(new Set([...drivers, ...rows.map((row) => String(row.driverName || "").trim()).filter(Boolean)])).sort();
  const primaryTrucks = primaryTruckMap(rows, data.trucks);
  return names.map((name) => {
    const driverRows = rows.filter((row) => String(row.driverName || "").trim() === name);
    return {
      driver: name,
      plannedShifts: driverRows.filter((row) => !isAwayRosterStatus(row.status)).length,
      completed: driverRows.filter((row) => normalizeRosterStatus(row.status) === "completed").length,
      leaveDays: driverRows.filter((row) => isAwayRosterStatus(row.status)).length,
      nightRuns: driverRows.filter((row) => row.nightRun).length,
      primaryTruck: primaryTrucks.get(name) || "-"
    };
  });
}

function buildDriverReport(data, selectedRosterWeekKey) {
  const tbody = document.getElementById("reportsDriversTableBody");
  reportState.driverRows = collectDriverReportRows(data, selectedRosterWeekKey);
  if (!reportState.driverRows.length) {
    tbody.innerHTML = "<tr><td colspan='6' class='empty'>No driver records found yet.</td></tr>";
    return;
  }

  tbody.innerHTML = reportState.driverRows.map((row) => {
    return `<tr>
      <td><strong>${row.driver}</strong></td>
      <td>${row.plannedShifts}</td>
      <td>${row.completed}</td>
      <td>${row.leaveDays}</td>
      <td>${row.nightRuns}</td>
      <td>${row.primaryTruck}</td>
    </tr>`;
  }).join("");
}

function collectTruckReportRows(data, selectedFinanceWeekKey) {
  const summary = new Map();
  const ensure = (truck) => {
    const key = String(truck || "").trim();
    if (!key) return null;
    if (!summary.has(key)) summary.set(key, { income: 0, expense: 0, incomeJobs: 0, expenseItems: 0 });
    return summary.get(key);
  };

  data.income
    .filter((row) => financeWeekKey(row.incomeDate || row.date) === selectedFinanceWeekKey)
    .forEach((row) => {
      const item = ensure(row.truckNumber);
      if (!item) return;
      item.income += Number(row.amount || 0);
      item.incomeJobs += 1;
    });

  data.expense
    .filter((row) => financeWeekKey(row.expenseDate || row.date) === selectedFinanceWeekKey)
    .forEach((row) => {
      const item = ensure(row.truckNumber);
      if (!item) return;
      item.expense += Number(row.amount || 0);
      item.expenseItems += 1;
    });

  return Array.from(summary.keys()).sort((a, b) => Number(a) - Number(b)).map((truckNumber) => {
    const item = summary.get(truckNumber);
    return {
      truckNumber,
      income: item.income,
      expense: item.expense,
      net: item.income - item.expense,
      incomeJobs: item.incomeJobs,
      expenseItems: item.expenseItems
    };
  });
}

function buildTruckReport(data, selectedFinanceWeekKey) {
  const tbody = document.getElementById("reportsTrucksTableBody");
  reportState.truckRows = collectTruckReportRows(data, selectedFinanceWeekKey);
  if (!reportState.truckRows.length) {
    tbody.innerHTML = "<tr><td colspan='6' class='empty'>No truck income or expense records found for this finance week.</td></tr>";
    return;
  }

  tbody.innerHTML = reportState.truckRows.map((row) => {
    return `<tr>
      <td><strong>${row.truckNumber}</strong></td>
      <td>${money(row.income)}</td>
      <td>${money(row.expense)}</td>
      <td>${money(row.net)}</td>
      <td>${row.incomeJobs}</td>
      <td>${row.expenseItems}</td>
    </tr>`;
  }).join("");
}

function drawStats(data, selectedFinanceWeekKey, selectedRosterWeekKey) {
  const financeIncome = data.income
    .filter((row) => financeWeekKey(row.incomeDate || row.date) === selectedFinanceWeekKey)
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const financeExpense = data.expense
    .filter((row) => financeWeekKey(row.expenseDate || row.date) === selectedFinanceWeekKey)
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const financePay = data.pay
    .filter((row) => financeWeekKey(row.paymentDate || row.periodStart || row.periodEnd) === selectedFinanceWeekKey)
    .reduce((sum, row) => sum + payNetAmount(row), 0);
  const rosterRows = data.roster.filter((row) => rosterWeekKey(row.shiftDate) === selectedRosterWeekKey);
  const completedShifts = rosterRows.filter((row) => normalizeRosterStatus(row.status) === "completed").length;
  const leaveDays = rosterRows.filter((row) => isAwayRosterStatus(row.status)).length;
  const stats = [
    { label: "Finance Week Income", value: money(financeIncome) },
    { label: "Finance Week Expense", value: money(financeExpense) },
    { label: "Finance Week Profit", value: money(financeIncome - financeExpense - financePay) },
    { label: "Completed Shifts", value: String(completedShifts) },
    { label: "Leave Days", value: String(leaveDays) },
    { label: "Drivers In Report", value: String(new Set(rosterRows.map((row) => row.driverName).filter(Boolean)).size) }
  ];
  document.getElementById("reportsStats").innerHTML = stats
    .map((item) => `<article class="stat-card"><p>${item.label}</p><h3>${item.value}</h3></article>`)
    .join("");
}

function buildSnapshot(data, financeWeekKeyValue, rosterWeekKeyValue, mode = "auto", preparedAt = new Date()) {
  const financeRows = collectFinanceReportRows(data, financeWeekKeyValue);
  const driverRows = collectDriverReportRows(data, rosterWeekKeyValue);
  const financeCurrent = financeRows.find((row) => row.weekKey === financeWeekKeyValue) || financeRows[0] || null;
  return {
    id: newId(),
    preparedAt: preparedAt.toISOString(),
    mode,
    runKey: financeWeekKeyValue,
    financeWeekKey: financeWeekKeyValue,
    rosterWeekKey: rosterWeekKeyValue,
    financeWeekLabel: financeCurrent?.week || formatWeekRange(parseDateOnly(financeWeekKeyValue), addDays(parseDateOnly(financeWeekKeyValue), 6)),
    rosterWeekLabel: formatWeekRange(parseDateOnly(rosterWeekKeyValue), addDays(parseDateOnly(rosterWeekKeyValue), 6)),
    profit: financeCurrent?.profit || 0,
    completedShifts: driverRows.reduce((sum, row) => sum + Number(row.completed || 0), 0)
  };
}

function buildReportAttachmentHtml(snapshot, financeRows, driverRows, truckRows) {
  const financeTable = financeRows.length
    ? financeRows.map((row) => `<tr><td>${escapeHtml(row.week)}</td><td>${money(row.truckIncome)}</td><td>${money(row.truckExpense)}</td><td>${money(row.driverPay)}</td><td>${money(row.profit)}</td></tr>`).join("")
    : "<tr><td colspan='5'>No finance rows</td></tr>";
  const driverTable = driverRows.length
    ? driverRows.map((row) => `<tr><td>${escapeHtml(row.driver)}</td><td>${row.plannedShifts}</td><td>${row.completed}</td><td>${row.leaveDays}</td><td>${row.nightRuns}</td><td>${escapeHtml(row.primaryTruck)}</td></tr>`).join("")
    : "<tr><td colspan='6'>No driver rows</td></tr>";
  const truckTable = truckRows.length
    ? truckRows.map((row) => `<tr><td>${escapeHtml(row.truckNumber)}</td><td>${money(row.income)}</td><td>${money(row.expense)}</td><td>${money(row.net)}</td><td>${row.incomeJobs}</td><td>${row.expenseItems}</td></tr>`).join("")
    : "<tr><td colspan='6'>No truck rows</td></tr>";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>OnPoint Weekly Report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #17313d; padding: 24px; }
    h1, h2 { margin: 0 0 12px; }
    .meta { margin: 0 0 18px; color: #4c6470; }
    .stats { display: flex; gap: 12px; margin: 18px 0 24px; flex-wrap: wrap; }
    .card { border: 1px solid #d7e1e5; border-radius: 12px; padding: 12px 14px; min-width: 180px; background: #f7fbfc; }
    .card p { margin: 0 0 6px; color: #5a7280; font-size: 12px; text-transform: uppercase; }
    .card strong { font-size: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 28px; }
    th, td { border: 1px solid #d7e1e5; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #eff6f8; }
  </style>
</head>
<body>
  <h1>OnPoint Express Weekly Report</h1>
  <p class="meta">Prepared ${escapeHtml(formatDateTime(snapshot.preparedAt))} | Finance Week: ${escapeHtml(snapshot.financeWeekLabel)} | Roster Week: ${escapeHtml(snapshot.rosterWeekLabel)}</p>
  <div class="stats">
    <div class="card"><p>Profit</p><strong>${money(snapshot.profit)}</strong></div>
    <div class="card"><p>Completed Shifts</p><strong>${snapshot.completedShifts}</strong></div>
  </div>
  <h2>Weekly Finance Summary</h2>
  <table>
    <thead><tr><th>Week</th><th>Truck Income</th><th>Truck Expense</th><th>Driver Pay</th><th>Profit</th></tr></thead>
    <tbody>${financeTable}</tbody>
  </table>
  <h2>Driver Operations Report</h2>
  <table>
    <thead><tr><th>Driver</th><th>Planned Shifts</th><th>Completed</th><th>Leave Days</th><th>Night Runs</th><th>Primary Truck</th></tr></thead>
    <tbody>${driverTable}</tbody>
  </table>
  <h2>Truck Performance Report</h2>
  <table>
    <thead><tr><th>Truck #</th><th>Income</th><th>Expense</th><th>Net</th><th>Income Jobs</th><th>Expense Items</th></tr></thead>
    <tbody>${truckTable}</tbody>
  </table>
</body>
</html>`;
}

function renderSnapshotsTable() {
  const tbody = document.getElementById("reportsSnapshotsTableBody");
  if (!tbody) return;
  if (!reportState.snapshots.length) {
    tbody.innerHTML = "<tr><td colspan='7' class='empty'>No prepared reports yet.</td></tr>";
    return;
  }
  tbody.innerHTML = reportState.snapshots.map((snapshot) => `
    <tr>
      <td>${formatDateTime(snapshot.preparedAt)}</td>
      <td>${snapshot.mode === "manual" ? "Manual" : "Auto"}</td>
      <td>${snapshot.financeWeekLabel}</td>
      <td>${snapshot.rosterWeekLabel}</td>
      <td>${money(snapshot.profit)}</td>
      <td>${snapshot.completedShifts}</td>
      <td><button class="btn btn-outline" type="button" data-action="load-snapshot" data-id="${snapshot.id}">Load Weeks</button></td>
    </tr>
  `).join("");
}

function updateSchedulerUi() {
  const scheduler = readScheduler();
  const nextRun = nextScheduledRun(scheduler);
  document.getElementById("reportSchedulerActive").checked = Boolean(scheduler.active);
  document.getElementById("reportSchedulerTime").value = scheduler.time || "08:00";
  const recipientsInput = document.getElementById("reportSchedulerRecipients");
  const autoEmailInput = document.getElementById("reportSchedulerAutoEmail");
  const emailButton = document.getElementById("emailPreparedReportBtn");
  recipientsInput.value = scheduler.recipients || "";
  autoEmailInput.checked = Boolean(scheduler.autoEmail);
  recipientsInput.disabled = !canEmailReports;
  autoEmailInput.disabled = !canEmailReports || reportState.serverDeliveryActive;
  if (emailButton) emailButton.hidden = !canEmailReports;
  document.getElementById("reportSchedulerNextRun").textContent = scheduler.active ? formatDateTime(nextRun) : "Paused";
  document.getElementById("reportSchedulerLastRun").textContent = scheduler.lastPreparedAt ? formatDateTime(scheduler.lastPreparedAt) : "Not prepared yet";
}

function setSchedulerStatus(message, tone = "muted") {
  const element = document.getElementById("reportSchedulerStatus");
  if (!element) return;
  element.textContent = message;
  element.className = tone === "error" ? "error-text" : "muted";
}

function setReportEmailStatus(message, tone = "muted") {
  const element = document.getElementById("reportEmailStatus");
  if (!element) return;
  element.textContent = message;
  element.className = tone === "error" ? "error-text" : "muted";
}

function setServerSchedulerStatus(message, tone = "muted") {
  const element = document.getElementById("reportServerSchedulerStatus");
  if (!element) return;
  element.textContent = message;
  element.className = tone === "error" ? "error-text" : "muted";
}

async function refreshReportEmailConfigured() {
  if (!canEmailReports) {
    reportState.emailConfigured = false;
    setReportEmailStatus("Only leadership roles can email prepared reports.", "muted");
    return;
  }
  try {
    const response = await fetch("/api/send-weekly-report-email", { method: "GET" });
    const payload = await response.json().catch(() => ({}));
    reportState.emailConfigured = Boolean(payload?.configured);
    setReportEmailStatus(
      reportState.emailConfigured
        ? "Weekly report email sender is ready."
        : "Weekly report email sender is not configured yet.",
      reportState.emailConfigured ? "muted" : "error"
    );
  } catch {
    reportState.emailConfigured = false;
    setReportEmailStatus("Could not check the weekly report email sender right now.", "error");
  }
}

async function refreshServerSchedulerStatus() {
  try {
    const response = await fetch("/api/weekly-report-cron", { method: "GET" });
    const payload = await response.json().catch(() => ({}));
    reportState.serverDeliveryActive = Boolean(payload?.serverDeliveryActive);

    if (reportState.serverDeliveryActive) {
      const scheduler = readScheduler();
      if (scheduler.autoEmail) {
        saveScheduler({ ...scheduler, autoEmail: false });
      }
      updateSchedulerUi();
      const lastSentText = payload?.lastSent?.createdAt
        ? ` Last sent ${formatDateTime(payload.lastSent.createdAt)}.`
        : " No weekly report has been sent from the server yet.";
      setServerSchedulerStatus(
        `Server-side Thursday delivery is active and uses Vercel recipients.${lastSentText}`,
        "muted"
      );
      return;
    }

    if (!payload?.recipientsConfigured) {
      setServerSchedulerStatus("Server-side Thursday delivery needs REPORTS_AUTO_EMAIL_TO in Vercel.", "error");
      return;
    }
    if (!payload?.emailConfigured) {
      setServerSchedulerStatus("Server-side Thursday delivery needs the Resend sender configured in Vercel.", "error");
      return;
    }
    if (!payload?.supabaseConfigured) {
      setServerSchedulerStatus("Server-side Thursday delivery needs Supabase configured for the server.", "error");
      return;
    }
    setServerSchedulerStatus("Server-side Thursday delivery is not active yet.", "muted");
  } catch {
    reportState.serverDeliveryActive = false;
    setServerSchedulerStatus("Could not check the server-side Thursday delivery right now.", "error");
  }
}

async function hydrateReportsFromSupabase({ preserveInputs = true } = {}) {
  if (!isSupabaseReady()) return false;
  const supabase = getSupabaseClient();
  if (!supabase) return false;

  const localData = readLocalDataSnapshot();
  const nextData = {
    income: [...localData.income],
    expense: [...localData.expense],
    pay: [...localData.pay],
    roster: [...localData.roster],
    drivers: [...localData.drivers],
    trucks: [...localData.trucks]
  };

  let loadedAny = false;
  const keys = Object.values(STORAGE_KEYS);
  const responses = await Promise.all(keys.map((key) => supabase.from(TABLE_BY_KEY[key]).select("*")));

  responses.forEach((result, index) => {
    const storageKey = keys[index];
    const field = DATA_FIELD_BY_STORAGE_KEY[storageKey];
    if (result?.error || !Array.isArray(result?.data)) {
      if (result?.error) {
        console.error(`Supabase load failed for ${TABLE_BY_KEY[storageKey]}:`, result.error.message);
      }
      return;
    }

    loadedAny = true;
    const mappedRows = fromDbRows(storageKey, result.data);
    if (!mappedRows.length && nextData[field].length) return;
    nextData[field] = mappedRows;
    localStorage.setItem(storageKey, JSON.stringify(mappedRows));
  });

  if (loadedAny) {
    reportState.sharedData = nextData;
    refreshReports({ preserveInputs });
  }
  return loadedAny;
}

async function sendPreparedReportEmail(snapshot, mode = "manual") {
  if (!canEmailReports) {
    setReportEmailStatus("Only leadership roles can email prepared reports.", "error");
    return false;
  }
  const scheduler = readScheduler();
  const recipients = normalizeRecipientList(scheduler.recipients);
  if (!recipients.length) {
    setReportEmailStatus("Add one or more report email recipients first.", "error");
    return false;
  }
  if (!reportState.emailConfigured) {
    setReportEmailStatus("Weekly report email sender is not configured yet.", "error");
    return false;
  }

  const data = currentData();
  const financeRows = collectFinanceReportRows(data, snapshot.financeWeekKey);
  const driverRows = collectDriverReportRows(data, snapshot.rosterWeekKey);
  const truckRows = collectTruckReportRows(data, snapshot.financeWeekKey);
  const attachmentHtml = buildReportAttachmentHtml(snapshot, financeRows, driverRows, truckRows);

  const response = await fetch("/api/send-weekly-report-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: recipients,
      subject: `OnPoint Express Weekly Report - ${snapshot.financeWeekLabel}`,
      text: `Weekly report prepared ${formatDateTime(snapshot.preparedAt)}. Finance week: ${snapshot.financeWeekLabel}. Profit: ${money(snapshot.profit)}. Completed shifts: ${snapshot.completedShifts}.`,
      attachmentHtml,
      attachmentFilename: `weekly-report-${snapshot.financeWeekKey}.html`
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Could not send the weekly report email.");
  }

  saveScheduler({
    ...scheduler,
    lastEmailedRunKey: snapshot.runKey,
    lastEmailedAt: new Date().toISOString()
  });
  setReportEmailStatus(`${mode === "auto" ? "Automatic" : "Manual"} weekly report email sent.`, "muted");
  return true;
}

async function prepareScheduledSnapshot(mode = "auto", runDateOverride = null) {
  const scheduler = readScheduler();
  const data = currentData();
  const runDate = runDateOverride || mostRecentScheduledRun(scheduler);
  const financeWeekKeyValue = keyOf(weekStartByDay(runDate, 4));
  const rosterWeekKeyValue = keyOf(weekStartByDay(runDate, 1));
  const snapshot = buildSnapshot(data, financeWeekKeyValue, rosterWeekKeyValue, mode, new Date());
  const nextSnapshots = [snapshot, ...readSnapshots().filter((item) => item.id !== snapshot.id && !(item.runKey === snapshot.runKey && item.mode === snapshot.mode))].slice(0, REPORT_SNAPSHOT_LIMIT);
  saveSnapshots(nextSnapshots);
  saveScheduler({
    ...scheduler,
    lastPreparedRunKey: snapshot.runKey,
    lastPreparedAt: snapshot.preparedAt
  });
  updateSchedulerUi();
  renderSnapshotsTable();
  setSchedulerStatus(`${mode === "manual" ? "Manual" : "Automatic"} report prepared for ${snapshot.financeWeekLabel}.`, "muted");
  if (!reportState.serverDeliveryActive && canEmailReports && scheduler.autoEmail && normalizeRecipientList(scheduler.recipients).length) {
    const latestScheduler = readScheduler();
    if (latestScheduler.lastEmailedRunKey !== snapshot.runKey) {
      try {
        await sendPreparedReportEmail(snapshot, mode === "manual" ? "manual" : "auto");
      } catch (error) {
        setReportEmailStatus(String(error?.message || error || "Could not send the weekly report email."), "error");
      }
    }
  }
  return snapshot;
}

async function maybeRunScheduler() {
  const scheduler = readScheduler();
  reportState.snapshots = readSnapshots();
  renderSnapshotsTable();
  updateSchedulerUi();
  if (!scheduler.active) {
    setSchedulerStatus("Weekly report scheduler is paused.", "muted");
    return;
  }
  const dueRun = mostRecentScheduledRun(scheduler);
  const dueKey = keyOf(dueRun);
  if (scheduler.lastPreparedRunKey === dueKey) {
    setSchedulerStatus("Weekly report scheduler is active and up to date.", "muted");
    return;
  }
  await prepareScheduledSnapshot("auto", dueRun);
}

function applyAccess() {
  document.getElementById("currentUserChip").textContent = `User: ${auth.user.username}`;
  if (!auth.can("viewDrivers")) {
    const link = document.getElementById("driversLink");
    if (link) link.style.display = "none";
  }
  if (!auth.can("viewTrucks")) {
    const link = document.getElementById("trucksLink");
    if (link) link.style.display = "none";
  }
  if (!auth.can("viewRoster")) {
    const link = document.getElementById("rosterLink");
    if (link) link.style.display = "none";
  }
  if (!(auth.can("viewTruckIncome") || auth.can("viewSpending") || auth.can("viewPayslips") || auth.can("viewStats"))) {
    const link = document.getElementById("financeLink");
    if (link) link.style.display = "none";
  }
  if (!(auth.can("accessCRM") && (auth.can("viewSpending") || auth.can("editSpending") || auth.can("accessControlPanel")))) {
    const link = document.getElementById("receiptsLink");
    if (link) link.style.display = "none";
  }
  if (!auth.can("accessLogs")) {
    const link = document.getElementById("logsLink");
    if (link) link.style.display = "none";
  }
  if (!auth.can("accessControlPanel")) {
    const link = document.getElementById("controlPanelLink");
    if (link) link.style.display = "none";
  }
  if (!canEmailReports) {
    const recipientsInput = document.getElementById("reportSchedulerRecipients");
    const autoEmailInput = document.getElementById("reportSchedulerAutoEmail");
    const emailButton = document.getElementById("emailPreparedReportBtn");
    if (recipientsInput) recipientsInput.disabled = true;
    if (autoEmailInput) autoEmailInput.disabled = true;
    if (emailButton) emailButton.hidden = true;
  }
}

function refreshReports({ preserveInputs = true } = {}) {
  const data = currentData();
  const latestFinanceWeek = latestWeekStart(
    [...data.income, ...data.expense, ...data.pay],
    (row) => row.incomeDate || row.expenseDate || row.paymentDate || row.periodStart || row.periodEnd,
    4
  );
  const latestRosterWeek = preferredRosterWeekStart(data.roster);
  const financeWeekInput = document.getElementById("reportFinanceWeek");
  const rosterWeekInput = document.getElementById("reportRosterWeek");

  if (!preserveInputs || !financeWeekInput.value) financeWeekInput.value = keyOf(latestFinanceWeek);
  if (!preserveInputs || !rosterWeekInput.value) rosterWeekInput.value = keyOf(latestRosterWeek);

  const selectedFinanceWeekKey = financeWeekInput.value || keyOf(latestFinanceWeek);
  const selectedRosterWeekKey = rosterWeekInput.value || keyOf(latestRosterWeek);
  const financeStart = parseDateOnly(selectedFinanceWeekKey);
  const rosterStart = parseDateOnly(selectedRosterWeekKey);
  document.getElementById("reportsMeta").textContent =
    `Finance week: ${formatWeekRange(financeStart, addDays(financeStart, 6))}. Roster week: ${formatWeekRange(rosterStart, addDays(rosterStart, 6))}.`;

  buildReportsChartSeries(data);
  drawStats(data, selectedFinanceWeekKey, selectedRosterWeekKey);
  drawReportsCharts();
  buildWeeklyFinanceSummary(data, selectedFinanceWeekKey);
  buildDriverReport(data, selectedRosterWeekKey);
  buildTruckReport(data, selectedFinanceWeekKey);
}

applyAccess();
reportState.snapshots = readSnapshots();
refreshReports({ preserveInputs: false });
void hydrateReportsFromSupabase({ preserveInputs: false });
void refreshReportEmailConfigured();
void refreshServerSchedulerStatus();
void maybeRunScheduler();

if (!isSupabaseReady()) {
  window.addEventListener("opx:supabase-ready", () => {
    void hydrateReportsFromSupabase({ preserveInputs: true });
  }, { once: true });
  window.setTimeout(() => {
    if (isSupabaseReady()) {
      void hydrateReportsFromSupabase({ preserveInputs: true });
    }
  }, 1500);
}

document.getElementById("refreshReportsBtn").addEventListener("click", () => {
  refreshReports({ preserveInputs: true });
  void hydrateReportsFromSupabase({ preserveInputs: true });
});

document.getElementById("resetReportsBtn").addEventListener("click", () => {
  refreshReports({ preserveInputs: false });
});

document.getElementById("printReportsBtn").addEventListener("click", () => {
  window.print();
});

document.getElementById("exportFinanceReportBtn").addEventListener("click", () => {
  exportCsv("weekly-finance-report.csv", [
    { label: "Week", value: "week" },
    { label: "Truck Income", value: (row) => Number(row.truckIncome || 0).toFixed(2) },
    { label: "Truck Expense", value: (row) => Number(row.truckExpense || 0).toFixed(2) },
    { label: "Driver Pay", value: (row) => Number(row.driverPay || 0).toFixed(2) },
    { label: "Profit", value: (row) => Number(row.profit || 0).toFixed(2) }
  ], reportState.financeRows);
});

document.getElementById("exportDriverReportBtn").addEventListener("click", () => {
  exportCsv("driver-operations-report.csv", [
    { label: "Driver", value: "driver" },
    { label: "Planned Shifts", value: "plannedShifts" },
    { label: "Completed", value: "completed" },
    { label: "Leave Days", value: "leaveDays" },
    { label: "Night Runs", value: "nightRuns" },
    { label: "Primary Truck", value: "primaryTruck" }
  ], reportState.driverRows);
});

document.getElementById("exportTruckReportBtn").addEventListener("click", () => {
  exportCsv("truck-performance-report.csv", [
    { label: "Truck #", value: "truckNumber" },
    { label: "Income", value: (row) => Number(row.income || 0).toFixed(2) },
    { label: "Expense", value: (row) => Number(row.expense || 0).toFixed(2) },
    { label: "Net", value: (row) => Number(row.net || 0).toFixed(2) },
    { label: "Income Jobs", value: "incomeJobs" },
    { label: "Expense Items", value: "expenseItems" }
  ], reportState.truckRows);
});

document.getElementById("saveReportSchedulerBtn").addEventListener("click", () => {
  const currentScheduler = readScheduler();
  saveScheduler({
    ...currentScheduler,
    active: document.getElementById("reportSchedulerActive").checked,
    time: document.getElementById("reportSchedulerTime").value || "08:00",
    recipients: canEmailReports ? document.getElementById("reportSchedulerRecipients").value.trim() : currentScheduler.recipients,
    autoEmail: canEmailReports && !reportState.serverDeliveryActive
      ? document.getElementById("reportSchedulerAutoEmail").checked
      : false
  });
  updateSchedulerUi();
  setSchedulerStatus(
    reportState.serverDeliveryActive
      ? "Report scheduler saved. Browser auto-email stays off because server delivery is active."
      : "Report scheduler saved.",
    "muted"
  );
});

document.getElementById("runReportSchedulerNowBtn").addEventListener("click", async () => {
  await prepareScheduledSnapshot("manual", new Date());
  refreshReports({ preserveInputs: true });
});

document.getElementById("emailPreparedReportBtn").addEventListener("click", async () => {
  const financeWeekKeyValue = document.getElementById("reportFinanceWeek").value;
  const rosterWeekKeyValue = document.getElementById("reportRosterWeek").value;
  const snapshot = buildSnapshot(currentData(), financeWeekKeyValue, rosterWeekKeyValue, "manual", new Date());
  try {
    await sendPreparedReportEmail(snapshot, "manual");
  } catch (error) {
    setReportEmailStatus(String(error?.message || error || "Could not send the weekly report email."), "error");
  }
});

document.getElementById("reportsSnapshotsTableBody").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='load-snapshot']");
  if (!button) return;
  const snapshot = reportState.snapshots.find((item) => item.id === button.dataset.id);
  if (!snapshot) return;
  document.getElementById("reportFinanceWeek").value = snapshot.financeWeekKey;
  document.getElementById("reportRosterWeek").value = snapshot.rosterWeekKey;
  refreshReports({ preserveInputs: true });
  setSchedulerStatus(`Loaded prepared weeks from ${formatDateTime(snapshot.preparedAt)}.`, "muted");
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  window.OPXAuth.logout();
  window.location.href = "./login.html";
});

window.addEventListener("focus", () => {
  void maybeRunScheduler();
  void hydrateReportsFromSupabase({ preserveInputs: true });
});

window.addEventListener("storage", (event) => {
  if (!event.key) return;
  if (event.key === REPORT_SCHEDULER_KEY || event.key === REPORT_SNAPSHOTS_KEY) {
    void maybeRunScheduler();
  }
  const dataField = DATA_FIELD_BY_STORAGE_KEY[event.key];
  if (!dataField) return;
  if (reportState.sharedData) {
    reportState.sharedData[dataField] = readRows(event.key);
  }
  refreshReports({ preserveInputs: true });
});
