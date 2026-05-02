const auth = window.OPXAuth?.requireAuth("./login.html");
if (!auth) {
  throw new Error("Authentication required");
}

if (!auth.can("accessCRM") && !auth.can("accessLogs") && !auth.can("accessControlPanel")) {
  document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>No page access assigned to this user.</p></section></main>";
  throw new Error("No page access");
}

const links = [
  { label: "Reports Page", href: "./reports.html", show: auth.can("accessCRM") && auth.can("viewReports") },
  { label: "Drivers Page", href: "./drivers.html", show: auth.can("accessCRM") && auth.can("viewDrivers") },
  { label: "Trucks Page", href: "./trucks.html", show: auth.can("accessCRM") && auth.can("viewTrucks") },
  { label: "Weekly Roster Page", href: "./roster.html", show: auth.can("accessCRM") && auth.can("viewRoster") },
  { label: "Finance & Pay Page", href: "./finance.html", show: auth.can("accessCRM") && (auth.can("viewTruckIncome") || auth.can("viewSpending") || auth.can("viewPayslips") || auth.can("viewStats")) },
  { label: "Log Page", href: "./log.html", show: auth.can("accessLogs") },
  { label: "Control Panel", href: "./control-panel.html", show: auth.can("accessControlPanel") }
];

const state = {
  logCount: readCount("transport_crm_logs")
};
const currentRole = window.OPXAuth.getRoleById?.(auth.user.roleId) || null;

const CLOSE_REGO_WINDOW_DAYS = 14;
const CLOSE_LICENSE_WINDOW_DAYS = 30;
const TARGET_DRIVERS = 7;
const TARGET_WEEKDAYS = 5;
const ROSTER_ACK_KEY = "transport_crm_roster_ack";
const ROSTER_WEEK_STATUS_KEY = "transport_crm_roster_week_status";
const INCOME_KEY = "transport_crm_truck_income";
const EXPENSE_KEY = "transport_crm_spending";
const PAY_KEY = "transport_crm_payslips";
const NIGHT_DROP_DEFAULT_RATE = 90;

function dashboardRoleProfile() {
  const roleName = String(currentRole?.name || "").trim().toLowerCase();
  const hasRosterOps = auth.can("viewRoster") || auth.can("editRoster");
  const hasFinanceOps = auth.can("viewTruckIncome") || auth.can("viewSpending") || auth.can("viewPayslips");

  if (auth.can("accessControlPanel") || /admin|gm|general manager|ops manager/.test(roleName)) {
    return {
      eyebrow: "Operations Hub",
      title: "Onpoint Express",
      panels: {
        managerSummary: true,
        attention: true,
        reminders: true,
        weekSnapshot: true,
        todayFocus: true,
        performanceCharts: true,
        quickActions: true,
        globalSearch: true,
        recentActivity: true,
        readinessChecks: true,
        payrollReadiness: true
      }
    };
  }

  if (/finance|payroll/.test(roleName) || (!hasRosterOps && hasFinanceOps)) {
    return {
      eyebrow: "Finance Desk",
      title: "Onpoint Express Finance",
      panels: {
        managerSummary: true,
        attention: true,
        reminders: true,
        weekSnapshot: false,
        todayFocus: false,
        performanceCharts: true,
        quickActions: true,
        globalSearch: true,
        recentActivity: true,
        readinessChecks: true,
        payrollReadiness: true
      }
    };
  }

  if (/dispatch|team/.test(roleName) || (hasRosterOps && !hasFinanceOps)) {
    return {
      eyebrow: "Dispatch Desk",
      title: "Onpoint Express Dispatch",
      panels: {
        managerSummary: true,
        attention: true,
        reminders: true,
        weekSnapshot: true,
        todayFocus: true,
        performanceCharts: true,
        quickActions: true,
        globalSearch: true,
        recentActivity: true,
        readinessChecks: true,
        payrollReadiness: false
      }
    };
  }

  return {
    eyebrow: "Operations Hub",
    title: "Onpoint Express",
      panels: {
        managerSummary: true,
        attention: true,
        reminders: true,
        weekSnapshot: hasRosterOps,
        todayFocus: hasRosterOps,
        performanceCharts: hasRosterOps || hasFinanceOps,
        quickActions: true,
        globalSearch: true,
        recentActivity: true,
        readinessChecks: true,
        payrollReadiness: hasFinanceOps
    }
  };
}

function setPanelVisibility(id, visible) {
  const panel = document.getElementById(id);
  if (!panel) return;
  panel.style.display = visible ? "block" : "none";
}

function applyRoleDashboardProfile() {
  const profile = dashboardRoleProfile();
  const eyebrow = document.querySelector(".topbar .eyebrow");
  const title = document.querySelector(".topbar h1");
  if (eyebrow) eyebrow.textContent = profile.eyebrow;
  if (title) title.textContent = profile.title;

  setPanelVisibility("managerSummaryPanel", profile.panels.managerSummary);
  setPanelVisibility("attentionPanel", profile.panels.attention);
  setPanelVisibility("reminderCenterPanel", profile.panels.reminders);
  setPanelVisibility("weekSnapshotPanel", profile.panels.weekSnapshot);
  setPanelVisibility("todayFocusPanel", profile.panels.todayFocus);
  setPanelVisibility("performanceChartsPanel", profile.panels.performanceCharts);
  setPanelVisibility("quickActionsPanel", profile.panels.quickActions);
  setPanelVisibility("globalSearchPanel", profile.panels.globalSearch);
  setPanelVisibility("recentActivityPanel", profile.panels.recentActivity);
  setPanelVisibility("readinessChecksPanel", profile.panels.readinessChecks);
  setPanelVisibility("payrollReadinessPanel", profile.panels.payrollReadiness);
}

function readCount(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]").length;
  } catch {
    return 0;
  }
}

function drawStats() {
  const stats = [
    { label: "Drivers", value: String(readCount("transport_crm_drivers")) },
    { label: "Trucks", value: String(readCount("transport_crm_trucks")) },
    { label: "Roster Shifts", value: String(readCount("transport_crm_roster")) },
    { label: "Income Rows", value: String(readCount("transport_crm_truck_income")) },
    { label: "Payslips", value: String(readCount("transport_crm_payslips")) },
    { label: "Logs", value: String(state.logCount) },
    { label: "Users", value: String(window.OPXAuth.getUsers().length) }
  ];

  document.getElementById("homeStats").innerHTML = stats
    .map((s) => `<article class="stat-card"><p>${s.label}</p><h3>${s.value}</h3></article>`)
    .join("");
}

