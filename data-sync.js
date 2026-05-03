(function opxDataSyncBootstrap() {
  if (window.__opxDataSyncLoaded) return;
  window.__opxDataSyncLoaded = true;

  const STORAGE_KEYS = {
    drivers: "transport_crm_drivers",
    trucks: "transport_crm_trucks",
    roster: "transport_crm_roster",
    income: "transport_crm_truck_income",
    expense: "transport_crm_spending",
    payslips: "transport_crm_payslips",
    logs: "transport_crm_logs"
  };

  function normalizeDateKey(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})T/);
    if (isoMatch?.[1]) return isoMatch[1];
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return text;
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function getSupabaseClient() {
    return window.OPXSupabase?.client || null;
  }

  function isSupabaseReady() {
    return Boolean(window.OPXSupabase?.isReady && getSupabaseClient());
  }

  function writeRows(key, rows) {
    if (!Array.isArray(rows) || rows.length === 0) return false;
    localStorage.setItem(key, JSON.stringify(rows));
    return true;
  }

  function mapDrivers(rows) {
    return rows.map((row) => ({
      id: row.id,
      name: row.name || "",
      phone: row.phone || "",
      email: row.email || "",
      licenseNumber: row.license_number || "",
      licenseExpiry: row.license_expiry || "",
      hireDate: row.hire_date || "",
      status: row.status || "",
      address: row.address || "",
      emergencyContact: row.emergency_contact || ""
    }));
  }

  function mapTrucks(rows) {
    return rows.map((row) => ({
      id: row.id,
      truckNumber: row.truck_number || "",
      registration: row.registration || "",
      model: row.model || "",
      capacity: Number(row.capacity || 0),
      serviceDueDate: row.service_due_date || "",
      regoExpiryDate: row.rego_expiry_date || "",
      status: row.status || "",
      notes: row.notes || ""
    }));
  }

  function mapRoster(rows) {
    return rows.map((row) => ({
      id: row.id,
      driverName: row.driver_name || "",
      truckNumber: row.truck_number || "",
      shiftDate: normalizeDateKey(row.shift_date || ""),
      shiftTime: row.shift_time || "",
      route: row.route || "",
      status: row.status || ""
    }));
  }

  function mapIncome(rows) {
    return rows.map((row) => ({
      id: row.id,
      incomeDate: row.income_date || "",
      truckNumber: row.truck_number || "",
      jobRef: row.job_ref || "",
      client: row.client || "",
      amount: Number(row.amount || 0),
      status: row.status || "",
      notes: row.notes || ""
    }));
  }

  function mapExpense(rows) {
    return rows.map((row) => ({
      id: row.id,
      date: row.expense_date || "",
      truckNumber: row.truck_number || "",
      category: row.category || "",
      amount: Number(row.amount || 0),
      vendor: row.vendor || "",
      notes: row.notes || ""
    }));
  }

  function mapPayslips(rows) {
    return rows.map((row) => ({
      id: row.id,
      driver: row.driver || "",
      truckNumber: row.truck_number || "",
      payPeriod: row.pay_period || "",
      daysWorked: Number(row.days_worked || 0),
      dailyRate: Number(row.daily_rate || 0),
      nightRunDrops: Number(row.night_run_drops || 0),
      dropRate: Number(row.drop_rate || 90),
      nightRunPay: Number(row.night_run_pay || 0),
      driverBonus: Number(row.driver_bonus || 0),
      deductions: Number(row.deductions || 0),
      paymentDate: row.payment_date || "",
      autoPay: row.auto_pay || "No",
      autoPayRef: row.auto_pay_ref || ""
    }));
  }

  function mapLogs(rows) {
    return rows.map((row) => ({
      id: row.id,
      logDate: row.log_date || "",
      logType: row.log_type || "",
      driver: row.driver || "",
      truck: row.truck_number || "",
      reference: row.reference || "",
      status: row.status || "",
      description: row.description || ""
    }));
  }

  async function syncAllFromSupabase() {
    if (!isSupabaseReady()) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const [
      driversRes,
      trucksRes,
      rosterRes,
      incomeRes,
      expenseRes,
      payslipsRes,
      logsRes
    ] = await Promise.all([
      supabase.from("drivers").select("*"),
      supabase.from("trucks").select("*"),
      supabase.from("roster").select("*"),
      supabase.from("truck_income").select("*"),
      supabase.from("truck_expense").select("*"),
      supabase.from("payslips").select("*"),
      supabase.from("app_logs").select("*")
    ]);

    const touched = [];

    if (!driversRes.error && writeRows(STORAGE_KEYS.drivers, mapDrivers(driversRes.data || []))) touched.push(STORAGE_KEYS.drivers);
    if (!trucksRes.error && writeRows(STORAGE_KEYS.trucks, mapTrucks(trucksRes.data || []))) touched.push(STORAGE_KEYS.trucks);
    if (!rosterRes.error && writeRows(STORAGE_KEYS.roster, mapRoster(rosterRes.data || []))) touched.push(STORAGE_KEYS.roster);
    if (!incomeRes.error && writeRows(STORAGE_KEYS.income, mapIncome(incomeRes.data || []))) touched.push(STORAGE_KEYS.income);
    if (!expenseRes.error && writeRows(STORAGE_KEYS.expense, mapExpense(expenseRes.data || []))) touched.push(STORAGE_KEYS.expense);
    if (!payslipsRes.error && writeRows(STORAGE_KEYS.payslips, mapPayslips(payslipsRes.data || []))) touched.push(STORAGE_KEYS.payslips);
    if (!logsRes.error && writeRows(STORAGE_KEYS.logs, mapLogs(logsRes.data || []))) touched.push(STORAGE_KEYS.logs);

    if (touched.length) {
      window.dispatchEvent(new CustomEvent("opx:data-synced", { detail: { keys: touched } }));
    }
  }

  if (isSupabaseReady()) {
    void syncAllFromSupabase();
  }

  window.addEventListener("opx:supabase-ready", () => {
    void syncAllFromSupabase();
  });
})();
