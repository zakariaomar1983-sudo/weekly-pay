(function emergencyFill() {
  function readRows(key) {
    try {
      const rows = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  function fillDrivers() {
    const tbody = document.getElementById("driversTableBody");
    if (!tbody || tbody.children.length) return;
    const rows = readRows("transport_crm_drivers");
    if (!rows.length) return;
    tbody.innerHTML = rows.map((d) => (
      `<tr><td>${d.name || ""}</td><td>${d.phone || ""}</td><td>${d.licenseNumber || ""}</td><td>${d.licenseExpiry || ""}</td><td>${d.status || ""}</td><td>${d.emergencyContact || "-"}</td><td><span class='muted'>Loaded</span></td></tr>`
    )).join("");
  }

  function fillTrucks() {
    const tbody = document.getElementById("trucksTableBody");
    if (!tbody || tbody.children.length) return;
    const rows = readRows("transport_crm_trucks");
    if (!rows.length) return;
    tbody.innerHTML = rows.map((t) => (
      `<tr><td>${t.truckNumber || ""}</td><td>${t.registration || ""}</td><td>${t.model || ""}</td><td>${t.capacity ?? ""}</td><td>${t.serviceDueDate || ""}</td><td>${t.regoExpiryDate || ""}</td><td>${t.status || ""}</td><td><div class='table-actions table-actions-stack'><button type='button' data-fallback-truck-action='edit' data-id='${t.id || ""}'>Edit</button><button type='button' data-fallback-truck-action='delete' data-id='${t.id || ""}'>Delete</button></div></td></tr>`
    )).join("");
  }

  function installTruckFallback() {
    if (window.__opxTruckFallbackInstalled || window.__opxTrucksPageBooted) return;

    const tbody = document.getElementById("trucksTableBody");
    const form = document.getElementById("trucksForm");
    const search = document.getElementById("trucksSearch");
    const clearBtn = document.getElementById("clearTrucksFilters");
    const info = document.getElementById("trucksInfo");
    const exportBtn = document.getElementById("exportTrucks");
    const cancelBtn = document.getElementById("cancelTruckEdit");

    if (!tbody || !form) return;
    window.__opxTruckFallbackInstalled = true;

    const key = "transport_crm_trucks";

    function readTrucks() {
      return readRows(key).map((row) => ({
        id: String(row.id || `${Date.now()}${Math.random().toString(36).slice(2, 7)}`),
        truckNumber: String(row.truckNumber || ""),
        registration: String(row.registration || ""),
        model: String(row.model || ""),
        capacity: Number(row.capacity || 0),
        serviceDueDate: String(row.serviceDueDate || ""),
        regoExpiryDate: String(row.regoExpiryDate || ""),
        status: String(row.status || ""),
        notes: String(row.notes || "")
      }));
    }

    function writeTrucks(rows) {
      localStorage.setItem(key, JSON.stringify(rows));
    }

    function currentRows() {
      return readTrucks();
    }

    function currentQuery() {
      return String(search?.value || "").trim().toLowerCase();
    }

    function buildHaystack(row) {
      return [
        row.truckNumber,
        row.registration,
        row.model,
        row.capacity,
        row.serviceDueDate,
        row.regoExpiryDate,
        row.status,
        row.notes
      ].join(" ").toLowerCase();
    }

    function findBestMatch(query) {
      const normalized = String(query || "").trim().toLowerCase();
      if (!normalized) return null;
      const rows = currentRows().filter((row) => buildHaystack(row).includes(normalized));
      if (!rows.length) return null;
      const exact = rows.find((row) => String(row.truckNumber || "").trim().toLowerCase() === normalized)
        || rows.find((row) => String(row.registration || "").trim().toLowerCase() === normalized);
      return exact || rows[0];
    }

    function clearForm() {
      form.reset();
      const idField = document.getElementById("truckDetailsId");
      if (idField) idField.value = "";
    }

    function fillForm(row) {
      document.getElementById("truckDetailsId").value = row.id;
      document.getElementById("truckDetailsNumber").value = row.truckNumber;
      document.getElementById("truckRegistration").value = row.registration;
      document.getElementById("truckModel").value = row.model;
      document.getElementById("truckCapacity").value = row.capacity;
      document.getElementById("serviceDueDate").value = row.serviceDueDate;
      document.getElementById("regoExpiryDate").value = row.regoExpiryDate;
      document.getElementById("truckStatus").value = row.status || "Available";
      document.getElementById("truckNotes").value = row.notes || "";
    }

    function renderTruckRows(message = "") {
      const rows = currentRows();
      const query = currentQuery();
      const filtered = rows.filter((row) => {
        if (!query) return true;
        return buildHaystack(row).includes(query);
      });

      if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan='8' class='empty'>${rows.length ? "No trucks match this search." : "No trucks yet."}</td></tr>`;
      } else {
        tbody.innerHTML = filtered.map((row) => (
          `<tr><td>${row.truckNumber}</td><td>${row.registration}</td><td>${row.model}</td><td>${row.capacity}</td><td>${row.serviceDueDate}</td><td>${row.regoExpiryDate}</td><td>${row.status}</td><td><div class='table-actions table-actions-stack'><button type='button' data-fallback-truck-action='edit' data-id='${row.id}'>Edit</button><button type='button' data-fallback-truck-action='delete' data-id='${row.id}'>Delete</button></div></td></tr>`
        )).join("");
      }

      if (info) {
        info.textContent = message || (query
          ? `${filtered.length} of ${rows.length} truck record(s) match "${search.value.trim()}".`
          : (rows.length ? `${rows.length} truck record(s) loaded.` : "No trucks saved yet."));
      }

      if (exportBtn) {
        exportBtn.disabled = rows.length === 0;
      }
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const rows = currentRows();
      const id = String(document.getElementById("truckDetailsId").value || "");
      const payload = {
        id: id || `${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
        truckNumber: String(document.getElementById("truckDetailsNumber").value || "").trim(),
        registration: String(document.getElementById("truckRegistration").value || "").trim(),
        model: String(document.getElementById("truckModel").value || "").trim(),
        capacity: Number(document.getElementById("truckCapacity")?.value || 0),
        serviceDueDate: String(document.getElementById("serviceDueDate")?.value || ""),
        regoExpiryDate: String(document.getElementById("regoExpiryDate")?.value || ""),
        status: String(document.getElementById("truckStatus")?.value || "Available"),
        notes: String(document.getElementById("truckNotes")?.value || "").trim()
      };

      const next = id ? rows.map((row) => row.id === id ? payload : row) : [...rows, payload];
      writeTrucks(next);
      clearForm();
      renderTruckRows("Truck record saved.");
    });

    cancelBtn?.addEventListener("click", () => {
      clearForm();
      renderTruckRows();
    });

    exportBtn?.addEventListener("click", () => {
      const rows = currentRows();
      if (!rows.length) return;
      const headers = ["truckNumber", "registration", "model", "capacity", "serviceDueDate", "regoExpiryDate", "status", "notes"];
      const csv = [headers.join(",")].concat(rows.map((row) => headers.map((keyName) => `"${String(row[keyName] ?? "").replaceAll('"', '""')}"`).join(","))).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "trucks.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    });

    search?.addEventListener("input", () => {
      const match = findBestMatch(search.value);
      if (match) fillForm(match);
      renderTruckRows(match ? `Loaded truck ${match.truckNumber} from search.` : `No truck found for "${search.value.trim()}".`);
    });
    search?.addEventListener("change", () => {
      const match = findBestMatch(search.value);
      if (match) fillForm(match);
      renderTruckRows(match ? `Loaded truck ${match.truckNumber} from search.` : `No truck found for "${search.value.trim()}".`);
    });
    search?.addEventListener("search", () => {
      const match = findBestMatch(search.value);
      if (match) fillForm(match);
      renderTruckRows(match ? `Loaded truck ${match.truckNumber} from search.` : `No truck found for "${search.value.trim()}".`);
    });
    clearBtn?.addEventListener("click", () => {
      if (search) search.value = "";
      clearForm();
      renderTruckRows();
    });

    tbody.addEventListener("click", (event) => {
      const button = event.target.closest("[data-fallback-truck-action]");
      if (!button) return;
      const action = button.getAttribute("data-fallback-truck-action");
      const id = button.getAttribute("data-id");
      const rows = currentRows();
      const row = rows.find((item) => item.id === id);
      if (!row) return;

      if (action === "edit") {
        fillForm(row);
        renderTruckRows(`Editing truck ${row.truckNumber}.`);
        return;
      }

      if (action === "delete") {
        if (!window.confirm(`Delete truck ${row.truckNumber}?`)) return;
        writeTrucks(rows.filter((item) => item.id !== id));
        clearForm();
        renderTruckRows(`Deleted truck ${row.truckNumber}.`);
      }
    });

    renderTruckRows();
  }

  function fillFinance() {
    const incomeBody = document.getElementById("incomeTableBody");
    const expenseBody = document.getElementById("expenseTableBody");
    const payBody = document.getElementById("payTableBody");

    if (incomeBody && !incomeBody.children.length) {
      const income = readRows("transport_crm_truck_income");
      if (income.length) {
        incomeBody.innerHTML = income.map((x) => (
          `<tr><td>${x.incomeDate || ""}</td><td>${x.truckNumber || ""}</td><td>${x.jobRef || ""}</td><td>${x.client || ""}</td><td>$${Number(x.amount || 0).toFixed(2)}</td><td>${x.status || ""}</td><td><span class='muted'>Loaded</span></td></tr>`
        )).join("");
      }
    }

    if (expenseBody && !expenseBody.children.length) {
      const expense = readRows("transport_crm_spending");
      if (expense.length) {
        expenseBody.innerHTML = expense.map((x) => (
          `<tr><td>${x.date || ""}</td><td>${x.truckNumber || ""}</td><td>${x.category || ""}</td><td>$${Number(x.amount || 0).toFixed(2)}</td><td>${x.vendor || ""}</td><td>${x.notes || ""}</td><td><span class='muted'>Loaded</span></td></tr>`
        )).join("");
      }
    }

    if (payBody && !payBody.children.length) {
      const pay = readRows("transport_crm_payslips");
      if (pay.length) {
        payBody.innerHTML = pay.map((x) => (
          `<tr><td>${x.driver || ""}</td><td>${x.truckNumber || ""}</td><td>${x.payPeriod || ""}</td><td>${x.daysWorked ?? 0}</td><td>$${Number(x.dailyRate || 0).toFixed(2)}</td><td>${x.nightRunDrops ?? 0}</td><td>$${Number(x.dropRate || 90).toFixed(2)}</td><td>$${Number(x.nightRunPay || 0).toFixed(2)}</td><td>$${Number(x.driverBonus || 0).toFixed(2)}</td><td>$${Number(x.deductions || 0).toFixed(2)}</td><td>$0.00</td><td>${x.paymentDate || ""}</td><td>${x.autoPay || ""}</td><td>${x.autoPayRef || ""}</td><td><span class='muted'>Loaded</span></td></tr>`
        )).join("");
      }
    }
  }

  function run() {
    fillDrivers();
    fillTrucks();
    fillFinance();
    installTruckFallback();
  }

  setTimeout(run, 600);
  setTimeout(run, 1500);
})();

(function fixDriverPayRosterWeekDate() {
  if (window.__opxDriverPayRosterWeekFix) return;
  window.__opxDriverPayRosterWeekFix = true;

  const ROSTER_KEY = "transport_crm_roster";
  const PAY_KEY = "transport_crm_payslips";
  const DROP_RATE = 90;
  const DAILY_RATE_BY_TRUCK_NUMBER = {
    "881": 330,
    "853": 330,
    "855": 330,
    "840": 325,
    "841": 325,
    "672": 320,
    "620": 320
  };

  function readRows(key) {
    try {
      const rows = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  function writeRows(key, rows) {
    localStorage.setItem(key, JSON.stringify(rows));
    try {
      window.dispatchEvent(new StorageEvent("storage", { key }));
    } catch {
      window.dispatchEvent(new Event("storage"));
    }
  }

  function uid() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `${Date.now()}${Math.random().toString(16).slice(2, 10)}`;
  }

  function parseDateKey(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const baseDate = raw.includes(" - ") ? raw.split(" - ")[0].trim() : raw;
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

  function formatDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function mondayKeyFrom(value) {
    const date = parseDateKey(value);
    if (!date) return "";
    const shift = (date.getDay() - 1 + 7) % 7;
    const start = new Date(date);
    start.setDate(date.getDate() - shift);
    start.setHours(0, 0, 0, 0);
    return formatDateKey(start);
  }

  function shiftWeekKey(weekKey, offsetWeeks) {
    const start = parseDateKey(weekKey);
    if (!start) return "";
    const shifted = new Date(start);
    shifted.setDate(start.getDate() + (Number(offsetWeeks || 0) * 7));
    return formatDateKey(shifted);
  }

  function paymentDateFromRosterWeekKey(rosterWeekKey) {
    const start = parseDateKey(rosterWeekKey);
    if (!start) return "";
    const thursday = new Date(start);
    thursday.setDate(start.getDate() + 3);
    return formatDateKey(thursday);
  }

  function payPeriodFromRosterWeekKey(rosterWeekKey) {
    const start = parseDateKey(rosterWeekKey);
    if (!start) return "";
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const fmt = { day: "2-digit", month: "short", year: "numeric" };
    return `${start.toLocaleDateString("en-AU", fmt)} - ${end.toLocaleDateString("en-AU", fmt)}`;
  }

  function normalizeStatus(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeRosterRow(row) {
    const raw = row && typeof row === "object" ? row : {};
    const runType = String(raw.runType || raw.run_type || "").trim().toLowerCase();
    return {
      id: raw.id || "",
      driverName: raw.driverName || raw.driver_name || "",
      truckNumber: raw.truckNumber || raw.truck_number || "",
      shiftDate: raw.shiftDate || raw.shift_date || "",
      status: raw.status || "Scheduled",
      nightRun: Boolean(raw.nightRun) || runType === "night run" || runType === "night run +"
    };
  }

  function dedupeRosterRows(rows) {
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
      if (normalizeStatus(row.status) === "completed" && normalizeStatus(existing.status) !== "completed") {
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

  async function getRosterRows() {
    const localRows = dedupeRosterRows(readRows(ROSTER_KEY).map(normalizeRosterRow));
    const supabase = window.OPXSupabase?.client || null;
    if (window.OPXSupabase?.isReady && supabase) {
      const { data, error } = await supabase.from("roster").select("*");
      if (!error && Array.isArray(data) && data.length) {
        return dedupeRosterRows(data.map(normalizeRosterRow));
      }
    }
    return localRows;
  }

  function latestRosterWeekKey(rows, completedOnly = false) {
    return rows.reduce((latest, row) => {
      if (completedOnly && normalizeStatus(row.status) !== "completed") return latest;
      const key = mondayKeyFrom(row.shiftDate);
      if (!key) return latest;
      return !latest || key > latest ? key : latest;
    }, "");
  }

  function setStatus(message, tone = "muted") {
    const status = document.getElementById("payGenerationStatus");
    if (!status) return;
    status.textContent = message;
    status.className = `data-status full ${tone}`.trim();
  }

  function syncPaymentDateToRosterWeek() {
    const weekStartInput = document.getElementById("payRosterWeekStart");
    const paymentDateInput = document.getElementById("paymentDate");
    const payIdInput = document.getElementById("payId");
    if (!weekStartInput || !paymentDateInput || !payIdInput || payIdInput.value) return;
    const rosterWeekKey = mondayKeyFrom(weekStartInput.value || formatDateKey(new Date()));
    if (rosterWeekKey) paymentDateInput.value = paymentDateFromRosterWeekKey(rosterWeekKey);
  }

  function toDbPay(item) {
    return {
      id: item.id,
      driver: item.driver || "",
      truck_number: item.truckNumber || "",
      pay_period: item.payPeriod || "",
      days_worked: Number(item.daysWorked || 0),
      daily_rate: Number(item.dailyRate || 0),
      night_run_drops: Number(item.nightRunDrops || 0),
      drop_rate: Number(item.dropRate || DROP_RATE),
      night_run_pay: Number(item.nightRunPay || 0),
      driver_bonus: Number(item.driverBonus || 0),
      deductions: Number(item.deductions || 0),
      payment_date: item.paymentDate || null,
      auto_pay: item.autoPay || "No",
      auto_pay_ref: item.autoPayRef || ""
    };
  }

  async function syncGeneratedRows(rows) {
    const supabase = window.OPXSupabase?.client || null;
    if (!(window.OPXSupabase?.isReady && supabase) || !rows.length) return;
    const { error } = await supabase.from("payslips").upsert(rows.map(toDbPay), { onConflict: "id" });
    if (error) console.error("Driver Pay roster-week sync failed:", error.message);
  }

  // finance.js owns Driver Pay generation when it loaded successfully. Keep
  // this older implementation only as an emergency fallback for script failure.
  if (window.__OPX_FINANCE_MAIN_LOADED) return;

  async function generateFromRosterWeek(event) {
    const button = event.target?.closest?.("#generatePayFromRoster");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const weekStartInput = document.getElementById("payRosterWeekStart");
    const rosterWeekKey = mondayKeyFrom(weekStartInput?.value || formatDateKey(new Date()));
    if (!rosterWeekKey) {
      setStatus("Choose a valid roster week first.", "error-text");
      alert("Choose a valid roster week first.");
      return;
    }

    button.disabled = true;
    setStatus("Checking selected roster week and building Driver Pay from completed shifts...");

    try {
      const rosterRows = await getRosterRows();
      const sourceRows = rosterRows.filter((row) => mondayKeyFrom(row.shiftDate) === rosterWeekKey);
      const completedRows = sourceRows.filter((row) => normalizeStatus(row.status) === "completed");

      if (!completedRows.length) {
        const latestWeek = latestRosterWeekKey(rosterRows, false);
        const message = sourceRows.length
          ? `Roster shifts were found for week ${rosterWeekKey}, but none are marked Completed yet.`
          : (latestWeek ? `No roster shifts were found for selected roster week ${rosterWeekKey}. Latest saved roster week is ${latestWeek}.` : "No roster shifts were found yet. Save the roster week first.");
        setStatus(message, "error-text");
        alert(message);
        return;
      }

      const payPeriod = payPeriodFromRosterWeekKey(rosterWeekKey);
      const paymentDate = paymentDateFromRosterWeekKey(rosterWeekKey);
      const currentPayRows = readRows(PAY_KEY);
      const existingByDriverPeriod = new Map(currentPayRows.map((row) => [`${String(row.driver || "").trim()}__${String(row.payPeriod || "").trim()}`, row]));
      const grouped = new Map();
      completedRows.forEach((row) => {
        const driverName = String(row.driverName || "").trim();
        if (!driverName) return;
        if (!grouped.has(driverName)) grouped.set(driverName, []);
        grouped.get(driverName).push(row);
      });

      const generatedRows = Array.from(grouped.entries()).map(([driverName, driverRows]) => {
        const uniqueWorkedDays = new Set(driverRows.map((row) => row.shiftDate).filter(Boolean));
        const nightRunDrops = driverRows.filter((row) => row.nightRun).length;
        const truckNumber = driverRows.find((row) => row.truckNumber)?.truckNumber || "";
        const existing = existingByDriverPeriod.get(`${driverName}__${payPeriod}`);
        return {
          id: existing?.id || uid(),
          driver: driverName,
          truckNumber,
          payPeriod,
          daysWorked: uniqueWorkedDays.size,
          dailyRate: Number(existing?.dailyRate || DAILY_RATE_BY_TRUCK_NUMBER[truckNumber] || 0),
          nightRunDrops,
          dropRate: DROP_RATE,
          nightRunPay: nightRunDrops * DROP_RATE,
          driverBonus: Number(existing?.driverBonus || 0),
          deductions: Number(existing?.deductions || 0),
          paymentDate: existing?.paymentDate || paymentDate,
          autoPay: existing?.autoPay || "No",
          autoPayRef: existing?.autoPayRef || ""
        };
      }).filter((row) => row.daysWorked > 0);

      const generatedKeys = new Set(generatedRows.map((row) => `${row.driver}__${row.payPeriod}`));
      const nextPayRows = currentPayRows.filter((row) => !generatedKeys.has(`${row.driver}__${row.payPeriod}`)).concat(generatedRows);
      writeRows(PAY_KEY, nextPayRows);
      await syncGeneratedRows(generatedRows);
      syncPaymentDateToRosterWeek();
      const success = `Generated driver pay for ${generatedRows.length} driver${generatedRows.length === 1 ? "" : "s"} from roster week ${rosterWeekKey}.`;
      setStatus(success);
      alert(success);
    } finally {
      button.disabled = false;
    }
  }

  async function correctInitialRosterWeekInput() {
    const input = document.getElementById("payRosterWeekStart");
    if (!input) return;
    const rows = await getRosterRows();
    const latestWeek = latestRosterWeekKey(rows, false);
    if (!latestWeek) return;
    const currentKey = mondayKeyFrom(input.value || "");
    if (!currentKey || currentKey === shiftWeekKey(latestWeek, 1)) {
      input.value = latestWeek;
      syncPaymentDateToRosterWeek();
      writeRows(PAY_KEY, readRows(PAY_KEY));
    }
  }

  document.addEventListener("click", generateFromRosterWeek, true);
  document.addEventListener("change", (event) => {
    if (event.target?.id === "payRosterWeekStart") syncPaymentDateToRosterWeek();
  }, true);
  setTimeout(correctInitialRosterWeekInput, 800);
  setTimeout(correctInitialRosterWeekInput, 1800);
})();
