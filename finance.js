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
const TABLE_BY_KEY = {
  [KEYS.income]: "truck_income",
  [KEYS.expense]: "truck_expense",
  [KEYS.pay]: "payslips"
};
const supabase = window.OPXSupabase?.client || null;
const useSupabase = Boolean(window.OPXSupabase?.isReady && supabase);

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
    return ensureUuidRows(JSON.parse(localStorage.getItem(key) || "[]"), key);
  } catch {
    return [];
  }
}

function saveData(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
  if (useSupabase) {
    void syncRowsToSupabase(key, data);
  }
}

function uid() {
  return newId();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}${Math.random().toString(16).slice(2, 10)}`.slice(0, 32);
}

function ensureUuidRows(rows, key) {
  let changed = false;
  const normalized = rows.map((row) => {
    if (isUuid(row.id)) return row;
    changed = true;
    return { ...row, id: newId() };
  });
  if (changed && key) {
    localStorage.setItem(key, JSON.stringify(normalized));
  }
  return normalized;
}

function toDbIncome(item) {
  return {
    id: item.id,
    income_date: item.incomeDate || null,
    truck_number: item.truckNumber || "",
    job_ref: item.jobRef || "",
    client: item.client || "",
    amount: Number(item.amount || 0),
    status: item.status || "",
    notes: item.notes || ""
  };
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

function toDbExpense(item) {
  return {
    id: item.id,
    expense_date: item.date || null,
    truck_number: item.truckNumber || "",
    category: item.category || "",
    amount: Number(item.amount || 0),
    vendor: item.vendor || "",
    notes: item.notes || ""
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

function toDbPay(item) {
  return {
    id: item.id,
    driver: item.driver || "",
    truck_number: item.truckNumber || "",
    pay_period: item.payPeriod || "",
    days_worked: Number(item.daysWorked ?? item.hoursWorked ?? 0),
    daily_rate: Number(item.dailyRate ?? item.hourlyRate ?? 0),
    night_run_drops: Number(item.nightRunDrops ?? 0),
    drop_rate: Number(item.dropRate ?? NIGHT_DROP_DEFAULT_RATE),
    night_run_pay: Number(item.nightRunPay ?? ((Number(item.nightRunDrops ?? 0)) * NIGHT_DROP_DEFAULT_RATE)),
    driver_bonus: Number(item.driverBonus ?? 0),
    deductions: Number(item.deductions ?? 0),
    payment_date: item.paymentDate || null,
    auto_pay: item.autoPay || "No",
    auto_pay_ref: item.autoPayRef || ""
  };
}

function fromDbPay(row) {
  return {
    id: row.id,
    driver: row.driver || "",
    truckNumber: row.truck_number || "",
    payPeriod: row.pay_period || "",
    daysWorked: Number(row.days_worked ?? 0),
    dailyRate: Number(row.daily_rate ?? 0),
    nightRunDrops: Number(row.night_run_drops ?? 0),
    dropRate: Number(row.drop_rate ?? NIGHT_DROP_DEFAULT_RATE),
    nightRunPay: Number(row.night_run_pay ?? 0),
    driverBonus: Number(row.driver_bonus ?? 0),
    deductions: Number(row.deductions ?? 0),
    paymentDate: row.payment_date || "",
    autoPay: row.auto_pay || "No",
    autoPayRef: row.auto_pay_ref || ""
  };
}

function toDbRows(key, rows) {
  if (key === KEYS.income) return rows.map(toDbIncome);
  if (key === KEYS.expense) return rows.map(toDbExpense);
  if (key === KEYS.pay) return rows.map(toDbPay);
  return rows;
}

async function syncRowsToSupabase(key, rows) {
  if (!useSupabase) return;
  const table = TABLE_BY_KEY[key];
  if (!table) return;
  const payload = toDbRows(key, rows);
  const { error } = await supabase.from(table).upsert(payload, { onConflict: "id" });
  if (error) {
    console.error(`Supabase sync failed for ${table}:`, error.message);
    return;
  }

  const ids = payload.map((r) => r.id);
  if (!ids.length) {
    const wipe = await supabase.from(table).delete().not("id", "is", null);
    if (wipe.error) console.error(`Supabase delete sync failed for ${table}:`, wipe.error.message);
    return;
  }

  const inList = `(${ids.map((id) => `"${String(id).replaceAll('"', "")}"`).join(",")})`;
  const cleanup = await supabase.from(table).delete().not("id", "in", inList);
  if (cleanup.error) {
    console.error(`Supabase cleanup failed for ${table}:`, cleanup.error.message);
  }
}

async function hydrateFinanceFromSupabase() {
  if (!useSupabase) return;

  const [incomeRes, expenseRes, payRes] = await Promise.all([
    supabase.from(TABLE_BY_KEY[KEYS.income]).select("*"),
    supabase.from(TABLE_BY_KEY[KEYS.expense]).select("*"),
    supabase.from(TABLE_BY_KEY[KEYS.pay]).select("*")
  ]);

  if (!incomeRes.error && Array.isArray(incomeRes.data)) {
    state.income = incomeRes.data.map(fromDbIncome);
    localStorage.setItem(KEYS.income, JSON.stringify(state.income));
  } else if (incomeRes.error) {
    console.error("Supabase load failed for truck_income:", incomeRes.error.message);
  }

  if (!expenseRes.error && Array.isArray(expenseRes.data)) {
    state.expense = expenseRes.data.map(fromDbExpense);
    localStorage.setItem(KEYS.expense, JSON.stringify(state.expense));
  } else if (expenseRes.error) {
    console.error("Supabase load failed for truck_expense:", expenseRes.error.message);
  }

  if (!payRes.error && Array.isArray(payRes.data)) {
    state.pay = payRes.data.map(fromDbPay);
    localStorage.setItem(KEYS.pay, JSON.stringify(state.pay));
  } else if (payRes.error) {
    console.error("Supabase load failed for payslips:", payRes.error.message);
  }

  refresh();
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function printPayslip(item) {
  const totalDays = Number(item.daysWorked ?? item.hoursWorked ?? 0);
  const dailyRate = Number(item.dailyRate ?? item.hourlyRate ?? 0);
  const nightDrops = Number(item.nightRunDrops ?? 0);
  const dropRate = Number(item.dropRate ?? NIGHT_DROP_DEFAULT_RATE);
  const nightRunPay = Number(item.nightRunPay ?? (nightDrops * dropRate));
  const bonus = Number(item.driverBonus ?? 0);
  const deductions = Number(item.deductions ?? 0);
  const grossPay = totalDays * dailyRate + nightRunPay + bonus;
  const net = grossPay - deductions;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Payslip - ${escapeHtml(item.driver || "Driver")}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111; margin: 28px; }
    .wrap { max-width: 780px; margin: 0 auto; }
    h1 { margin: 0 0 6px 0; font-size: 28px; }
    h2 { margin: 0 0 18px 0; font-size: 18px; font-weight: 600; color: #444; }
    .meta { margin-bottom: 18px; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px; margin-bottom: 18px; }
    .row { display: flex; justify-content: space-between; border-bottom: 1px solid #ddd; padding: 10px 0; }
    .row strong { font-size: 16px; }
    .totals { margin-top: 12px; border-top: 2px solid #111; padding-top: 10px; }
    .right { text-align: right; }
    .muted { color: #666; }
    @media print { body { margin: 10mm; } }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Onpoint Express</h1>
    <h2>Driver Payslip</h2>
    <div class="meta">
      <div><strong>Driver:</strong> ${escapeHtml(item.driver || "-")}</div>
      <div><strong>Truck Number:</strong> ${escapeHtml(item.truckNumber || "-")}</div>
      <div><strong>Pay Period:</strong> ${escapeHtml(item.payPeriod || "-")}</div>
      <div><strong>Payment Date:</strong> ${escapeHtml(item.paymentDate || "-")}</div>
      <div><strong>Auto Pay:</strong> ${escapeHtml(item.autoPay || "No")} ${item.autoPayRef ? `(${escapeHtml(item.autoPayRef)})` : ""}</div>
    </div>

    <div class="grid">
      <div class="row"><span>Days Worked</span><span class="right">${totalDays}</span></div>
      <div class="row"><span>Daily Rate</span><span class="right">${money(dailyRate)}</span></div>
      <div class="row"><span>Night Run Drops</span><span class="right">${nightDrops}</span></div>
      <div class="row"><span>Drop Rate</span><span class="right">${money(dropRate)}</span></div>
      <div class="row"><span>Night Run Pay</span><span class="right">${money(nightRunPay)}</span></div>
      <div class="row"><span>Driver Bonus</span><span class="right">${money(bonus)}</span></div>
      <div class="row"><span>Deductions</span><span class="right">${money(deductions)}</span></div>
      <div class="row"><span>Gross Pay</span><span class="right">${money(grossPay)}</span></div>
    </div>

    <div class="row totals">
      <strong>Net Pay</strong>
      <strong class="right">${money(net)}</strong>
    </div>
    <p class="muted">Generated on ${new Date().toLocaleString("en-AU")}</p>
  </div>
</body>
</html>`;

  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) {
    alert("Pop-up blocked. Please allow pop-ups to print payslips.");
    return;
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => {
    printWindow.print();
  };
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

function parseDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function dateInRange(dateValue, rangeStart, rangeEnd) {
  const date = parseDateKey(dateValue);
  if (!date) return false;
  return date >= rangeStart && date <= rangeEnd;
}

function periodBoundsToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weekStart = weekStartFromDate(today.toISOString().slice(0, 10));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  monthEnd.setHours(23, 59, 59, 999);

  return { weekStart, weekEnd, monthStart, monthEnd };
}

