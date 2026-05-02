function parseDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function keyOf(date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value, days) {
  const date = value instanceof Date ? new Date(value.getTime()) : parseDateOnly(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function weekStartByDay(value, weekStartDay) {
  const date = value instanceof Date ? new Date(value.getTime()) : parseDateOnly(value);
  if (!date) return null;
  while (date.getUTCDay() !== weekStartDay) {
    date.setUTCDate(date.getUTCDate() - 1);
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

function formatShortDate(value) {
  const date = value instanceof Date ? value : parseDateOnly(value);
  if (!date) return "Unknown";
  return date.toLocaleDateString("en-AU", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatWeekRange(start, end) {
  if (!start || !end) return "Unknown";
  return `${formatShortDate(start)} to ${formatShortDate(end)}`;
}

function formatDateTime(value, timeZone = "Australia/Sydney") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString("en-AU", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function payNetAmount(item) {
  const daysWorked = Number(item.daysWorked || 0);
  const dailyRate = Number(item.dailyRate || 0);
  const nightRunDrops = Number(item.nightRunDrops || 0);
  const bonus = Number(item.driverBonus || 0);
  const deductions = Number(item.deductions || 0);
  return (daysWorked * dailyRate) + (nightRunDrops * 90) + bonus - deductions;
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

function normalizeSupabaseData(rows) {
  return {
    income: (rows.income || []).map((row) => ({
      incomeDate: row.income_date || row.incomeDate || row.date || "",
      truckNumber: row.truck_number || row.truckNumber || "",
      jobRef: row.job_ref || row.jobRef || "",
      client: row.client || "",
      amount: Number(row.amount || 0),
      status: row.status || "",
      notes: row.notes || ""
    })),
    expense: (rows.expense || []).map((row) => ({
      expenseDate: row.expense_date || row.date || "",
      truckNumber: row.truck_number || row.truckNumber || "",
      category: row.category || "",
      amount: Number(row.amount || 0),
      vendor: row.vendor || "",
      notes: row.notes || ""
    })),
    pay: (rows.pay || []).map((row) => ({
      driver: row.driver || "",
      truckNumber: row.truck_number || row.truckNumber || "",
      payPeriod: row.pay_period || row.payPeriod || "",
      daysWorked: Number(row.days_worked ?? row.daysWorked ?? 0),
      dailyRate: Number(row.daily_rate ?? row.dailyRate ?? 0),
      nightRunDrops: Number(row.night_run_drops ?? row.nightRunDrops ?? 0),
      dropRate: Number(row.drop_rate ?? row.dropRate ?? 90),
      nightRunPay: Number(row.night_run_pay ?? row.nightRunPay ?? 0),
      driverBonus: Number(row.driver_bonus ?? row.driverBonus ?? 0),
      deductions: Number(row.deductions ?? 0),
      paymentDate: row.payment_date || row.paymentDate || "",
      periodStart: row.period_start || row.periodStart || "",
      periodEnd: row.period_end || row.periodEnd || ""
    })),
    roster: (rows.roster || []).map((row) => ({
      driverName: row.driver_name || row.driverName || "",
      truckNumber: row.truck_number || row.truckNumber || "",
      nightRun: String(row.run_type || row.runType || "").toLowerCase().includes("night"),
      shiftDate: row.shift_date || row.shiftDate || "",
      shiftTime: row.shift_time || row.shiftTime || "",
      route: row.route || "",
      status: row.status || ""
    })),
    drivers: (rows.drivers || []).map((row) => ({
      name: row.name || row.driver_name || row.driverName || "",
      phone: row.phone || "",
      email: row.email || "",
      licenseNumber: row.license_number || row.licenseNumber || "",
      licenseExpiry: row.license_expiry || row.licenseExpiry || "",
      status: row.status || ""
    })),
    trucks: (rows.trucks || []).map((row) => ({
      truckNumber: row.truck_number || row.truckNumber || "",
      registration: row.registration || "",
      model: row.model || "",
      capacity: Number(row.capacity || 0),
      serviceDueDate: row.service_due_date || row.serviceDueDate || "",
      regoExpiryDate: row.rego_expiry_date || row.regoExpiryDate || "",
      status: row.status || "",
      notes: row.notes || "",
      assignedDriver: row.assigned_driver || row.assignedDriver || ""
    }))
  };
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

  return Array.from(groups.keys()).sort().reverse().slice(0, 6).map((weekKeyValue) => {
    const item = groups.get(weekKeyValue) || { income: 0, expense: 0, pay: 0 };
    const start = parseDateOnly(weekKeyValue);
    const end = addDays(start, 6);
    return {
      weekKey: weekKeyValue,
      week: selectedFinanceWeekKey === weekKeyValue ? `${formatWeekRange(start, end)} (Selected)` : formatWeekRange(start, end),
      truckIncome: item.income,
      truckExpense: item.expense,
      driverPay: item.pay,
      profit: item.income - item.expense - item.pay
    };
  });
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
      plannedShifts: driverRows.filter((row) => String(row.status || "").trim().toLowerCase() !== "leave").length,
      completed: driverRows.filter((row) => String(row.status || "").trim().toLowerCase() === "completed").length,
      leaveDays: driverRows.filter((row) => String(row.status || "").trim().toLowerCase() === "leave").length,
      nightRuns: driverRows.filter((row) => row.nightRun).length,
      primaryTruck: primaryTrucks.get(name) || "-"
    };
  });
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

function buildSnapshot(data, financeWeekKeyValue, rosterWeekKeyValue, mode = "server", preparedAt = new Date()) {
  const financeRows = collectFinanceReportRows(data, financeWeekKeyValue);
  const driverRows = collectDriverReportRows(data, rosterWeekKeyValue);
  const financeCurrent = financeRows.find((row) => row.weekKey === financeWeekKeyValue) || financeRows[0] || null;
  const financeStart = parseDateOnly(financeWeekKeyValue);
  const rosterStart = parseDateOnly(rosterWeekKeyValue);

  return {
    id: `weekly-report-${financeWeekKeyValue}`,
    preparedAt: preparedAt.toISOString(),
    mode,
    runKey: financeWeekKeyValue,
    financeWeekKey: financeWeekKeyValue,
    rosterWeekKey: rosterWeekKeyValue,
    financeWeekLabel: financeCurrent?.week || formatWeekRange(financeStart, addDays(financeStart, 6)),
    rosterWeekLabel: formatWeekRange(rosterStart, addDays(rosterStart, 6)),
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

function getSydneyDateParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday || "",
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0)
  };
}

function getSydneyScheduleState(now = new Date()) {
  const parts = getSydneyDateParts(now);
  const todayKey = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const weekdayByShort = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };
  const weekdayIndex = weekdayByShort[parts.weekday] ?? -1;

  return {
    timezone: "Australia/Sydney",
    todayKey,
    weekdayIndex,
    weekdayLabel: parts.weekday,
    hour: parts.hour,
    minute: parts.minute,
    financeWeekKey: financeWeekKey(todayKey),
    rosterWeekKey: rosterWeekKey(todayKey),
    shouldSendNow: weekdayIndex === 4 && parts.hour >= 8
  };
}

module.exports = {
  addDays,
  buildReportAttachmentHtml,
  buildSnapshot,
  collectDriverReportRows,
  collectFinanceReportRows,
  collectTruckReportRows,
  formatDateTime,
  formatWeekRange,
  getSydneyScheduleState,
  normalizeSupabaseData,
  parseDateOnly
};
