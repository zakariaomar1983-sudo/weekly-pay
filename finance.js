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
const FINANCE_SYNC_STATUS_KEY = "transport_crm_finance_sync_status";
const FINANCE_SYNC_RETRY_DELAYS_MS = [2000, 5000, 10000, 30000];
const DRIVERS_KEY = "transport_crm_drivers";
const ROSTER_KEY = "transport_crm_roster";
const TABLE_BY_KEY = {
  [KEYS.income]: "truck_income",
  [KEYS.expense]: "truck_expense",
  [KEYS.pay]: "payslips"
};
const FINANCE_SOURCE_BY_KEY = {
  [KEYS.income]: "Truck Income",
  [KEYS.expense]: "Truck Expense",
  [KEYS.pay]: "Driver Pay"
};

function applyFinanceResetFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    if (params.get("resetFinance") !== "1") return;
    Object.values(KEYS).forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore
  }
}

applyFinanceResetFromUrl();

const state = {
  income: readData(KEYS.income),
  expense: readData(KEYS.expense),
  pay: readData(KEYS.pay),
  payslipEmailConfigured: false
};
const sendingPayEmails = new Set();
const financeSyncTimers = new Map();
const financeRetryTimers = new Map();
const financeRetryAttempts = new Map();
const financeSyncInFlight = new Set();
const financeSyncQueued = new Map();
const financeLocalEditAt = new Map();
let financeSearchTimerId = 0;