function sumForRange(rows, dateField, amountGetter, start, end) {
  return rows.reduce((sum, row) => (
    dateInRange(row[dateField], start, end) ? sum + Number(amountGetter(row) || 0) : sum
  ), 0);
}

function drawPeriodTotalsDashboard() {
  const panel = document.getElementById("periodTotalsPanel");
  const meta = document.getElementById("periodTotalsMeta");
  const grid = document.getElementById("periodTotalsGrid");

  if (!auth.can("viewStats")) {
    panel.style.display = "none";
    return;
  }

  panel.style.display = "block";

  const { weekStart, weekEnd, monthStart, monthEnd } = periodBoundsToday();
  const fmt = { day: "2-digit", month: "short", year: "numeric" };
  meta.textContent = `Week: ${weekStart.toLocaleDateString("en-AU", fmt)} - ${weekEnd.toLocaleDateString("en-AU", fmt)} | Month: ${monthStart.toLocaleDateString("en-AU", { month: "long", year: "numeric" })}`;

  const weeklyIncome = sumForRange(state.income, "incomeDate", (x) => x.amount, weekStart, weekEnd);
  const monthlyIncome = sumForRange(state.income, "incomeDate", (x) => x.amount, monthStart, monthEnd);

  const weeklyExpense = sumForRange(state.expense, "date", (x) => x.amount, weekStart, weekEnd);
  const monthlyExpense = sumForRange(state.expense, "date", (x) => x.amount, monthStart, monthEnd);

  const weeklyDriverPay = sumForRange(state.pay, "paymentDate", (x) => netPay(x), weekStart, weekEnd);
  const monthlyDriverPay = sumForRange(state.pay, "paymentDate", (x) => netPay(x), monthStart, monthEnd);

  const weeklyProfit = weeklyIncome - weeklyExpense - weeklyDriverPay;
  const monthlyProfit = monthlyIncome - monthlyExpense - monthlyDriverPay;

  const cards = [
    { label: "Weekly Income", value: money(weeklyIncome) },
    { label: "Monthly Income", value: money(monthlyIncome) },
    { label: "Weekly Truck Expense", value: money(weeklyExpense) },
    { label: "Monthly Truck Expense", value: money(monthlyExpense) },
    { label: "Weekly Driver Pay", value: money(weeklyDriverPay) },
    { label: "Monthly Driver Pay", value: money(monthlyDriverPay) },
    {
      label: "Weekly Profit",
      value: money(weeklyProfit),
      tone: weeklyProfit > 0 ? "positive" : weeklyProfit < 0 ? "negative" : "neutral"
    },
    {
      label: "Monthly Profit",
      value: money(monthlyProfit),
      tone: monthlyProfit > 0 ? "positive" : monthlyProfit < 0 ? "negative" : "neutral"
    }
  ];

  grid.innerHTML = cards
    .map((card) => `<article class='stat-card${card.tone ? ` profit-${card.tone}` : ""}'><p>${card.label}</p><h3>${card.value}</h3></article>`)
    .join("");
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
    .map((item) => `<tr><td>${item.driver}</td><td>${item.truckNumber || "-"}</td><td>${item.payPeriod}</td><td>${item.daysWorked ?? item.hoursWorked ?? 0}</td><td>${money(item.dailyRate ?? item.hourlyRate ?? 0)}</td><td>${item.nightRunDrops ?? 0}</td><td>${money(item.dropRate ?? NIGHT_DROP_DEFAULT_RATE)}</td><td>${money((Number(item.nightRunDrops ?? 0) * NIGHT_DROP_DEFAULT_RATE))}</td><td>${money(item.driverBonus ?? 0)}</td><td>${money(item.deductions)}</td><td>${money(netPay(item))}</td><td>${item.paymentDate}</td><td>${item.autoPay ?? "No"}</td><td>${item.autoPayRef || "-"}</td><td>${auth.can("editPayslips") ? `<div class='table-actions'><button data-action='edit-pay' data-id='${item.id}'>Edit</button><button data-action='delete-pay' data-id='${item.id}'>Delete</button><button data-action='print-pay' data-id='${item.id}'>Print</button></div>` : "<span class='muted'>View only</span>"}</td></tr>`)
    .join("");
}

function refresh() {
  drawStats();
  drawPeriodTotalsDashboard();
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
    return;
  }

  if (action === "print-pay" && auth.can("viewPayslips")) {
    const item = state.pay.find((x) => x.id === id);
    if (!item) return;
    printPayslip(item);
  }
});

applyAccess();
document.getElementById("nightRunPay").value = "0.00";
document.getElementById("payTruckNumber").addEventListener("change", applyConfiguredRatesIfMatch);
document.getElementById("payTruckNumber").addEventListener("blur", applyConfiguredRatesIfMatch);
document.getElementById("nightRunDrops").addEventListener("input", updateNightRunPayPreview);
document.getElementById("nightRunDrops").addEventListener("change", updateNightRunPayPreview);
refresh();
void hydrateFinanceFromSupabase();