function formatSummaryTime(value) {
  if (!value) return "No recent sync event yet.";
  return new Date(value).toLocaleString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    day: "2-digit",
    month: "short"
  });
}

function formatActivityTime(value) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  });
}

function readRows(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readObject(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function keyOf(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mondayOf(date = new Date()) {
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  const day = monday.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + offset);
  return monday;
}

function formatDisplayDate(value) {
  return value.toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short"
  });
}

function formatDisplayDateLong(value) {
  return value.toLocaleDateString("en-AU", {
    weekday: "long",
    day: "2-digit",
    month: "short"
  });
}

function weekKeysForCurrentWeek() {
  const monday = mondayOf(new Date());
  return Array.from({ length: 7 }, (_, index) => {
    const next = new Date(monday);
    next.setDate(monday.getDate() + index);
    return keyOf(next);
  });
}

function currentWeekRangeLabel() {
  const monday = mondayOf(new Date());
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return `${formatDisplayDate(monday)} - ${formatDisplayDate(sunday)}`;
}

function currentWeekStartKey() {
  return keyOf(mondayOf(new Date()));
}

function currentPayRunDate() {
  const thursday = mondayOf(new Date());
  thursday.setDate(thursday.getDate() + 3);
  return thursday;
}

function currentPayPeriodLabel() {
  const monday = mondayOf(new Date());
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return `${formatDisplayDate(monday)} - ${formatDisplayDate(sunday)}`;
}

function weekStartByDay(dateValue, weekStartDay) {
  const baseDate = dateValue instanceof Date ? new Date(dateValue) : parseDateOnly(dateValue);
  if (!baseDate || Number.isNaN(baseDate.getTime())) return null;
  const start = new Date(baseDate);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const shift = (day - weekStartDay + 7) % 7;
  start.setDate(start.getDate() - shift);
  return start;
}

function financeWeekKey(value) {
  const start = weekStartByDay(value, 4);
  return start ? keyOf(start) : "";
}

function moneyCompact(value) {
  const amount = Number(value || 0);
  const abs = Math.abs(amount);
  if (abs >= 1000000) return `$${(amount / 1000000).toFixed(1)}m`;
  if (abs >= 1000) return `$${(amount / 1000).toFixed(1)}k`;
  return `$${amount.toFixed(0)}`;
}

function payNetAmount(item) {
  if (item?.netPay != null && item.netPay !== "") return Number(item.netPay || 0);
  const daysWorked = Number(item?.daysWorked ?? item?.hoursWorked ?? 0);
  const dailyRate = Number(item?.dailyRate ?? item?.hourlyRate ?? 0);
  const nightRunDrops = Number(item?.nightRunDrops ?? 0);
  const driverBonus = Number(item?.driverBonus ?? 0);
  const deductions = Number(item?.deductions ?? 0);
  return daysWorked * dailyRate + (nightRunDrops * NIGHT_DROP_DEFAULT_RATE) + driverBonus - deductions;
}

function rollingWeekKeys(count = 6) {
  const keys = [];
  const currentFinanceStart = weekStartByDay(new Date(), 4);
  for (let index = count - 1; index >= 0; index -= 1) {
    const next = new Date(currentFinanceStart);
    next.setDate(currentFinanceStart.getDate() - (index * 7));
    keys.push(keyOf(next));
  }
  return keys;
}