function formatFinanceSyncTime(value = Date.now()) {
  return new Date(value).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

function formatFinanceRetryDelay(ms) {
  if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

function readFinanceSyncStatus() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FINANCE_SYNC_STATUS_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function financeSourceForKey(key) {
  return FINANCE_SOURCE_BY_KEY[key] || "Finance";
}

function setFinanceSyncStatus(message, tone = "neutral", { at = Date.now(), persist = true, source = "Finance" } = {}) {
  const status = document.getElementById("financeSyncStatus");
  if (!status) return;
  status.textContent = `${message} Last updated ${formatFinanceSyncTime(at)}.`;
  status.className = `sync-badge sync-badge-${tone}`;
  if (persist) {
    localStorage.setItem(FINANCE_SYNC_STATUS_KEY, JSON.stringify({ message, tone, at }));
  }
  window.dispatchEvent(new CustomEvent("opx:sync-health-change", { detail: { source, message, tone, at } }));
  updateFinanceQueueBanner();
}

function restoreFinanceSyncStatus() {
  const saved = readFinanceSyncStatus();
  if (!saved?.message) return false;
  setFinanceSyncStatus(saved.message, saved.tone || "neutral", { at: saved.at || Date.now(), persist: false });
  return true;
}

function setFinanceQueueBanner(message = "", tone = "pending", visible = false) {
  const banner = document.getElementById("financeQueueBanner");
  if (!banner) return;
  banner.hidden = !visible;
  if (!visible) {
    banner.textContent = "";
    banner.className = "queue-banner queue-banner-pending";
    return;
  }
  banner.textContent = message;
  banner.className = `queue-banner queue-banner-${tone}`;
}

function financePendingQueueCount() {
  return Object.values(KEYS).filter((key) =>
    financeRetryAttempts.has(key) || financeRetryTimers.has(key) || financeSyncQueued.has(key)
  ).length;
}

function updateFinanceQueueBanner() {
  if (!isSupabaseReady()) {
    setFinanceQueueBanner("", "pending", false);
    return;
  }
  if (navigator.onLine === false) {
    setFinanceQueueBanner("Offline mode: finance changes are saving on this device and will sync automatically when internet returns.", "offline", true);
    return;
  }
  const pendingCount = financePendingQueueCount();
  if (pendingCount) {
    const label = pendingCount === 1 ? "1 finance data set is queued" : `${pendingCount} finance data sets are queued`;
    setFinanceQueueBanner(`Sync queue active: ${label} and retrying automatically in the background.`, "pending", true);
    return;
  }
  setFinanceQueueBanner("", "pending", false);
}

function clearFinanceSyncRetry(key, resetAttempt = true) {
  const timerId = financeRetryTimers.get(key);
  if (timerId) window.clearTimeout(timerId);
  financeRetryTimers.delete(key);
  if (resetAttempt) financeRetryAttempts.delete(key);
}

function queueFinanceSyncRetry(key, errorMessage = "") {
  if (!isSupabaseReady()) return;
  clearFinanceSyncRetry(key, false);
  const currentAttempt = financeRetryAttempts.get(key) || 0;
  const delay = FINANCE_SYNC_RETRY_DELAYS_MS[Math.min(currentAttempt, FINANCE_SYNC_RETRY_DELAYS_MS.length - 1)];
  financeRetryAttempts.set(key, currentAttempt + 1);
  const source = financeSourceForKey(key);
  const waitingForInternet = navigator.onLine === false;
  const retryMessage = waitingForInternet
    ? `${source} saved here. Waiting for internet to retry shared sync.`
    : `${source} saved here. Retrying shared sync in ${formatFinanceRetryDelay(delay)}.`;
  const details = errorMessage ? ` ${errorMessage}` : "";
  setFinanceSyncStatus(`${retryMessage}${details}`, "error", { source });
  const timerId = window.setTimeout(() => {
    financeRetryTimers.delete(key);
    scheduleFinanceSync(key, readData(key), 0);
  }, waitingForInternet ? Math.max(delay, 5000) : delay);
  financeRetryTimers.set(key, timerId);
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? "")
    .trim()
    .replaceAll(",", "")
    .replace(/\$/g, "");
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

const money = (value) => `$${toNumber(value).toFixed(2)}`;
const NIGHT_DROP_DEFAULT_RATE = 90;
const PAYROLL_LAG_WEEKS = 1;
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
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    const rows = ensureUuidRows(Array.isArray(parsed) ? parsed : [], key);
    if (key !== KEYS.expense) return rows;

    let changed = false;
    const normalized = rows.map((row) => {
      const next = {
        ...row,
        date: String(row.date || row.expenseDate || row.expense_date || "").trim(),
        truckNumber: String(row.truckNumber || row.truck_number || "").trim(),
        category: String(row.category || row.expenseCategory || "").trim(),
        amount: toNumber(row.amount ?? row.expenseAmount ?? row.expense_amount ?? 0),
        vendor: String(row.vendor || row.paidTo || row.supplier || "").trim(),
        notes: String(row.notes || "").trim()
      };
      if (
        next.date !== String(row.date || "") ||
        next.truckNumber !== String(row.truckNumber || "") ||
        next.category !== String(row.category || "") ||
        next.amount !== toNumber(row.amount ?? 0) ||
        next.vendor !== String(row.vendor || "") ||
        next.notes !== String(row.notes || "")
      ) {
        changed = true;
      }
      return next;
    });

    if (changed) {
      localStorage.setItem(key, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return [];
  }
}

function readDriversData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DRIVERS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveData(key, data) {
  financeLocalEditAt.set(key, Date.now());
  localStorage.setItem(key, JSON.stringify(data));
  const source = financeSourceForKey(key);
  if (isSupabaseReady()) {
    clearFinanceSyncRetry(key, false);
    setFinanceSyncStatus(`Syncing ${source.toLowerCase()} changes...`, "syncing", { source });
    scheduleFinanceSync(key, data);
  } else {
    setFinanceSyncStatus(`${source} saved on this device only.`, "local", { source });
  }
}

function scheduleFinanceSync(key, data, delay = 300) {
  if (!isSupabaseReady()) return;
  const existingTimer = financeSyncTimers.get(key);
  if (existingTimer) window.clearTimeout(existingTimer);
  clearFinanceSyncRetry(key, false);
  const timerId = window.setTimeout(() => {
    financeSyncTimers.delete(key);
    if (financeSyncInFlight.has(key)) {
      financeSyncQueued.set(key, data);
      return;
    }
    void syncRowsToSupabase(key, data);
  }, delay);
  financeSyncTimers.set(key, timerId);
}

function scheduleFinanceRefresh() {
  window.clearTimeout(financeSearchTimerId);
  financeSearchTimerId = window.setTimeout(() => {
    financeSearchTimerId = 0;
    refresh();
  }, 120);
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
    amount: toNumber(item.amount),
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
    amount: toNumber(row.amount),
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
    amount: toNumber(item.amount),
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
    amount: toNumber(row.amount),
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
    days_worked: toNumber(item.daysWorked ?? item.hoursWorked ?? 0),
    daily_rate: toNumber(item.dailyRate ?? item.hourlyRate ?? 0),
    night_run_drops: toNumber(item.nightRunDrops ?? 0),
    drop_rate: toNumber(item.dropRate ?? NIGHT_DROP_DEFAULT_RATE),
    night_run_pay: toNumber(item.nightRunPay ?? (toNumber(item.nightRunDrops ?? 0) * NIGHT_DROP_DEFAULT_RATE)),
    driver_bonus: toNumber(item.driverBonus ?? 0),
    deductions: toNumber(item.deductions ?? 0),
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
    daysWorked: toNumber(row.days_worked ?? 0),
    dailyRate: toNumber(row.daily_rate ?? 0),
    nightRunDrops: toNumber(row.night_run_drops ?? 0),
    dropRate: toNumber(row.drop_rate ?? NIGHT_DROP_DEFAULT_RATE),
    nightRunPay: toNumber(row.night_run_pay ?? 0),
    driverBonus: toNumber(row.driver_bonus ?? 0),
    deductions: toNumber(row.deductions ?? 0),
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

function getSupabaseClient() {
  return window.OPXSupabase?.client || null;
}

function isSupabaseReady() {
  return Boolean(window.OPXSupabase?.isReady && getSupabaseClient());
}

async function syncRowsToSupabase(key, rows) {
  if (!isSupabaseReady() || financeSyncInFlight.has(key)) return false;
  const table = TABLE_BY_KEY[key];
  if (!table) return;
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const source = financeSourceForKey(key);
  financeSyncInFlight.add(key);
  const payload = toDbRows(key, rows);
  try {
    if (!payload.length) {
      const wipe = await supabase.from(table).delete().not("id", "is", null);
      if (wipe.error) {
        console.error(`Supabase delete sync failed for ${table}:`, wipe.error.message);
        queueFinanceSyncRetry(key, wipe.error.message);
        return false;
      }
      clearFinanceSyncRetry(key);
      setFinanceSyncStatus(`${source} changes saved and synced.`, "live", { source });
      return true;
    }

    const { error } = await supabase.from(table).upsert(payload, { onConflict: "id" });
    if (error) {
      console.error(`Supabase sync failed for ${table}:`, error.message);
      queueFinanceSyncRetry(key, error.message);
      return false;
    }

    const ids = payload.map((r) => r.id);
    const inList = `(${ids.map((id) => `"${String(id).replaceAll('"', "")}"`).join(",")})`;
    const cleanup = await supabase.from(table).delete().not("id", "in", inList);
    if (cleanup.error) {
      console.error(`Supabase cleanup failed for ${table}:`, cleanup.error.message);
      queueFinanceSyncRetry(key, cleanup.error.message);
      return false;
    }
    clearFinanceSyncRetry(key);
    setFinanceSyncStatus(`${source} changes saved and synced.`, "live", { source });
    return true;
  } finally {
    financeSyncInFlight.delete(key);
    if (financeSyncQueued.has(key)) {
      const nextRows = financeSyncQueued.get(key);
      financeSyncQueued.delete(key);
      scheduleFinanceSync(key, nextRows, 0);
    }
  }
}

async function hydrateFinanceFromSupabase() {
  if (!isSupabaseReady()) return;
  const hydrateStartedAt = Date.now();
  setFinanceSyncStatus("Checking shared finance data...", "syncing");
  const supabase = getSupabaseClient();
  if (!supabase) return;
  let hadLoadError = false;

  const [incomeRes, expenseRes, payRes] = await Promise.all([
    supabase.from(TABLE_BY_KEY[KEYS.income]).select("*"),
    supabase.from(TABLE_BY_KEY[KEYS.expense]).select("*"),
    supabase.from(TABLE_BY_KEY[KEYS.pay]).select("*")
  ]);

  if (!incomeRes.error && Array.isArray(incomeRes.data)) {
    if (!incomeRes.data.length && state.income.length) {
      console.warn("Supabase truck_income table is empty; keeping local income and seeding Supabase.");
      await syncRowsToSupabase(KEYS.income, state.income);
    } else if ((financeLocalEditAt.get(KEYS.income) || 0) > hydrateStartedAt) {
      console.info("Skipping stale shared truck_income hydrate because local edits were saved after hydrate started.");
    } else {
      state.income = incomeRes.data.map(fromDbIncome);
      localStorage.setItem(KEYS.income, JSON.stringify(state.income));
    }
  } else if (incomeRes.error) {
    console.error("Supabase load failed for truck_income:", incomeRes.error.message);
    hadLoadError = true;
    setFinanceSyncStatus("Shared finance sync unavailable. Using this device's saved data.", "local");
  }

  if (!expenseRes.error && Array.isArray(expenseRes.data)) {
    if (!expenseRes.data.length && state.expense.length) {
      console.warn("Supabase truck_expense table is empty; keeping local expense and seeding Supabase.");
      await syncRowsToSupabase(KEYS.expense, state.expense);
    } else if ((financeLocalEditAt.get(KEYS.expense) || 0) > hydrateStartedAt) {
      console.info("Skipping stale shared truck_expense hydrate because local edits were saved after hydrate started.");
    } else {
      state.expense = expenseRes.data.map(fromDbExpense);
      localStorage.setItem(KEYS.expense, JSON.stringify(state.expense));
    }
  } else if (expenseRes.error) {
    console.error("Supabase load failed for truck_expense:", expenseRes.error.message);
    hadLoadError = true;
    setFinanceSyncStatus("Shared finance sync unavailable. Using this device's saved data.", "local");
  }

  if (!payRes.error && Array.isArray(payRes.data)) {
    if (!payRes.data.length && state.pay.length) {
      console.warn("Supabase payslips table is empty; keeping local payslips and seeding Supabase.");
      await syncRowsToSupabase(KEYS.pay, state.pay);
    } else if ((financeLocalEditAt.get(KEYS.pay) || 0) > hydrateStartedAt) {
      console.info("Skipping stale shared payslips hydrate because local edits were saved after hydrate started.");
    } else {
      state.pay = payRes.data.map(fromDbPay);
      localStorage.setItem(KEYS.pay, JSON.stringify(state.pay));
    }
  } else if (payRes.error) {
    console.error("Supabase load failed for payslips:", payRes.error.message);
    hadLoadError = true;
    setFinanceSyncStatus("Shared finance sync unavailable. Using this device's saved data.", "local");
  }

  if (!hadLoadError) {
    setFinanceSyncStatus("Shared finance data loaded.", "live");
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
  const daysWorked = toNumber(item.daysWorked ?? item.hoursWorked ?? 0);
  const dailyRate = toNumber(item.dailyRate ?? item.hourlyRate ?? 0);
  const nightRunDrops = toNumber(item.nightRunDrops ?? 0);
  const dropRate = NIGHT_DROP_DEFAULT_RATE;
  const nightRunPay = nightRunDrops * dropRate;
  const driverBonus = toNumber(item.driverBonus ?? 0);
  return daysWorked * dailyRate + nightRunPay + driverBonus - toNumber(item.deductions || 0);
}

function normalizeDriverName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeRosterStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanPhone(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}

function toWhatsAppNumber(phone) {
  const cleaned = cleanPhone(phone);
  if (!cleaned) return "";
  if (cleaned.startsWith("+")) return cleaned.slice(1);
  if (cleaned.startsWith("0")) return `61${cleaned.slice(1)}`;
  return cleaned;
}

function findDriverContact(driverName) {
  const target = normalizeDriverName(driverName);
  if (!target) return null;
  const drivers = readDriversData();
  return drivers.find((item) => normalizeDriverName(item.name) === target) || null;
}

function payslipMessage(item) {
  return [
    `Hi ${item.driver || "team"},`,
    "",
    `Your payslip for ${item.payPeriod || "this pay period"} is ready.`,
    `Net pay: ${money(netPay(item))}`,
    `Payment date: ${item.paymentDate || "-"}`,
    "",
    "Please check the OnPoint Express finance page for the printable payslip."
  ].join("\n");
}

function openPayslipContact(channel, item) {
  const contact = findDriverContact(item.driver);
  const email = String(contact?.email || "").trim();
  const phone = cleanPhone(contact?.phone || "");

  if (channel === "email") {
    if (!email) {
      alert(`No email is saved for ${item.driver || "this driver"} yet.`);
      return;
    }
    const subject = `OnPoint Express Payslip - ${item.payPeriod || item.paymentDate || "Weekly Pay"}`;
    const body = payslipMessage(item);
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return;
  }

  if (channel === "whatsapp") {
    if (!phone) {
      alert(`No phone number is saved for ${item.driver || "this driver"} yet.`);
      return;
    }
    const whatsappNumber = toWhatsAppNumber(phone);
    if (!whatsappNumber) {
      alert(`WhatsApp number is not valid for ${item.driver || "this driver"}.`);
      return;
    }
    window.open(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(payslipMessage(item))}`, "_blank", "noopener");
  }
}

function renderPayActions(item) {
  if (!auth.can("editPayslips")) return "<span class='muted'>View only</span>";
  const contact = findDriverContact(item.driver);
  const hasEmail = Boolean(String(contact?.email || "").trim());
  const hasPhone = Boolean(cleanPhone(contact?.phone || ""));
  const isSendingEmail = sendingPayEmails.has(item.id);
  const showEmailButton = state.payslipEmailConfigured && hasEmail;
  return `<div class='table-actions table-actions-stack'>
    <button data-action='edit-pay' data-id='${item.id}'>Edit</button>
    <button data-action='delete-pay' data-id='${item.id}'>Delete</button>
    <button data-action='print-pay' data-id='${item.id}'>Print</button>
    ${showEmailButton ? `<button class='contact-link contact-link-email' data-action='email-pay' data-id='${item.id}' ${isSendingEmail ? "disabled" : ""}>${isSendingEmail ? "Sending..." : "Email"}</button>` : ""}
    <button class='contact-link contact-link-whatsapp' data-action='whatsapp-pay' data-id='${item.id}' ${hasPhone ? "" : "disabled"}>WhatsApp</button>
  </div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDateForPrint(value) {
  if (!value) return "-";
  const date = parseDateKey(value) || new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

function payslipFilename(item) {
  const safeDriver = String(item.driver || "driver")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "driver";
  const safeDate = String(item.paymentDate || item.payPeriod || "payslip")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "payslip";
  return `onpoint-express-payslip-${safeDriver}-${safeDate}.html`;
}

function buildPayslipDocument(item) {
  const totalDays = Number(item.daysWorked ?? item.hoursWorked ?? 0);
  const dailyRate = Number(item.dailyRate ?? item.hourlyRate ?? 0);
  const nightDrops = Number(item.nightRunDrops ?? 0);
  const dropRate = Number(item.dropRate ?? NIGHT_DROP_DEFAULT_RATE);
  const nightRunPay = Number(item.nightRunPay ?? (nightDrops * dropRate));
  const bonus = Number(item.driverBonus ?? 0);
  const deductions = Number(item.deductions ?? 0);
  const grossPay = totalDays * dailyRate + nightRunPay + bonus;
  const net = grossPay - deductions;
  const logoUrl = new URL("./plugins/weekly-pay-plugin/assets/logo.png", window.location.href).href;
  const generatedAt = new Date().toLocaleString("en-AU");
  const paymentMethod = item.autoPay === "Yes" ? "Auto Pay" : "Manual Pay";
  const payReference = item.autoPayRef ? escapeHtml(item.autoPayRef) : "To be confirmed";
  const subject = `OnPoint Express Payslip - ${item.driver || "Driver"} - ${item.payPeriod || item.paymentDate || "Weekly Pay"}`;
  const text = [
    `Hi ${item.driver || "team"},`,
    "",
    `Your OnPoint Express payslip for ${item.payPeriod || "this pay period"} is attached.`,
    `Net pay: ${money(net)}`,
    `Payment date: ${formatDateForPrint(item.paymentDate)}`,
    "",
    "Open the attached payslip file in your browser to view, print, or save it."
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OnPoint Express Payslip - ${escapeHtml(item.driver || "Driver")}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm;
    }
    :root {
      --ink: #12344d;
      --muted: #5d7285;
      --line: #d9e3ea;
      --panel: #f7fafc;
      --accent: #0f8b6d;
      --accent-soft: #e8f7f1;
      --warn-soft: #fff3ea;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 22px;
      background: #eef4f6;
      color: var(--ink);
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    }
    .sheet {
      max-width: 940px;
      width: 190mm;
      min-height: 277mm;
      margin: 0 auto;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 24px;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(18, 52, 77, 0.12);
    }
    .hero {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      padding: 28px 32px 22px;
      background: linear-gradient(135deg, #f3fbf7 0%, #fffaf2 48%, #eef6fb 100%);
      border-bottom: 1px solid var(--line);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 18px;
      min-width: 0;
    }
    .brand img {
      width: 82px;
      height: 82px;
      object-fit: contain;
      border-radius: 20px;
      background: rgba(255,255,255,0.8);
      padding: 10px;
      border: 1px solid rgba(15, 139, 109, 0.18);
    }
    .eyebrow {
      margin: 0 0 6px 0;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--accent);
    }
    h1 {
      margin: 0;
      font-size: 30px;
      line-height: 1.05;
      letter-spacing: -0.03em;
    }
    .hero-copy p,
    .hero-meta p {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 14px;
    }
    .hero-meta {
      min-width: 240px;
      text-align: right;
    }
    .hero-meta .pill {
      display: inline-block;
      margin-bottom: 10px;
      padding: 8px 14px;
      border-radius: 999px;
      background: rgba(15, 139, 109, 0.12);
      color: var(--accent);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .section {
      padding: 24px 32px 0;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 18px;
      background: var(--panel);
    }
    .card h2 {
      margin: 0 0 14px 0;
      font-size: 16px;
      letter-spacing: -0.02em;
    }
    .meta-row,
    .line-row,
    .summary-row {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      padding: 9px 0;
      border-bottom: 1px solid var(--line);
    }
    .meta-row:last-child,
    .line-row:last-child,
    .summary-row:last-child {
      border-bottom: none;
    }
    .label {
      color: var(--muted);
      font-size: 13px;
    }
    .value {
      text-align: right;
      font-weight: 600;
      font-size: 14px;
      color: var(--ink);
    }
    .statement-grid {
      display: grid;
      grid-template-columns: 1.25fr 0.9fr;
      gap: 18px;
      margin-top: 18px;
    }
    .statement-table {
      width: 100%;
      border-collapse: collapse;
      overflow: hidden;
      border-radius: 18px;
      border: 1px solid var(--line);
    }
    .statement-table thead th {
      background: #eff6f8;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      text-align: left;
      padding: 13px 16px;
    }
    .statement-table tbody td {
      padding: 14px 16px;
      border-top: 1px solid var(--line);
      font-size: 14px;
    }
    .statement-table tbody td:last-child,
    .statement-table thead th:last-child {
      text-align: right;
    }
    .summary-card {
      background: linear-gradient(180deg, #ffffff 0%, #f8fcff 100%);
    }
    .summary-row strong {
      font-size: 16px;
    }
    .net-row {
      margin-top: 12px;
      padding: 16px 18px;
      border-radius: 18px;
      background: linear-gradient(135deg, var(--accent-soft) 0%, #f5fffb 100%);
      border: 1px solid rgba(15, 139, 109, 0.18);
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: center;
    }
    .net-row .net-label {
      font-size: 13px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
    }
    .net-row .net-value {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.04em;
      color: var(--accent);
    }
    .footer {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      margin-top: 24px;
      padding: 20px 32px 30px;
      color: var(--muted);
      font-size: 12px;
    }
    .note {
      max-width: 62%;
      line-height: 1.55;
    }
    .stamp {
      padding: 12px 14px;
      border-radius: 16px;
      background: var(--warn-soft);
      border: 1px solid #f1decf;
      text-align: right;
      color: #7a5134;
      font-weight: 600;
    }
    @media print {
      body {
        background: #fff;
        padding: 0;
      }
      .sheet {
        width: 190mm;
        min-height: 277mm;
        border: none;
        box-shadow: none;
        border-radius: 0;
        margin: 0 auto;
      }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <section class="hero">
      <div class="brand">
        <img src="${logoUrl}" alt="OnPoint Express logo" />
        <div class="hero-copy">
          <p class="eyebrow">Contractor Payslip</p>
          <h1>OnPoint Express</h1>
          <p>Weekly contractor payment statement generated from the Driver Pay register.</p>
          <p>Pay period: ${escapeHtml(item.payPeriod || "-")}</p>
        </div>
      </div>
      <div class="hero-meta">
        <div class="pill">Payslip</div>
        <p><strong>Payment Date</strong></p>
        <p>${formatDateForPrint(item.paymentDate)}</p>
        <p style="margin-top:14px;"><strong>Method</strong></p>
        <p>${escapeHtml(paymentMethod)}</p>
      </div>
    </section>

    <section class="section">
      <div class="meta-grid">
        <article class="card">
          <h2>Contractor Details</h2>
          <div class="meta-row"><span class="label">Driver Name</span><span class="value">${escapeHtml(item.driver || "-")}</span></div>
          <div class="meta-row"><span class="label">Truck Number</span><span class="value">${escapeHtml(item.truckNumber || "-")}</span></div>
          <div class="meta-row"><span class="label">Pay Period</span><span class="value">${escapeHtml(item.payPeriod || "-")}</span></div>
          <div class="meta-row"><span class="label">Payment Date</span><span class="value">${formatDateForPrint(item.paymentDate)}</span></div>
        </article>
        <article class="card">
          <h2>Payment Details</h2>
          <div class="meta-row"><span class="label">Auto Pay</span><span class="value">${escapeHtml(item.autoPay || "No")}</span></div>
          <div class="meta-row"><span class="label">Reference</span><span class="value">${payReference}</span></div>
          <div class="meta-row"><span class="label">Generated</span><span class="value">${generatedAt}</span></div>
          <div class="meta-row"><span class="label">Statement Type</span><span class="value">Contractor Weekly Pay</span></div>
        </article>
      </div>

      <div class="statement-grid">
        <div>
          <table class="statement-table" aria-label="Payslip earnings and deductions">
            <thead>
              <tr>
                <th>Description</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Days Worked x Daily Rate</td>
                <td>${totalDays} x ${money(dailyRate)} = ${money(totalDays * dailyRate)}</td>
              </tr>
              <tr>
                <td>Night Run Drops</td>
                <td>${nightDrops} x ${money(dropRate)} = ${money(nightRunPay)}</td>
              </tr>
              <tr>
                <td>Driver Bonus</td>
                <td>${money(bonus)}</td>
              </tr>
              <tr>
                <td>Deductions</td>
                <td>${money(deductions)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <aside class="card summary-card">
          <h2>Pay Summary</h2>
          <div class="summary-row"><span class="label">Worked Days</span><span class="value">${totalDays}</span></div>
          <div class="summary-row"><span class="label">Daily Rate</span><span class="value">${money(dailyRate)}</span></div>
          <div class="summary-row"><span class="label">Night Run Pay</span><span class="value">${money(nightRunPay)}</span></div>
          <div class="summary-row"><span class="label">Bonus</span><span class="value">${money(bonus)}</span></div>
          <div class="summary-row"><span class="label">Gross Pay</span><span class="value">${money(grossPay)}</span></div>
          <div class="summary-row"><span class="label">Deductions</span><span class="value">${money(deductions)}</span></div>
          <div class="net-row">
            <div>
              <div class="net-label">Net Pay</div>
              <div class="label">Amount payable to contractor</div>
            </div>
            <div class="net-value">${money(net)}</div>
          </div>
        </aside>
      </div>
    </section>

    <div class="footer">
      <div class="note">
        This payslip is generated from the OnPoint Express weekly roster and driver pay register. Keep it with your weekly records for payment tracking and contractor reconciliation.
      </div>
      <div class="stamp">
        OnPoint Express<br />
        Finance & Driver Pay
      </div>
    </div>
  </div>
</body>
</html>`;

  return {
    filename: payslipFilename(item),
    html,
    subject,
    text
  };
}

function printPayslip(item) {
  const documentData = buildPayslipDocument(item);

  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) {
    alert("Pop-up blocked. Please allow pop-ups to print payslips.");
    return;
  }

  printWindow.document.open();
  printWindow.document.write(documentData.html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => {
    printWindow.print();
  };
}

async function sendPayslipEmail(item) {
  const contact = findDriverContact(item.driver);
  const email = String(contact?.email || "").trim();

  if (!email) {
    alert(`No email is saved for ${item.driver || "this driver"} yet.`);
    return;
  }

  if (sendingPayEmails.has(item.id)) return;
  sendingPayEmails.add(item.id);
  refresh();

  try {
    const documentData = buildPayslipDocument(item);
    const response = await fetch("/api/send-payslip-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: email,
        driver: item.driver || "",
        subject: documentData.subject,
        text: documentData.text,
        attachmentHtml: documentData.html,
        attachmentFilename: documentData.filename
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || "Payslip email could not be sent.");
    }

    alert(`Payslip emailed to ${email}.`);
  } catch (error) {
    const message = String(error?.message || error || "Payslip email could not be sent.");
    alert(message);
  } finally {
    sendingPayEmails.delete(item.id);
    refresh();
  }
}

async function hydratePayslipEmailStatus() {
  try {
    const response = await fetch("/api/send-payslip-email", { method: "GET" });
    if (!response.ok) return;
    const payload = await response.json().catch(() => ({}));
    const configured = Boolean(payload?.configured);
    if (state.payslipEmailConfigured !== configured) {
      state.payslipEmailConfigured = configured;
      refresh();
    }
  } catch {
    // keep email button hidden until configuration is confirmed
  }
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

function rosterRowFromDb(row) {
  const runType = String(row.run_type || "").trim().toLowerCase();
  return {
    id: row.id,
    driverName: row.driver_name || "",
    truckNumber: row.truck_number || "",
    shiftDate: row.shift_date || "",
    shiftTime: row.shift_time || "",
    route: row.route || "",
    status: row.status || "Scheduled",
    nightRun: runType === "night run" || runType === "night run +"
  };
}

function normalizeRosterRow(row) {
  const raw = row && typeof row === "object" ? row : {};
  const runType = String(raw.runType || raw.run_type || "").trim().toLowerCase();
  return {
    id: raw.id || "",
    driverName: raw.driverName || raw.driver_name || "",
    truckNumber: raw.truckNumber || raw.truck_number || "",
    shiftDate: raw.shiftDate || raw.shift_date || "",
    shiftTime: raw.shiftTime || raw.shift_time || "",
    route: raw.route || "",
    status: raw.status || "Scheduled",
    nightRun: Boolean(raw.nightRun) || runType === "night run" || runType === "night run +"
  };
}

function dedupeRosterRowsForPay(rows) {
  const latestByDriverDate = new Map();
  rows.forEach((row) => {
    const driverName = String(row.driverName || "").trim();
    const shiftDate = String(row.shiftDate || "").trim();
    if (!driverName || !shiftDate) return;
    const key = `${driverName}__${shiftDate}`;
    const existing = latestByDriverDate.get(key);
    if (!existing) {
      latestByDriverDate.set(key, row);
      return;
    }

    const existingCompleted = normalizeRosterStatus(existing.status) === "completed";
    const nextCompleted = normalizeRosterStatus(row.status) === "completed";
    if (nextCompleted && !existingCompleted) {
      latestByDriverDate.set(key, row);
      return;
    }

    if (String(row.truckNumber || "").trim() && !String(existing.truckNumber || "").trim()) {
      latestByDriverDate.set(key, row);
      return;
    }

    if (row.nightRun && !existing.nightRun) {
      latestByDriverDate.set(key, row);
      return;
    }

    latestByDriverDate.set(key, row);
  });
  return rows.filter((row) => {
    const driverName = String(row.driverName || "").trim();
    const shiftDate = String(row.shiftDate || "").trim();
    if (!driverName || !shiftDate) return true;
    return latestByDriverDate.get(`${driverName}__${shiftDate}`) === row;
  });
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeekByDay(dateString, weekStartDay) {
  const date = parseDateKey(dateString) || new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const shift = (day - weekStartDay + 7) % 7;
  const start = new Date(date);
  start.setDate(date.getDate() - shift);
  start.setHours(0, 0, 0, 0);
  return start;
}

function financeWeekStartFromDate(dateString) {
  return startOfWeekByDay(dateString, 4);
}

function rosterWeekStartFromDate(dateString) {
  return startOfWeekByDay(dateString, 1);
}

function weekKey(dateString) {
  const start = financeWeekStartFromDate(dateString);
  if (!start) return "";
  return formatDateKey(start);
}

function incomeBatchDate(dateString) {
  return weekKey(dateString);
}

function weekLabel(key) {
  const start = new Date(key);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = { day: "2-digit", month: "short", year: "numeric" };
  return `${start.toLocaleDateString("en-AU", fmt)} - ${end.toLocaleDateString("en-AU", fmt)}`;
}

function parseDateKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalizedRaw = raw
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\s+to\s+/gi, " - ");
  const baseDate = normalizedRaw.includes(" - ")
    ? normalizedRaw.split(" - ")[0].trim()
    : normalizedRaw;

  let year;
  let month;
  let day;

  if (/^\d{4}-\d{2}-\d{2}$/.test(baseDate)) {
    [year, month, day] = baseDate.split("-").map(Number);
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(baseDate)) {
    [day, month, year] = baseDate.split("/").map(Number);
  } else {
    const native = new Date(baseDate);
    if (Number.isNaN(native.getTime())) return null;
    native.setHours(0, 0, 0, 0);
    return native;
  }

  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function mondayKeyFrom(value) {
  const start = rosterWeekStartFromDate(value);
  return start ? formatDateKey(start) : "";
}

function shiftWeekKey(weekKey, weekOffset = 0) {
  const start = parseDateKey(weekKey);
  if (!start) return "";
  const shifted = new Date(start);
  shifted.setDate(start.getDate() + (Number(weekOffset || 0) * 7));
  return formatDateKey(shifted);
}

function sourceRosterWeekKeyFromPayWeek(payWeekKey) {
  if (!payWeekKey) return "";
  if (!PAYROLL_LAG_WEEKS) return payWeekKey;
  return shiftWeekKey(payWeekKey, -PAYROLL_LAG_WEEKS);
}

function readRosterRows() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ROSTER_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeRosterRow) : [];
  } catch {
    return [];
  }
}

async function getRosterRowsForPay() {
  const localRows = dedupeRosterRowsForPay(readRosterRows());
  if (isSupabaseReady()) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from("roster").select("*");
    if (!error && Array.isArray(data)) {
      const remoteRows = dedupeRosterRowsForPay(data.map(rosterRowFromDb));
      // Prefer shared roster rows whenever Supabase returns data.
      // Mixing local + remote can revive stale local shifts and overcount pay days.
      return remoteRows.length ? remoteRows : localRows;
    }
    if (error) {
      console.error("Supabase load failed for roster pay sync:", error.message);
    }
  }
  return localRows;
}

function payPeriodFromPayWeekKey(payWeekKey) {
  const weekStart = parseDateKey(payWeekKey);
  if (!weekStart) return "";
  // Driver pay period is Thursday-to-Thursday, ending on the payment Thursday.
  const end = new Date(weekStart);
  end.setDate(weekStart.getDate() + 3);
  const start = new Date(end);
  start.setDate(end.getDate() - 7);
  const fmt = { day: "2-digit", month: "short", year: "numeric" };
  return `${start.toLocaleDateString("en-AU", fmt)} - ${end.toLocaleDateString("en-AU", fmt)}`;
}

function latestRosterWeekKey(rows, completedOnly = false) {
  return rows.reduce((latest, row) => {
    if (completedOnly && normalizeRosterStatus(row.status) !== "completed") return latest;
    const weekKey = mondayKeyFrom(row.shiftDate);
    if (!weekKey) return latest;
    return !latest || weekKey > latest ? weekKey : latest;
  }, "");
}

function setPayGenerationStatus(message, tone = "muted") {
  const status = document.getElementById("payGenerationStatus");
  if (!status) return;
  status.textContent = message || "";
  status.className = `data-status full ${tone}`.trim();
}

function paymentDateFromWeekKey(weekStartKey) {
  const start = parseDateKey(weekStartKey);
  if (!start) return "";
  const thursday = new Date(start);
  thursday.setDate(start.getDate() + 3);
  return formatDateKey(thursday);
}

function dedupePayRows(rows) {
  const latestByDriverPeriod = new Map();
  rows.forEach((row) => {
    const driver = String(row.driver || "").trim();
    const period = String(row.payPeriod || "").trim();
    if (!driver || !period) return;
    latestByDriverPeriod.set(`${driver}__${period}`, row);
  });
  return rows.filter((row) => {
    const driver = String(row.driver || "").trim();
    const period = String(row.payPeriod || "").trim();
    if (!driver || !period) return true;
    return latestByDriverPeriod.get(`${driver}__${period}`) === row;
  });
}

function buildPayRowsFromRoster(rows, payWeekKey) {
  const sourceWeekKey = sourceRosterWeekKeyFromPayWeek(payWeekKey) || payWeekKey;
  const payPeriod = payPeriodFromPayWeekKey(payWeekKey);
  const paymentDate = paymentDateFromWeekKey(payWeekKey);
  const existingByDriverPeriod = new Map(
    state.pay.map((item) => [`${String(item.driver || "").trim()}__${String(item.payPeriod || "").trim()}`, item])
  );
  const grouped = new Map();

  const weekRows = rows.filter((row) => mondayKeyFrom(row.shiftDate) === sourceWeekKey);
  weekRows.forEach((row) => {
      const driverName = String(row.driverName || "").trim();
      if (!driverName) return;
      if (!grouped.has(driverName)) grouped.set(driverName, []);
      grouped.get(driverName).push(row);
    });

  const generatedRows = Array.from(grouped.entries()).map(([driverName, driverRows]) => {
    const workedRows = driverRows.filter((row) => normalizeRosterStatus(row.status) === "completed");
    const uniqueWorkedDays = new Set(workedRows.map((row) => row.shiftDate).filter(Boolean));
    const nightRunDrops = workedRows.filter((row) => row.nightRun).length;
    const truckNumber = workedRows.find((row) => row.truckNumber)?.truckNumber || driverRows.find((row) => row.truckNumber)?.truckNumber || "";
    const existing = existingByDriverPeriod.get(`${driverName}__${payPeriod}`);
    const dailyRate = Number(existing?.dailyRate || DAILY_RATE_BY_TRUCK_NUMBER[truckNumber] || 0);
    const driverBonus = Number(existing?.driverBonus || 0);
    const deductions = Number(existing?.deductions || 0);
    const autoPay = existing?.autoPay || "No";
    const autoPayRef = existing?.autoPayRef || "";

    return {
      id: existing?.id || uid(),
      driver: driverName,
      truckNumber,
      payPeriod,
      daysWorked: uniqueWorkedDays.size,
      dailyRate,
      nightRunDrops,
      dropRate: NIGHT_DROP_DEFAULT_RATE,
      nightRunPay: nightRunDrops * NIGHT_DROP_DEFAULT_RATE,
      driverBonus,
      deductions,
      paymentDate: existing?.paymentDate || paymentDate,
      autoPay,
      autoPayRef
    };
  }).filter((row) => row.daysWorked > 0);

  return { generatedRows, weekRows, sourceWeekKey };
}

async function generatePayFromRosterWeek() {
  if (!auth.can("editPayslips")) return;
  const weekStartInput = document.getElementById("payRosterWeekStart");
  const generateButton = document.getElementById("generatePayFromRoster");
  let payWeekKey = mondayKeyFrom(weekStartInput?.value || formatDateKey(new Date()));
  if (!payWeekKey) {
    setPayGenerationStatus("Choose a valid roster week first.", "error-text");
    alert("Choose a valid roster week first.");
    return;
  }

  if (generateButton) generateButton.disabled = true;
  setPayGenerationStatus("Checking roster and building Driver Pay from completed shifts...");

  try {
    const rosterRows = await getRosterRowsForPay();
    let result = buildPayRowsFromRoster(rosterRows, payWeekKey);

    if (!result.generatedRows.length) {
      const fallbackWeekKey = latestRosterWeekKey(rosterRows, true);
      const fallbackPayWeekKey = shiftWeekKey(fallbackWeekKey, PAYROLL_LAG_WEEKS);
      if (fallbackWeekKey && fallbackPayWeekKey && fallbackPayWeekKey !== payWeekKey) {
        payWeekKey = fallbackPayWeekKey;
        if (weekStartInput) weekStartInput.value = fallbackPayWeekKey;
        syncPayDateToRosterWeek();
        result = buildPayRowsFromRoster(rosterRows, payWeekKey);
      }
    }

    const { generatedRows, weekRows, sourceWeekKey } = result;
    if (!generatedRows.length) {
      if (weekRows.length) {
        const message = `Roster shifts were found for week ${sourceWeekKey}, but none are marked Completed yet.`;
        setPayGenerationStatus(`${message} Mark finished shifts as Completed in Week View, then generate Driver Pay again.`, "error-text");
        alert(`${message} Mark finished shifts as Completed in Week View, then generate Driver Pay again.`);
      } else {
        const latestWeek = latestRosterWeekKey(rosterRows, false);
        const message = latestWeek
          ? `No roster shifts were found for source week ${sourceWeekKey}. Latest saved roster week is ${latestWeek}.`
          : "No roster shifts were found yet. Save the roster week first.";
        setPayGenerationStatus(message, "error-text");
        alert(message);
      }
      refresh();
      return;
    }

    const generatedKeys = new Set(generatedRows.map((row) => `${row.driver}__${row.payPeriod}`));
    state.pay = dedupePayRows([
      ...state.pay.filter((row) => !generatedKeys.has(`${row.driver}__${row.payPeriod}`)),
      ...generatedRows
    ]);
    saveData(KEYS.pay, state.pay);
    refresh();
    const success = `Generated driver pay for ${generatedRows.length} driver${generatedRows.length === 1 ? "" : "s"} from roster week ${sourceWeekKey} (payment week ${payWeekKey}).`;
    setPayGenerationStatus(success);
    alert(success);
  } finally {
    if (generateButton) generateButton.disabled = false;
  }
}

function syncPayDateToRosterWeek() {
  const weekStartInput = document.getElementById("payRosterWeekStart");
  const paymentDateInput = document.getElementById("paymentDate");
  const payIdInput = document.getElementById("payId");
  if (!weekStartInput || !paymentDateInput || !payIdInput) return;
  if (payIdInput.value) return;
  const weekStartKey = mondayKeyFrom(weekStartInput.value || formatDateKey(new Date()));
  if (!weekStartKey) return;
  paymentDateInput.value = paymentDateFromWeekKey(weekStartKey);
}

function dateInRange(dateValue, rangeStart, rangeEnd) {
  const date = parseDateKey(dateValue);
  if (!date) return false;
  return date >= rangeStart && date <= rangeEnd;
}

function getLatestFinanceDate() {
  const allDates = [
    ...state.income.map((item) => item.incomeDate),
    ...state.expense.map((item) => item.date),
    ...state.pay.map((item) => item.paymentDate)
  ]
    .map(parseDateKey)
    .filter(Boolean)
    .sort((a, b) => a - b);

  return allDates.length ? allDates[allDates.length - 1] : null;
}

function periodBoundsForDashboard() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const referenceDate = getLatestFinanceDate() || today;

  const weekStart = financeWeekStartFromDate(formatDateKey(referenceDate));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const monthEnd = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0);
  monthEnd.setHours(23, 59, 59, 999);

  return { weekStart, weekEnd, monthStart, monthEnd, referenceDate };
}

function sumForRange(rows, dateField, amountGetter, start, end) {
  return rows.reduce((sum, row) => (
    dateInRange(row[dateField], start, end) ? sum + toNumber(amountGetter(row)) : sum
  ), 0);
}

function getFinanceDashboardAccess() {
  const canViewIncome = auth.can("viewTruckIncome") || auth.can("viewStats");
  const canViewExpense = auth.can("viewSpending") || auth.can("viewStats");
  const canViewPay = auth.can("viewPayslips") || auth.can("viewStats");
  const canViewProfit = auth.can("viewStats") || (auth.can("viewTruckIncome") && auth.can("viewSpending") && auth.can("viewPayslips"));
  return { canViewIncome, canViewExpense, canViewPay, canViewProfit };
}

function drawPeriodTotalsDashboard() {
  const panel = document.getElementById("periodTotalsPanel");
  const meta = document.getElementById("periodTotalsMeta");
  const grid = document.getElementById("periodTotalsGrid");
  const { canViewIncome, canViewExpense, canViewPay, canViewProfit } = getFinanceDashboardAccess();

  if (!(canViewIncome || canViewExpense || canViewPay || canViewProfit)) {
    panel.style.display = "none";
    return;
  }

  panel.style.display = "block";

  const { weekStart, weekEnd, monthStart, monthEnd, referenceDate } = periodBoundsForDashboard();
  const fmt = { day: "2-digit", month: "short", year: "numeric" };
  meta.textContent = `Finance week: ${weekStart.toLocaleDateString("en-AU", fmt)} - ${weekEnd.toLocaleDateString("en-AU", fmt)} (Thursday to Wednesday) | Month: ${monthStart.toLocaleDateString("en-AU", { month: "long", year: "numeric" })} | Latest activity: ${referenceDate.toLocaleDateString("en-AU", fmt)}`;

  const weeklyIncome = sumForRange(state.income, "incomeDate", (x) => x.amount, weekStart, weekEnd);
  const monthlyIncome = sumForRange(state.income, "incomeDate", (x) => x.amount, monthStart, monthEnd);

  const weeklyExpense = sumForRange(state.expense, "date", (x) => x.amount, weekStart, weekEnd);
  const monthlyExpense = sumForRange(state.expense, "date", (x) => x.amount, monthStart, monthEnd);

  const weeklyDriverPay = sumForRange(state.pay, "paymentDate", (x) => netPay(x), weekStart, weekEnd);
  const monthlyDriverPay = sumForRange(state.pay, "paymentDate", (x) => netPay(x), monthStart, monthEnd);

  const weeklyProfit = weeklyIncome - weeklyExpense - weeklyDriverPay;
  const monthlyProfit = monthlyIncome - monthlyExpense - monthlyDriverPay;

  const cards = [];

  if (canViewIncome) {
    cards.push(
      { label: "Weekly Income", value: money(weeklyIncome) },
      { label: "Monthly Income", value: money(monthlyIncome) }
    );
  }

  if (canViewExpense) {
    cards.push(
      { label: "Weekly Truck Expense", value: money(weeklyExpense) },
      { label: "Monthly Truck Expense", value: money(monthlyExpense) }
    );
  }

  if (canViewPay) {
    cards.push(
      { label: "Weekly Driver Pay", value: money(weeklyDriverPay) },
      { label: "Monthly Driver Pay", value: money(monthlyDriverPay) }
    );
  }

  if (canViewProfit) {
    cards.push(
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
    );
  }

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
    ensure(wk).income += toNumber(item.amount);
  });

  state.expense.forEach((item) => {
    const wk = weekKey(item.date);
    if (!wk) return;
    ensure(wk).expense += toNumber(item.amount);
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
  const { canViewIncome, canViewExpense, canViewPay, canViewProfit } = getFinanceDashboardAccess();

  if (!(canViewIncome || canViewExpense || canViewPay || canViewProfit)) {
    stats.style.display = "none";
    return;
  }

  const incomeTotal = state.income.reduce((sum, x) => sum + toNumber(x.amount), 0);
  const expenseTotal = state.expense.reduce((sum, x) => sum + toNumber(x.amount), 0);
  const driverPayTotal = state.pay.reduce((sum, x) => sum + netPay(x), 0);
  const profit = incomeTotal - expenseTotal - driverPayTotal;

  const cards = [];

  if (canViewIncome) {
    cards.push({ label: "Truck Income", value: money(incomeTotal) });
  }

  if (canViewExpense) {
    cards.push({ label: "Truck Expense", value: money(expenseTotal) });
  }

  if (canViewPay) {
    cards.push({ label: "Driver Pay", value: money(driverPayTotal) });
  }

  if (canViewProfit) {
    cards.push({ label: "Profit", value: money(profit) });
  }

  stats.style.display = "grid";
  stats.innerHTML = cards.map((s) => `<article class='stat-card'><p>${s.label}</p><h3>${s.value}</h3></article>`).join("");
}

function drawWeeklySummary() {
  const panel = document.getElementById("weeklyProfitPanel");
  const { canViewProfit } = getFinanceDashboardAccess();

  if (!canViewProfit) {
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
  const currentIncomeBatchDate = incomeBatchDate(formatDateKey(new Date()));
  const latestIncomeBatchDate = state.income.reduce((latest, item) => {
    const current = incomeBatchDate(item.incomeDate);
    if (!current) return latest;
    return !latest || current > latest ? current : latest;
  }, "");
  const defaultIncomeBatchDate = state.income.some((item) => incomeBatchDate(item.incomeDate) === currentIncomeBatchDate)
    ? currentIncomeBatchDate
    : latestIncomeBatchDate;
  const filtered = state.income.filter((item) => {
    if (!query) return !defaultIncomeBatchDate || incomeBatchDate(item.incomeDate) === defaultIncomeBatchDate;
    const hay = `${item.incomeDate} ${item.truckNumber} ${item.jobRef} ${item.client} ${item.status} ${item.notes || ""}`.toLowerCase();
    return hay.includes(query);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan='7' class='empty'>${query ? "No income records match your search." : "No truck income records for the current Thursday batch. Use search to find older income history."}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .sort((a, b) => {
      if (a.incomeDate !== b.incomeDate) return a.incomeDate < b.incomeDate ? 1 : -1;
      return String(a.truckNumber || "").localeCompare(String(b.truckNumber || ""));
    })
    .map((item) => `<tr><td>${item.incomeDate}</td><td>${item.truckNumber}</td><td>${item.jobRef}</td><td>${item.client}</td><td>${money(item.amount)}</td><td>${item.status}</td><td>${auth.can("editTruckIncome") ? `<div class='table-actions'><button data-action='edit-income' data-id='${item.id}'>Edit</button><button data-action='delete-income' data-id='${item.id}'>Delete</button></div>` : "<span class='muted'>View only</span>"}</td></tr>`)
    .join("");
}

function syncIncomeDateToFinanceWeek() {
  const incomeIdInput = document.getElementById("incomeId");
  const incomeDateInput = document.getElementById("incomeDate");
  if (!incomeIdInput || !incomeDateInput) return;
  if (incomeIdInput.value) return;
  const currentBatchDate = incomeBatchDate(formatDateKey(new Date()));
  if (!currentBatchDate) return;
  incomeDateInput.value = currentBatchDate;
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
  const currentFinanceWeek = weekKey(formatDateKey(new Date()));
  const filtered = state.expense.filter((item) => {
    if (!query) return !currentFinanceWeek || weekKey(item.date) === currentFinanceWeek;
    const hay = `${item.date} ${item.truckNumber || ""} ${item.category} ${item.vendor} ${item.notes || ""}`.toLowerCase();
    return hay.includes(query);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan='7' class='empty'>${query ? "No expense records match your search." : "No truck expense records for this Thursday-to-Wednesday week. Use search to find older expenses."}</td></tr>`;
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
  const selectedPayWeekKey = mondayKeyFrom(document.getElementById("payRosterWeekStart")?.value || formatDateKey(new Date()));
  const selectedPayPeriod = payPeriodFromPayWeekKey(selectedPayWeekKey);
  const filtered = state.pay.filter((item) => {
    if (!query) return !selectedPayPeriod || item.payPeriod === selectedPayPeriod;
    const hay = `${item.driver} ${item.truckNumber || ""} ${item.payPeriod} ${item.paymentDate} ${item.autoPay || ""} ${item.autoPayRef || ""}`.toLowerCase();
    return hay.includes(query);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan='15' class='empty'>${query ? "No driver pay records match your search." : "No driver pay records for the selected week. Use search to find older payslips."}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .sort((a, b) => a.paymentDate < b.paymentDate ? 1 : -1)
    .map((item) => `<tr><td>${item.driver}</td><td>${item.truckNumber || "-"}</td><td>${item.payPeriod}</td><td>${item.daysWorked ?? item.hoursWorked ?? 0}</td><td>${money(item.dailyRate ?? item.hourlyRate ?? 0)}</td><td>${item.nightRunDrops ?? 0}</td><td>${money(item.dropRate ?? NIGHT_DROP_DEFAULT_RATE)}</td><td>${money((Number(item.nightRunDrops ?? 0) * NIGHT_DROP_DEFAULT_RATE))}</td><td>${money(item.driverBonus ?? 0)}</td><td>${money(item.deductions)}</td><td>${money(netPay(item))}</td><td>${item.paymentDate}</td><td>${item.autoPay ?? "No"}</td><td>${item.autoPayRef || "-"}</td><td>${renderPayActions(item)}</td></tr>`)
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
  if (!auth.can("viewReports")) {
    const reportsLink = document.getElementById("reportsLink");
    if (reportsLink) reportsLink.style.display = "none";
  }
  if (!auth.can("accessLogs")) document.querySelector("a[href='./log.html']").style.display = "none";
  if (!(auth.can("viewSpending") || auth.can("editSpending") || auth.can("accessControlPanel"))) {
    const receiptsLink = document.getElementById("receiptsLink");
    if (receiptsLink) receiptsLink.style.display = "none";
  }
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
  const incomeDateValue = document.getElementById("incomeDate").value;
  const payload = {
    id: id || uid(),
    incomeDate: incomeBatchDate(incomeDateValue) || incomeDateValue,
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
  syncIncomeDateToFinanceWeek();
});

document.getElementById("cancelExpenseEdit").addEventListener("click", () => {
  document.getElementById("expenseForm").reset();
  document.getElementById("expenseId").value = "";
});

document.getElementById("cancelPayEdit").addEventListener("click", () => {
  document.getElementById("payForm").reset();
  document.getElementById("payId").value = "";
  document.getElementById("nightRunPay").value = "0.00";
  syncPayDateToRosterWeek();
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

document.getElementById("generatePayFromRoster").addEventListener("click", () => {
  void generatePayFromRosterWeek();
});
document.getElementById("payRosterWeekStart").addEventListener("change", syncPayDateToRosterWeek);

document.getElementById("incomeSearch").addEventListener("input", scheduleFinanceRefresh);
document.getElementById("incomeSearch").addEventListener("search", scheduleFinanceRefresh);
document.getElementById("expenseSearch").addEventListener("input", scheduleFinanceRefresh);
document.getElementById("expenseSearch").addEventListener("search", scheduleFinanceRefresh);
document.getElementById("paySearch").addEventListener("input", scheduleFinanceRefresh);
document.getElementById("paySearch").addEventListener("search", scheduleFinanceRefresh);
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
    return;
  }

  if (action === "email-pay" && auth.can("viewPayslips")) {
    const item = state.pay.find((x) => x.id === id);
    if (!item) return;
    void sendPayslipEmail(item);
    return;
  }

  if (action === "whatsapp-pay" && auth.can("viewPayslips")) {
    const item = state.pay.find((x) => x.id === id);
    if (!item) return;
    openPayslipContact("whatsapp", item);
  }
});

applyAccess();
document.getElementById("nightRunPay").value = "0.00";
const latestSavedRosterWeek = latestRosterWeekKey(readRosterRows(), false);
const initialPayWeekKey = shiftWeekKey(latestSavedRosterWeek, PAYROLL_LAG_WEEKS) || mondayKeyFrom(formatDateKey(new Date()));
if (initialPayWeekKey) {
  document.getElementById("payRosterWeekStart").value = initialPayWeekKey;
}
syncIncomeDateToFinanceWeek();
syncPayDateToRosterWeek();
document.getElementById("payTruckNumber").addEventListener("change", applyConfiguredRatesIfMatch);
document.getElementById("payTruckNumber").addEventListener("blur", applyConfiguredRatesIfMatch);
document.getElementById("nightRunDrops").addEventListener("input", updateNightRunPayPreview);
document.getElementById("nightRunDrops").addEventListener("change", updateNightRunPayPreview);
refresh();
if (!restoreFinanceSyncStatus()) {
  setFinanceSyncStatus(isSupabaseReady() ? "Shared finance sync ready." : "Local-only mode on this device.", isSupabaseReady() ? "neutral" : "local", { persist: false });
}
void hydrateFinanceFromSupabase();
void hydratePayslipEmailStatus();

if (!isSupabaseReady()) {
  window.addEventListener("opx:supabase-ready", () => {
    void hydrateFinanceFromSupabase();
  }, { once: true });
  window.setTimeout(() => {
    if (isSupabaseReady()) {
      void hydrateFinanceFromSupabase();
    }
  }, 1500);
}

window.addEventListener("storage", (event) => {
  if (!event.key) return;
  if (event.key === KEYS.income) state.income = readData(KEYS.income);
  if (event.key === KEYS.expense) state.expense = readData(KEYS.expense);
  if (event.key === KEYS.pay) state.pay = readData(KEYS.pay);
  if (event.key === DRIVERS_KEY || event.key === ROSTER_KEY || event.key === KEYS.income || event.key === KEYS.expense || event.key === KEYS.pay) {
    const source = financeSourceForKey(event.key);
    const message = FINANCE_SOURCE_BY_KEY[event.key]
      ? `${source} updated in another tab.`
      : "Finance data updated in another tab.";
    setFinanceSyncStatus(message, "neutral", { source: FINANCE_SOURCE_BY_KEY[event.key] ? source : "Finance" });
    refresh();
  }
});

window.addEventListener("offline", updateFinanceQueueBanner);

window.addEventListener("online", () => {
  if (!isSupabaseReady()) return;
  const retryKeys = Object.values(KEYS).filter((key) => financeRetryAttempts.has(key) || financeRetryTimers.has(key));
  if (retryKeys.length) {
    const source = retryKeys.length === 1 ? financeSourceForKey(retryKeys[0]) : "Finance";
    const message = retryKeys.length === 1
      ? `Back online. Retrying shared ${source.toLowerCase()} sync...`
      : "Back online. Retrying shared finance sync...";
    setFinanceSyncStatus(message, "syncing", { source });
    retryKeys.forEach((key) => {
      clearFinanceSyncRetry(key, false);
      scheduleFinanceSync(key, readData(key), 0);
    });
    return;
  }
  updateFinanceQueueBanner();
});