function shortWeekLabel(weekKey) {
  const start = parseDateOnly(weekKey);
  if (!start) return weekKey;
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${start.toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}-${end.toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}`;
}

function todayKey() {
  return keyOf(new Date());
}

function daysUntil(value) {
  const target = parseDateOnly(value);
  if (!target) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function attentionCards() {
  const summary = window.OPXAuth.getSyncDashboardSummary?.();
  const rosterRows = readRows("transport_crm_roster");
  const truckRows = readRows("transport_crm_trucks");
  const weekSet = new Set(weekKeysForCurrentWeek());

  const leaveRows = rosterRows.filter((row) => weekSet.has(String(row.shiftDate || "")) && String(row.status || "").trim() === "Leave");
  const leaveDrivers = [...new Set(leaveRows.map((row) => String(row.driverName || "").trim()).filter(Boolean))];

  const regoAlerts = truckRows
    .map((truck) => ({ truck, days: daysUntil(truck.regoExpiryDate) }))
    .filter((entry) => entry.days != null && entry.days <= CLOSE_REGO_WINDOW_DAYS)
    .sort((a, b) => a.days - b.days);

  const cards = [];

  if (summary && (summary.queueCount || summary.health?.tone === "offline" || summary.health?.tone === "queue")) {
    cards.push({
      tone: summary.health?.tone === "offline" ? "offline" : "queue",
      label: "Sync Attention",
      title: summary.health?.tone === "offline" ? "CRM is offline" : `${summary.queueCount} page${summary.queueCount === 1 ? "" : "s"} waiting to sync`,
      meta: summary.latest?.message || "Saved changes are queued and retrying automatically.",
      href: "./control-panel.html"
    });
  }

  if (leaveDrivers.length) {
    cards.push({
      tone: "leave",
      label: "Leave This Week",
      title: `${leaveDrivers.length} driver${leaveDrivers.length === 1 ? "" : "s"} on leave`,
      meta: leaveDrivers.join(", "),
      href: "./roster.html"
    });
  }

  if (regoAlerts.length) {
    const nextTruck = regoAlerts[0];
    const regoTitle = nextTruck.days < 0
      ? `${regoAlerts.length} truck${regoAlerts.length === 1 ? "" : "s"} overdue`
      : `${regoAlerts.length} truck${regoAlerts.length === 1 ? "" : "s"} close to rego expiry`;
    const regoMeta = nextTruck.days < 0
      ? `Truck ${nextTruck.truck.truckNumber || "-"} expired ${Math.abs(nextTruck.days)} day${Math.abs(nextTruck.days) === 1 ? "" : "s"} ago`
      : `Truck ${nextTruck.truck.truckNumber || "-"} expires in ${nextTruck.days} day${nextTruck.days === 1 ? "" : "s"}`;
    cards.push({
      tone: nextTruck.days < 0 ? "offline" : "warning",
      label: "Close Rego Expiry",
      title: regoTitle,
      meta: regoMeta,
      href: "./trucks.html"
    });
  }

  if (!cards.length) {
    cards.push({
      tone: "live",
      label: "All Clear",
      title: "No urgent operational issues",
      meta: "Sync, leave, and rego checks look healthy right now.",
      href: "./index.html"
    });
  }

  return cards.slice(0, 4);
}

function weekSnapshotItems() {
  const rosterRows = readRows("transport_crm_roster");
  const weekSet = new Set(weekKeysForCurrentWeek());
  const weekRows = rosterRows.filter((row) => weekSet.has(String(row.shiftDate || "")));
  const nonLeaveRows = weekRows.filter((row) => String(row.status || "").trim() !== "Leave");
  const completedRows = weekRows.filter((row) => String(row.status || "").trim() === "Completed");
  const leaveRows = weekRows.filter((row) => String(row.status || "").trim() === "Leave");
  const driversPlanned = new Set(nonLeaveRows.map((row) => String(row.driverName || "").trim()).filter(Boolean)).size;
  const trucksUsed = new Set(nonLeaveRows.map((row) => String(row.truckNumber || "").trim()).filter(Boolean)).size;
  const nightRuns = weekRows.filter((row) => Boolean(row.nightRun)).length;
  const workingDaysCovered = new Set(
    nonLeaveRows
      .filter((row) => {
        const date = parseDateOnly(row.shiftDate);
        return date && date.getDay() >= 1 && date.getDay() <= 5;
      })
      .map((row) => String(row.shiftDate || "").trim())
  ).size;

  return [
    {
      label: "Drivers Planned",
      value: `${driversPlanned}/${TARGET_DRIVERS}`,
      tone: driversPlanned >= TARGET_DRIVERS ? "live" : driversPlanned >= Math.max(1, TARGET_DRIVERS - 1) ? "queue" : "warning"
    },
    {
      label: "Working Days Covered",
      value: `${workingDaysCovered}/${TARGET_WEEKDAYS}`,
      tone: workingDaysCovered >= TARGET_WEEKDAYS ? "live" : "queue"
    },
    {
      label: "Completed Shifts",
      value: String(completedRows.length),
      tone: completedRows.length ? "live" : "neutral"
    },
    {
      label: "Leave Days",
      value: String(leaveRows.length),
      tone: leaveRows.length ? "warning" : "live"
    },
    {
      label: "Night Runs",
      value: String(nightRuns),
      tone: nightRuns ? "queue" : "neutral"
    },
    {
      label: "Trucks Used",
      value: String(trucksUsed),
      tone: trucksUsed >= Math.max(1, driversPlanned - 1) ? "live" : "neutral"
    }
  ];
}

function todayFocusCards() {
  const rosterRows = readRows("transport_crm_roster");
  const truckRows = readRows("transport_crm_trucks");
  const today = todayKey();
  const todayRows = rosterRows.filter((row) => String(row.shiftDate || "").trim() === today);
  const activeRows = todayRows.filter((row) => String(row.status || "").trim() !== "Leave");
  const leaveRows = todayRows.filter((row) => String(row.status || "").trim() === "Leave");
  const completedRows = todayRows.filter((row) => String(row.status || "").trim() === "Completed");
  const nightRunRows = todayRows.filter((row) => Boolean(row.nightRun));
  const activeDrivers = [...new Set(activeRows.map((row) => String(row.driverName || "").trim()).filter(Boolean))];
  const leaveDrivers = [...new Set(leaveRows.map((row) => String(row.driverName || "").trim()).filter(Boolean))];
  const urgentTrucks = truckRows
    .map((truck) => ({ truck, days: daysUntil(truck.regoExpiryDate) }))
    .filter((entry) => entry.days != null && entry.days <= 7)
    .sort((a, b) => a.days - b.days);

  const cards = [
    {
      tone: activeDrivers.length ? "live" : "neutral",
      label: "Drivers On Today",
      title: `${activeDrivers.length} driver${activeDrivers.length === 1 ? "" : "s"} scheduled`,
      meta: activeDrivers.length ? activeDrivers.join(", ") : "No scheduled drivers for today yet.",
      href: "./roster.html"
    },
    {
      tone: leaveDrivers.length ? "leave" : "live",
      label: "Leave Today",
      title: `${leaveDrivers.length} driver${leaveDrivers.length === 1 ? "" : "s"} away`,
      meta: leaveDrivers.length ? leaveDrivers.join(", ") : "No leave recorded for today.",
      href: "./roster.html"
    },
    {
      tone: completedRows.length ? "queue" : "neutral",
      label: "Completed Today",
      title: `${completedRows.length} shift${completedRows.length === 1 ? "" : "s"} marked completed`,
      meta: nightRunRows.length
        ? `${nightRunRows.length} night run${nightRunRows.length === 1 ? "" : "s"} included today.`
        : "No night runs recorded today.",
      href: "./finance.html"
    }
  ];

  if (urgentTrucks.length) {
    const nextTruck = urgentTrucks[0];
    cards.push({
      tone: nextTruck.days < 0 ? "offline" : "warning",
      label: "Truck Attention",
      title: nextTruck.days < 0 ? "Rego already overdue" : "Rego due very soon",
      meta: nextTruck.days < 0
        ? `Truck ${nextTruck.truck.truckNumber || "-"} expired ${Math.abs(nextTruck.days)} day${Math.abs(nextTruck.days) === 1 ? "" : "s"} ago.`
        : `Truck ${nextTruck.truck.truckNumber || "-"} expires in ${nextTruck.days} day${nextTruck.days === 1 ? "" : "s"}.`,
      href: "./trucks.html"
    });
  } else {
    cards.push({
      tone: "live",
      label: "Truck Attention",
      title: "No truck expiry urgency today",
      meta: "No truck registrations are due within the next 7 days.",
      href: "./trucks.html"
    });
  }

  return cards;
}

function drawManagerSummary() {
  const summary = window.OPXAuth.getSyncDashboardSummary?.();
  if (!summary) return;

  const grid = document.getElementById("managerSummaryGrid");
  const latestTitle = document.getElementById("managerSummaryLatestTitle");
  const latestMeta = document.getElementById("managerSummaryLatestMeta");

  const items = [
    {
      label: "CRM Health",
      value: summary.health.label,
      tone: summary.health.tone
    },
    {
      label: "Queued Pages",
      value: String(summary.queueCount),
      tone: summary.queueCount ? "queue" : "live"
    },
    {
      label: "Shared Login",
      value: String(summary.sharedAuthStatus || "Not checked yet."),
      tone: String(summary.sharedAuthStatus || "").toLowerCase().includes("failed") ? "offline" : "neutral"
    }
  ];

  grid.innerHTML = items.map((item) => `
    <article class="stat-card manager-summary-card manager-summary-card-${item.tone}">
      <p>${item.label}</p>
      <h3>${item.value}</h3>
    </article>
  `).join("");

  if (!summary.latest) {
    latestTitle.textContent = "Waiting for activity";
    latestMeta.textContent = "Recent sync activity will appear here.";
    return;
  }

  latestTitle.textContent = `${summary.latest.source}: ${summary.latest.message}`;
  latestMeta.textContent = `${formatSummaryTime(summary.latest.at)} | ${summary.latest.tone}`;
}

function drawLinks() {
  const visible = links.filter((x) => x.show);
  const container = document.getElementById("quickLinks");

  if (!visible.length) {
    container.innerHTML = "<p class='muted'>No pages available for your role.</p>";
    return;
  }

  container.innerHTML = visible
    .map((item) => `<a class="quick-link-card" href="${item.href}">${item.label}</a>`)
    .join("");
}

function drawAttentionStrip() {
  const container = document.getElementById("attentionGrid");
  if (!container) return;
  const cards = attentionCards();
  container.innerHTML = cards.map((item) => `
    <a class="attention-card attention-card-${item.tone}" href="${item.href}">
      <p>${item.label}</p>
      <h3>${item.title}</h3>
      <span>${item.meta}</span>
    </a>
  `).join("");
}

function drawWeekSnapshot() {
  const range = document.getElementById("weekSnapshotRange");
  const meta = document.getElementById("weekSnapshotMeta");
  const grid = document.getElementById("weekSnapshotGrid");
  if (!range || !meta || !grid) return;

  const items = weekSnapshotItems();
  range.textContent = currentWeekRangeLabel();
  meta.textContent = "Live roster totals for the current Monday to Sunday window.";
  grid.innerHTML = items.map((item) => `
    <article class="stat-card manager-summary-card manager-summary-card-${item.tone}">
      <p>${item.label}</p>
      <h3>${item.value}</h3>
    </article>
  `).join("");
}

function drawTodayFocus() {
  const dateNode = document.getElementById("todayFocusDate");
  const metaNode = document.getElementById("todayFocusMeta");
  const grid = document.getElementById("todayFocusGrid");
  if (!dateNode || !metaNode || !grid) return;

  dateNode.textContent = formatDisplayDateLong(new Date());
  metaNode.textContent = "Live roster and truck checks for today.";
  const cards = todayFocusCards();
  grid.innerHTML = cards.map((item) => `
    <a class="attention-card attention-card-${item.tone}" href="${item.href}">
      <p>${item.label}</p>
      <h3>${item.title}</h3>
      <span>${item.meta}</span>
    </a>
  `).join("");
}

function quickActions() {
  return [
    {
      label: "Roster",
      title: "Add Shift",
      meta: "Open the Add Shift form to assign or update today’s runs.",
      href: "./roster.html",
      show: auth.can("accessCRM") && auth.can("viewRoster") && auth.can("editRoster"),
      tone: "live"
    },
    {
      label: "Roster",
      title: "Mark Leave",
      meta: "Jump into the roster page and mark a driver away for the selected date.",
      href: "./roster.html",
      show: auth.can("accessCRM") && auth.can("viewRoster") && auth.can("editRoster"),
      tone: "leave"
    },
    {
      label: "Finance",
      title: "Add Truck Expense",
      meta: "Record a new spend item straight from the Finance page.",
      href: "./finance.html",
      show: auth.can("accessCRM") && auth.can("viewSpending") && auth.can("editSpending"),
      tone: "warning"
    },
    {
      label: "Finance",
      title: "Generate Driver Pay",
      meta: "Open Driver Pay and generate the latest week from completed roster shifts.",
      href: "./finance.html",
      show: auth.can("accessCRM") && auth.can("viewPayslips") && auth.can("editPayslips"),
      tone: "queue"
    }
  ].filter((item) => item.show);
}

function recentActivityItems() {
  const items = [];
  const syncHistory = window.OPXAuth.getSyncHistory?.() || [];
  const auditEntries = auth.can("accessControlPanel") ? (window.OPXAuth.getAuditEntries?.() || []) : [];
  const logRows = auth.can("accessLogs") ? readRows("transport_crm_logs") : [];

  syncHistory.slice(0, 4).forEach((entry) => {
    items.push({
      id: `sync-${entry.at}-${entry.source}`,
      tone: entry.tone || "neutral",
      label: entry.source || "Sync",
      title: entry.message || "Sync status updated",
      meta: formatActivityTime(entry.at),
      href: "./index.html",
      at: entry.at || ""
    });
  });

  auditEntries.slice(0, 6).forEach((entry) => {
    items.push({
      id: entry.id || `audit-${entry.at}`,
      tone: entry.area === "auth" ? "queue" : "neutral",
      label: `${entry.actorUsername || "System"} • ${entry.area || "control-panel"}`,
      title: entry.summary || "Activity recorded",
      meta: formatActivityTime(entry.at),
      href: "./control-panel.html",
      at: entry.at || ""
    });
  });

  logRows.slice(0, 6).forEach((entry) => {
    items.push({
      id: entry.id || `log-${entry.logDate}-${entry.reference || ""}`,
      tone: String(entry.status || "").trim() === "Open" ? "warning" : "live",
      label: `${entry.logType || "Log"}${entry.driver ? ` • ${entry.driver}` : ""}`,
      title: entry.description || entry.reference || "Log entry updated",
      meta: formatActivityTime(entry.updatedAt || entry.logDate),
      href: "./log.html",
      at: entry.updatedAt || entry.logDate || ""
    });
  });

  return items
    .filter((item) => item.title)
    .sort((a, b) => {
      const aTime = Date.parse(a.at || "") || 0;
      const bTime = Date.parse(b.at || "") || 0;
      return bTime - aTime;
    })
    .slice(0, 8);
}

function readinessCheckCards() {
  const drivers = readRows("transport_crm_drivers")
    .filter((driver) => String(driver.status || "").trim().toLowerCase() !== "inactive");
  const trucks = readRows("transport_crm_trucks")
    .filter((truck) => String(truck.status || "").trim().toLowerCase() !== "under repair");

  const driversMissingContact = drivers.filter((driver) => {
    const phone = String(driver.phone || "").trim();
    const email = String(driver.email || "").trim();
    return !phone || !email;
  });

  const licenceAlerts = drivers
    .map((driver) => ({ driver, days: daysUntil(driver.licenseExpiry) }))
    .filter((entry) => entry.days != null && entry.days <= CLOSE_LICENSE_WINDOW_DAYS)
    .sort((a, b) => a.days - b.days);

  const trucksMissingDates = trucks.filter((truck) => !String(truck.regoExpiryDate || "").trim() || !String(truck.serviceDueDate || "").trim());

  const cards = [];

  cards.push({
    tone: driversMissingContact.length ? "warning" : "live",
    label: "Driver Contacts",
    title: driversMissingContact.length
      ? `${driversMissingContact.length} driver${driversMissingContact.length === 1 ? "" : "s"} missing phone or email`
      : "All active drivers have contact details",
    meta: driversMissingContact.length
      ? driversMissingContact.slice(0, 3).map((driver) => driver.name).join(", ")
      : "WhatsApp, SMS, and email dispatch are ready.",
    href: "./drivers.html"
  });

  if (licenceAlerts.length) {
    const nextDriver = licenceAlerts[0];
    cards.push({
      tone: nextDriver.days < 0 ? "offline" : "warning",
      label: "Licence Expiry",
      title: nextDriver.days < 0 ? "Driver licence overdue" : "Driver licence expiring soon",
      meta: nextDriver.days < 0
        ? `${nextDriver.driver.name} expired ${Math.abs(nextDriver.days)} day${Math.abs(nextDriver.days) === 1 ? "" : "s"} ago.`
        : `${nextDriver.driver.name} expires in ${nextDriver.days} day${nextDriver.days === 1 ? "" : "s"}.`,
      href: "./drivers.html"
    });
  } else {
    cards.push({
      tone: "live",
      label: "Licence Expiry",
      title: "No driver licences due soon",
      meta: `No active driver licence expires within ${CLOSE_LICENSE_WINDOW_DAYS} days.`,
      href: "./drivers.html"
    });
  }

  cards.push({
    tone: trucksMissingDates.length ? "warning" : "live",
    label: "Truck Dates",
    title: trucksMissingDates.length
      ? `${trucksMissingDates.length} truck${trucksMissingDates.length === 1 ? "" : "s"} missing rego or service dates`
      : "All active trucks have key dates",
    meta: trucksMissingDates.length
      ? trucksMissingDates.slice(0, 3).map((truck) => truck.truckNumber || truck.registration || "Unknown truck").join(", ")
      : "Rego and service planning data is filled in.",
    href: "./trucks.html"
  });

  return cards;
}

function payrollReadinessCards() {
  const rosterRows = readRows("transport_crm_roster");
  const payRows = readRows("transport_crm_payslips");
  const weekStartKey = currentWeekStartKey();
  const payPeriod = currentPayPeriodLabel();
  const currentWeekRows = rosterRows.filter((row) => {
    const shiftDate = parseDateOnly(row.shiftDate);
    return shiftDate && keyOf(mondayOf(shiftDate)) === weekStartKey;
  });
  const completedRows = currentWeekRows.filter((row) => String(row.status || "").trim() === "Completed");
  const completedDrivers = [...new Set(completedRows.map((row) => String(row.driverName || "").trim()).filter(Boolean))];
  const payRowsForPeriod = payRows.filter((row) => String(row.payPeriod || "").trim() === payPeriod);
  const generatedDrivers = [...new Set(payRowsForPeriod.map((row) => String(row.driver || "").trim()).filter(Boolean))];
  const missingDrivers = completedDrivers.filter((name) => !generatedDrivers.includes(name));

  return [
    {
      tone: "queue",
      label: "Pay Run Date",
      title: formatDisplayDateLong(currentPayRunDate()),
      meta: `Payroll for period ${payPeriod}.`,
      href: "./finance.html"
    },
    {
      tone: completedDrivers.length ? "live" : "neutral",
      label: "Drivers Ready",
      title: `${completedDrivers.length} driver${completedDrivers.length === 1 ? "" : "s"} with completed work`,
      meta: completedDrivers.length ? completedDrivers.join(", ") : "No completed roster work for this week yet.",
      href: "./roster.html"
    },
    {
      tone: missingDrivers.length ? "warning" : generatedDrivers.length ? "live" : "neutral",
      label: "Payslips Generated",
      title: `${generatedDrivers.length}/${completedDrivers.length || 0} ready for pay`,
      meta: missingDrivers.length
        ? `Still missing: ${missingDrivers.slice(0, 3).join(", ")}${missingDrivers.length > 3 ? "..." : ""}`
        : generatedDrivers.length
          ? "All completed drivers have a payslip for this pay period."
          : "No payslips generated for this pay period yet.",
      href: "./finance.html"
    }
  ];
}

function reminderCenterCards() {
  const rosterRows = readRows("transport_crm_roster");
  const payslips = readRows("transport_crm_payslips");
  const weekKey = currentWeekStartKey();
  const ackStore = readObject(ROSTER_ACK_KEY);
  const workflowStore = readObject(ROSTER_WEEK_STATUS_KEY);
  const workflow = workflowStore[weekKey] || {};
  const weekRows = rosterRows.filter((row) => {
    const shiftDate = parseDateOnly(row.shiftDate);
    return shiftDate && keyOf(mondayOf(shiftDate)) === weekKey;
  });
  const driverNames = [...new Set(weekRows.map((row) => String(row.driverName || "").trim()).filter(Boolean))];
  const ackEntries = driverNames.map((driverName) => ackStore[`${weekKey}__${driverName}`]?.status || "pending");
  const pendingAckCount = ackEntries.filter((status) => status !== "confirmed").length;
  const completedDrivers = [...new Set(weekRows.filter((row) => String(row.status || "").trim() === "Completed").map((row) => String(row.driverName || "").trim()).filter(Boolean))];
  const payPeriod = currentPayPeriodLabel();
  const generatedDrivers = [...new Set(payslips.filter((row) => String(row.payPeriod || "").trim() === payPeriod).map((row) => String(row.driver || "").trim()).filter(Boolean))];
  const missingPayDrivers = completedDrivers.filter((driverName) => !generatedDrivers.includes(driverName));
  const today = new Date();
  const todayDay = today.getDay();
  const cards = [];

  cards.push({
    tone: workflow.status === "sent" ? "live" : workflow.status === "approved" ? "queue" : "warning",
    label: "Week Approval",
    title: workflow.status === "sent"
      ? "This week has been sent to drivers"
      : workflow.status === "approved"
        ? "This week is approved and ready to send"
        : "This week is still in draft",
    meta: workflow.updatedAt
      ? `Updated ${formatActivityTime(workflow.updatedAt)} by ${workflow.updatedBy || "System"}`
      : "Open Roster to approve or send the current week.",
    href: "./roster.html"
  });

  cards.push({
    tone: pendingAckCount ? "warning" : "live",
    label: "Driver Confirmations",
    title: pendingAckCount
      ? `${pendingAckCount} driver${pendingAckCount === 1 ? "" : "s"} still need confirmation`
      : "All dispatched drivers are confirmed",
    meta: driverNames.length
      ? `${driverNames.length - pendingAckCount}/${driverNames.length} drivers fully confirmed for ${weekKey}.`
      : "No driver week view loaded for the current week yet.",
    href: "./roster.html"
  });

  cards.push({
    tone: todayDay === 4 && missingPayDrivers.length ? "warning" : missingPayDrivers.length ? "queue" : "live",
    label: "Payroll Reminder",
    title: todayDay === 4
      ? "Thursday payroll check"
      : `Next pay run ${formatDisplayDate(currentPayRunDate())}`,
    meta: missingPayDrivers.length
      ? `Still missing payslips for: ${missingPayDrivers.slice(0, 3).join(", ")}${missingPayDrivers.length > 3 ? "..." : ""}`
      : "Completed roster work is covered by current payslips.",
    href: "./finance.html"
  });

  return cards;
}

function buildPerformanceChartSeries() {
  const weekKeys = rollingWeekKeys(6);
  const incomeRows = readRows(INCOME_KEY);
  const expenseRows = readRows(EXPENSE_KEY);
  const payRows = readRows(PAY_KEY);
  const rosterRows = readRows("transport_crm_roster");
  const incomeMap = new Map(weekKeys.map((week) => [week, 0]));
  const expenseMap = new Map(weekKeys.map((week) => [week, 0]));
  const payMap = new Map(weekKeys.map((week) => [week, 0]));
  const completedMap = new Map(weekKeys.map((week) => [week, 0]));

  incomeRows.forEach((item) => {
    const week = financeWeekKey(item.incomeDate);
    if (incomeMap.has(week)) incomeMap.set(week, incomeMap.get(week) + Number(item.amount || 0));
  });

  expenseRows.forEach((item) => {
    const week = financeWeekKey(item.date);
    if (expenseMap.has(week)) expenseMap.set(week, expenseMap.get(week) + Number(item.amount || 0));
  });

  payRows.forEach((item) => {
    const week = financeWeekKey(item.paymentDate);
    if (payMap.has(week)) payMap.set(week, payMap.get(week) + payNetAmount(item));
  });

  rosterRows.forEach((item) => {
    if (String(item.status || "").trim() !== "Completed") return;
    const week = financeWeekKey(item.shiftDate);
    if (completedMap.has(week)) completedMap.set(week, completedMap.get(week) + 1);
  });

  return [
    {
      id: "income",
      tone: "live",
      label: "Truck Income",
      meta: "Last 6 Thursday batches",
      href: "./finance.html",
      values: weekKeys.map((week) => ({ week, value: incomeMap.get(week) || 0 }))
    },
    {
      id: "expense",
      tone: "warning",
      label: "Truck Expense",
      meta: "Last 6 Thursday weeks",
      href: "./finance.html",
      values: weekKeys.map((week) => ({ week, value: expenseMap.get(week) || 0 }))
    },
    {
      id: "pay",
      tone: "queue",
      label: "Driver Pay",
      meta: "Last 6 pay runs",
      href: "./finance.html",
      values: weekKeys.map((week) => ({ week, value: payMap.get(week) || 0 }))
    },
    {
      id: "completed",
      tone: "neutral",
      label: "Completed Shifts",
      meta: "Last 6 finance weeks",
      href: "./roster.html",
      values: weekKeys.map((week) => ({ week, value: completedMap.get(week) || 0 }))
    }
  ];
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

function drawPerformanceCharts() {
  const panel = document.getElementById("performanceChartsPanel");
  const grid = document.getElementById("performanceChartsGrid");
  if (!panel || !grid) return;

  const canShow = auth.can("accessCRM") && (
    auth.can("viewTruckIncome") ||
    auth.can("viewSpending") ||
    auth.can("viewPayslips") ||
    auth.can("viewRoster")
  );
  panel.style.display = canShow ? "block" : "none";
  if (!canShow) return;

  const charts = buildPerformanceChartSeries();
  grid.innerHTML = charts.map((chart) => {
    const latest = chart.values[chart.values.length - 1]?.value || 0;
    const formatter = chart.id === "completed" ? (value) => String(Math.round(value)) : moneyCompact;
    return `
      <a class="chart-card chart-card-${chart.tone}" href="${chart.href}">
        <div class="chart-card-head">
          <p>${chart.label}</p>
          <span>${chart.meta}</span>
        </div>
        <h3>${formatter(latest)}</h3>
        <div class="chart-bars">
          ${renderChartBars(chart.values, formatter)}
        </div>
      </a>
    `;
  }).join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function searchEntry({ tone = "neutral", label = "", title = "", meta = "", href = "./index.html" }) {
  return { tone, label, title, meta, href };
}

function buildGlobalSearchResults(query) {
  const term = String(query || "").trim().toLowerCase();
  if (!term) return [];
  const results = [];

  if (auth.can("viewDrivers")) {
    readRows("transport_crm_drivers").forEach((driver) => {
      const hay = `${driver.name || ""} ${driver.phone || ""} ${driver.email || ""} ${driver.licenseNumber || ""} ${driver.status || ""}`.toLowerCase();
      if (!hay.includes(term)) return;
      results.push(searchEntry({
        tone: "live",
        label: "Drivers",
        title: driver.name || "Unnamed driver",
        meta: [driver.phone, driver.email, driver.status].filter(Boolean).join(" | ") || "Driver record",
        href: "./drivers.html"
      }));
    });
  }

  if (auth.can("viewTrucks")) {
    readRows("transport_crm_trucks").forEach((truck) => {
      const hay = `${truck.truckNumber || ""} ${truck.registration || ""} ${truck.model || ""} ${truck.status || ""} ${truck.notes || ""}`.toLowerCase();
      if (!hay.includes(term)) return;
      results.push(searchEntry({
        tone: "warning",
        label: "Trucks",
        title: `Truck ${truck.truckNumber || "-"}`,
        meta: [truck.registration, truck.model, truck.status].filter(Boolean).join(" | ") || "Truck record",
        href: "./trucks.html"
      }));
    });
  }

  if (auth.can("viewRoster")) {
    readRows("transport_crm_roster").forEach((row) => {
      const hay = `${row.driverName || ""} ${row.truckNumber || ""} ${row.shiftDate || ""} ${row.shiftTime || ""} ${row.startLocation || ""} ${row.route || ""} ${row.status || ""}`.toLowerCase();
      if (!hay.includes(term)) return;
      results.push(searchEntry({
        tone: row.status === "Leave" ? "warning" : "queue",
        label: "Roster",
        title: `${row.driverName || "Driver"} • ${row.shiftDate || "No date"}`,
        meta: [row.startLocation, row.truckNumber ? `Truck ${row.truckNumber}` : "", row.route, row.status].filter(Boolean).join(" | "),
        href: "./roster.html"
      }));
    });
  }

  if (auth.can("viewTruckIncome")) {
    readRows(INCOME_KEY).forEach((item) => {
      const hay = `${item.truckNumber || ""} ${item.jobReference || ""} ${item.client || ""} ${item.incomeDate || ""} ${item.status || ""}`.toLowerCase();
      if (!hay.includes(term)) return;
      results.push(searchEntry({
        tone: "live",
        label: "Truck Income",
        title: `${item.client || "Client"} • Truck ${item.truckNumber || "-"}`,
        meta: [item.incomeDate, item.jobReference, moneyCompact(item.amount)].filter(Boolean).join(" | "),
        href: "./finance.html"
      }));
    });
  }

  if (auth.can("viewSpending")) {
    readRows(EXPENSE_KEY).forEach((item) => {
      const hay = `${item.truckNumber || ""} ${item.category || ""} ${item.vendor || ""} ${item.date || ""} ${item.notes || ""}`.toLowerCase();
      if (!hay.includes(term)) return;
      results.push(searchEntry({
        tone: "warning",
        label: "Truck Expense",
        title: `${item.category || "Expense"} • Truck ${item.truckNumber || "-"}`,
        meta: [item.date, item.vendor, moneyCompact(item.amount)].filter(Boolean).join(" | "),
        href: "./finance.html"
      }));
    });
  }

  if (auth.can("viewPayslips")) {
    readRows(PAY_KEY).forEach((item) => {
      const hay = `${item.driver || ""} ${item.truckNumber || ""} ${item.payPeriod || ""} ${item.paymentDate || ""} ${item.autoPayRef || ""}`.toLowerCase();
      if (!hay.includes(term)) return;
      results.push(searchEntry({
        tone: "queue",
        label: "Driver Pay",
        title: `${item.driver || "Driver"} • ${item.payPeriod || item.paymentDate || "Pay run"}`,
        meta: [item.truckNumber ? `Truck ${item.truckNumber}` : "", item.paymentDate, moneyCompact(payNetAmount(item))].filter(Boolean).join(" | "),
        href: "./finance.html"
      }));
    });
  }

  if (auth.can("accessLogs")) {
    readRows("transport_crm_logs").forEach((item) => {
      const hay = `${item.logType || ""} ${item.driver || ""} ${item.reference || ""} ${item.description || ""} ${item.status || ""}`.toLowerCase();
      if (!hay.includes(term)) return;
      results.push(searchEntry({
        tone: item.status === "Open" ? "warning" : "neutral",
        label: "Logs",
        title: item.reference || item.description || "Log entry",
        meta: [item.logType, item.driver, item.status].filter(Boolean).join(" | "),
        href: "./log.html"
      }));
    });
  }

  if (auth.can("accessControlPanel")) {
    const rolesById = new Map((window.OPXAuth.getRoles?.() || []).map((role) => [role.id, role]));
    (window.OPXAuth.getUsers?.() || []).forEach((user) => {
      const roleName = rolesById.get(user.roleId)?.name || user.roleId || "";
      const hay = `${user.username || ""} ${user.status || ""} ${roleName}`.toLowerCase();
      if (!hay.includes(term)) return;
      results.push(searchEntry({
        tone: user.status === "Inactive" ? "warning" : "neutral",
        label: "Control Panel",
        title: user.username || "User",
        meta: [roleName, user.status || "Active"].filter(Boolean).join(" | "),
        href: "./control-panel.html"
      }));
    });
  }

  return results.slice(0, 18);
}

function drawGlobalSearch() {
  const input = document.getElementById("globalSearchInput");
  const meta = document.getElementById("globalSearchMeta");
  const list = document.getElementById("globalSearchResults");
  if (!input || !meta || !list) return;

  const query = String(input.value || "").trim();
  if (!query) {
    meta.textContent = "Start typing to search across the pages you can access.";
    list.innerHTML = `
      <div class="search-empty">
        <p>Search the CRM from one place</p>
        <span>Try a driver name, truck number, rego, client, pay period, log reference, or username.</span>
      </div>
    `;
    return;
  }

  const results = buildGlobalSearchResults(query);
  meta.textContent = results.length
    ? `${results.length} result${results.length === 1 ? "" : "s"} found for "${query}".`
    : `No CRM matches found for "${query}".`;

  if (!results.length) {
    list.innerHTML = `
      <div class="search-empty">
        <p>No matches found</p>
        <span>Try a wider keyword like a truck number, part of a driver name, a client, or a date.</span>
      </div>
    `;
    return;
  }

  list.innerHTML = results.map((item) => `
    <a class="activity-item activity-item-${item.tone}" href="${item.href}">
      <div class="activity-item-head">
        <p>${escapeHtml(item.label)}</p>
        <span>Open</span>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <div class="search-result-meta">${escapeHtml(item.meta)}</div>
    </a>
  `).join("");
}

function drawQuickActions() {
  const grid = document.getElementById("quickActionsGrid");
  if (!grid) return;
  const items = quickActions();
  if (!items.length) {
    grid.innerHTML = "<p class='muted'>No quick actions available for your role.</p>";
    return;
  }
  grid.innerHTML = items.map((item) => `
    <a class="quick-action-card quick-action-card-${item.tone}" href="${item.href}">
      <p>${item.label}</p>
      <h3>${item.title}</h3>
      <span>${item.meta}</span>
    </a>
  `).join("");
}

function drawReminderCenter() {
  const grid = document.getElementById("reminderCenterGrid");
  if (!grid) return;
  const cards = reminderCenterCards();
  grid.innerHTML = cards.map((item) => `
    <a class="attention-card attention-card-${item.tone}" href="${item.href}">
      <p>${item.label}</p>
      <h3>${item.title}</h3>
      <span>${item.meta}</span>
    </a>
  `).join("");
}

function drawRecentActivity() {
  const list = document.getElementById("recentActivityList");
  if (!list) return;
  const items = recentActivityItems();
  if (!items.length) {
    list.innerHTML = "<p class='muted'>No recent activity yet.</p>";
    return;
  }
  list.innerHTML = items.map((item) => `
    <a class="activity-item activity-item-${item.tone}" href="${item.href}">
      <div class="activity-item-head">
        <p>${item.label}</p>
        <span>${item.meta}</span>
      </div>
      <h3>${item.title}</h3>
    </a>
  `).join("");
}

function drawReadinessChecks() {
  const grid = document.getElementById("readinessChecksGrid");
  if (!grid) return;
  const cards = readinessCheckCards();
  grid.innerHTML = cards.map((item) => `
    <a class="attention-card attention-card-${item.tone}" href="${item.href}">
      <p>${item.label}</p>
      <h3>${item.title}</h3>
      <span>${item.meta}</span>
    </a>
  `).join("");
}

function drawPayrollReadiness() {
  const panel = document.getElementById("payrollReadinessPanel");
  const dateNode = document.getElementById("payrollReadinessDate");
  const metaNode = document.getElementById("payrollReadinessMeta");
  const grid = document.getElementById("payrollReadinessGrid");
  if (!panel || !dateNode || !metaNode || !grid) return;

  const canShow = auth.can("accessCRM") && (auth.can("viewRoster") || auth.can("viewPayslips"));
  panel.style.display = canShow ? "block" : "none";
  if (!canShow) return;

  dateNode.textContent = formatDisplayDateLong(currentPayRunDate());
  metaNode.textContent = `Current week completed roster work compared with generated payslips for ${currentPayPeriodLabel()}.`;
  const cards = payrollReadinessCards();
  grid.innerHTML = cards.map((item) => `
    <a class="attention-card attention-card-${item.tone}" href="${item.href}">
      <p>${item.label}</p>
      <h3>${item.title}</h3>
      <span>${item.meta}</span>
    </a>
  `).join("");
}

document.getElementById("currentUserChip").textContent = `User: ${auth.user.username}`;
document.getElementById("globalSearchInput")?.addEventListener("input", drawGlobalSearch);
document.getElementById("globalSearchInput")?.addEventListener("search", drawGlobalSearch);

document.getElementById("logoutBtn").addEventListener("click", () => {
  window.OPXAuth.logout();
  window.location.href = "./login.html";
});

function getSupabaseClient() {
  return window.OPXSupabase?.client || null;
}

function isSupabaseReady() {
  return Boolean(window.OPXSupabase?.isReady && getSupabaseClient());
}

async function hydrateLogCountFromSupabase() {
  if (!isSupabaseReady()) return;
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const { count, error } = await supabase.from("app_logs").select("*", { count: "exact", head: true });
  if (error) {
    console.error("Supabase log count failed:", error.message);
    return;
  }

  state.logCount = Number(count || 0);
  drawStats();
}

applyRoleDashboardProfile();
drawStats();
drawManagerSummary();
drawAttentionStrip();
drawReminderCenter();
drawWeekSnapshot();
drawTodayFocus();
drawPerformanceCharts();
drawQuickActions();
drawGlobalSearch();
drawRecentActivity();
drawReadinessChecks();
drawPayrollReadiness();
drawLinks();

if (isSupabaseReady()) {
  void hydrateLogCountFromSupabase();
}

window.addEventListener("opx:supabase-ready", () => {
  void hydrateLogCountFromSupabase();
});

window.addEventListener("storage", (event) => {
  if (!event.key) return;
  if (event.key.startsWith("transport_crm_")) {
    applyRoleDashboardProfile();
    drawStats();
    drawManagerSummary();
    drawAttentionStrip();
    drawReminderCenter();
    drawWeekSnapshot();
    drawTodayFocus();
    drawPerformanceCharts();
    drawQuickActions();
    drawGlobalSearch();
    drawRecentActivity();
    drawReadinessChecks();
    drawPayrollReadiness();
  }
});

window.addEventListener("online", () => {
  applyRoleDashboardProfile();
  drawManagerSummary();
  drawAttentionStrip();
  drawReminderCenter();
  drawWeekSnapshot();
  drawTodayFocus();
  drawPerformanceCharts();
  drawQuickActions();
  drawGlobalSearch();
  drawRecentActivity();
  drawReadinessChecks();
  drawPayrollReadiness();
});
window.addEventListener("offline", () => {
  applyRoleDashboardProfile();
  drawManagerSummary();
  drawAttentionStrip();
  drawReminderCenter();
  drawWeekSnapshot();
  drawTodayFocus();
  drawPerformanceCharts();
  drawQuickActions();
  drawGlobalSearch();
  drawRecentActivity();
  drawReadinessChecks();
  drawPayrollReadiness();
});
window.addEventListener("opx:sync-health-change", () => {
  applyRoleDashboardProfile();
  drawManagerSummary();
  drawAttentionStrip();
  drawReminderCenter();
  drawWeekSnapshot();
  drawTodayFocus();
  drawPerformanceCharts();
  drawQuickActions();
  drawGlobalSearch();
  drawRecentActivity();
  drawReadinessChecks();
  drawPayrollReadiness();
});
