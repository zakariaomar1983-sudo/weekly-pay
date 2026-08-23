(function () {
  const auth = window.OPXAuth?.requireAuth("./login.html");
  if (!auth || !auth.can("accessDriverReports")) {
    document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>Your account does not have access to driver reports.</p></section></main>";
    return;
  }

  const KEY = "transport_crm_driver_reports";
  const ROSTER_KEY = "transport_crm_roster";
  const DRIVERS_KEY = "transport_crm_drivers";
  const ROUTE_LOCATION_SEPARATOR = "|||opx-start-location|||";
  const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const LOGIN_DRIVER_ALIASES = new Map([
    ["abdirazak", "abdirizak ahmed"],
    ["samatar", "samatar yusuf"]
  ]);
  const isReviewer = auth.can("accessCRM") || auth.can("accessControlPanel");
  const canChooseRosterDriver = auth.can("accessControlPanel") || auth.can("editRoster");
  const byId = (id) => document.getElementById(id);
  const read = () => { try { const value = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };
  const readRows = (key) => { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };
  const write = (value) => { localStorage.setItem(KEY, JSON.stringify(value)); window.dispatchEvent(new CustomEvent("opx:driver-reports-updated")); };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;", "'":"&#039;"}[char]));
  const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const today = () => dateKey(new Date());
  let reports = read();
  let rosterRows = readRows(ROSTER_KEY);
  let driverRows = readRows(DRIVERS_KEY);
  let selectedRosterDriver = "";
  let sharedSync = false;

  byId("currentUserChip").textContent = `User: ${auth.user.username}`;
  byId("historyTitle").textContent = isReviewer ? "Driver Reports" : "My Reports";
  byId("reportDate").value = today();
  if (!isReviewer) byId("reportDate").min = today();
  if (!auth.can("viewRoster")) {
    byId("fullRosterLink").hidden = true;
    byId("fullRosterLink").style.display = "none";
  }

  function parseDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    date.setHours(0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function addDays(value, amount) {
    const date = value instanceof Date ? new Date(value) : parseDate(value);
    if (!date) return null;
    date.setDate(date.getDate() + Number(amount || 0));
    return date;
  }

  function mondayKey(value = new Date()) {
    const date = value instanceof Date ? new Date(value) : parseDate(value);
    if (!date) return "";
    const shift = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - shift);
    return dateKey(date);
  }

  function normalizeName(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ");
  }

  function firstNameDistance(left, right) {
    const a = String(left || "");
    const b = String(right || "");
    const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let row = 0; row <= a.length; row += 1) matrix[row][0] = row;
    for (let column = 0; column <= b.length; column += 1) matrix[0][column] = column;
    for (let row = 1; row <= a.length; row += 1) {
      for (let column = 1; column <= b.length; column += 1) {
        const cost = a[row - 1] === b[column - 1] ? 0 : 1;
        matrix[row][column] = Math.min(
          matrix[row - 1][column] + 1,
          matrix[row][column - 1] + 1,
          matrix[row - 1][column - 1] + cost
        );
      }
    }
    return matrix[a.length][b.length];
  }

  function unpackRoute(value) {
    const text = String(value || "").trim();
    const parts = text.split(ROUTE_LOCATION_SEPARATOR);
    if (parts.length === 1) return { route: text, startLocation: "" };
    const [startLocation = "", ...routeParts] = parts;
    return { route: routeParts.join(ROUTE_LOCATION_SEPARATOR).trim(), startLocation: startLocation.trim() };
  }

  function normalizeRosterRow(row) {
    const unpacked = unpackRoute(row.route || "");
    const runType = String(row.run_type || row.runType || "").toLowerCase();
    return {
      id: row.id || "",
      driverName: row.driverName || row.driver_name || "",
      truckNumber: row.truckNumber || row.truck_number || "",
      shiftDate: row.shiftDate || row.shift_date || "",
      shiftTime: row.shiftTime || row.shift_time || "",
      startLocation: row.startLocation || unpacked.startLocation,
      route: unpacked.route,
      nightRun: Boolean(row.nightRun) || runType.includes("night"),
      status: row.status || "Scheduled"
    };
  }

  function normalizeDriverRow(row) {
    return {
      id: row.id || "",
      name: row.name || row.driverName || row.driver_name || "",
      status: row.status || ""
    };
  }

  rosterRows = rosterRows.map(normalizeRosterRow);
  driverRows = driverRows.map(normalizeDriverRow);

  function rosterDriverNames() {
    const names = [
      ...driverRows.filter((row) => String(row.status || "").toLowerCase() !== "inactive").map((row) => row.name),
      ...rosterRows.map((row) => row.driverName)
    ].map((name) => String(name || "").trim()).filter(Boolean);
    const byNormalizedName = new Map();
    names.forEach((name) => {
      const normalized = normalizeName(name);
      if (!byNormalizedName.has(normalized)) byNormalizedName.set(normalized, name);
    });
    return [...byNormalizedName.values()].sort((a, b) => a.localeCompare(b));
  }

  function resolveRosterDriver(loginName, names) {
    const normalizedLogin = normalizeName(loginName);
    if (!normalizedLogin) return "";
    const exact = names.find((name) => normalizeName(name) === normalizedLogin);
    if (exact) return exact;
    const alias = LOGIN_DRIVER_ALIASES.get(normalizedLogin);
    if (alias) {
      const aliasMatch = names.find((name) => normalizeName(name) === alias);
      if (aliasMatch) return aliasMatch;
    }
    const loginFirst = normalizedLogin.split(" ")[0];
    const firstNameMatches = names.filter((name) => normalizeName(name).split(" ")[0] === loginFirst);
    if (firstNameMatches.length === 1) return firstNameMatches[0];
    const fuzzyMatches = names.filter((name) => firstNameDistance(loginFirst, normalizeName(name).split(" ")[0]) <= 1);
    return fuzzyMatches.length === 1 ? fuzzyMatches[0] : "";
  }

  function refreshRosterDriverPicker() {
    const names = rosterDriverNames();
    const resolvedLoginDriver = resolveRosterDriver(auth.user.username, names);
    const previous = selectedRosterDriver || byId("driverRosterDriver").value;
    selectedRosterDriver = names.includes(previous)
      ? previous
      : resolvedLoginDriver || (canChooseRosterDriver ? names[0] || "" : "");
    byId("driverRosterDriver").innerHTML = names.length
      ? names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")
      : "<option value=''>No drivers available</option>";
    byId("driverRosterDriver").value = selectedRosterDriver;
    byId("driverRosterDriverLabel").hidden = !canChooseRosterDriver;
    byId("driverRosterDriverLabel").style.display = canChooseRosterDriver ? "" : "none";
    byId("driverRosterTitle").textContent = canChooseRosterDriver ? "Weekly Roster — Driver View" : "My Weekly Roster";
  }

  function selectedWeekKeys() {
    const start = parseDate(byId("driverRosterWeek").value);
    if (!start) return [];
    return Array.from({ length: 7 }, (_, index) => dateKey(addDays(start, index)));
  }

  function rosterStatusClass(status) {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "completed") return "status-pill status-pill-live";
    if (normalized === "leave" || normalized === "absent") return "status-pill status-pill-warning";
    return "status-pill status-pill-queue";
  }

  function prefillFromTodayRoster(driverWeekRows) {
    if (byId("reportId").value) return;
    const shift = driverWeekRows.find((row) => row.shiftDate === today());
    if (!shift || ["leave", "absent"].includes(String(shift.status || "").toLowerCase())) return;
    if (!byId("truckNumber").value) byId("truckNumber").value = shift.truckNumber || "";
    if (!byId("shiftStart").value && /^\d{1,2}:\d{2}$/.test(shift.shiftTime)) {
      const [hour, minute] = shift.shiftTime.split(":");
      byId("shiftStart").value = `${String(Number(hour)).padStart(2, "0")}:${minute}`;
    }
    if (!byId("jobClient").value) byId("jobClient").value = shift.route || shift.startLocation || "";
  }

  function renderDriverRoster() {
    refreshRosterDriverPicker();
    const weekKeys = selectedWeekKeys();
    const selectedName = byId("driverRosterDriver").value || selectedRosterDriver;
    selectedRosterDriver = selectedName;
    const normalizedSelected = normalizeName(selectedName);
    const matches = rosterRows
      .filter((row) => normalizeName(row.driverName) === normalizedSelected && weekKeys.includes(row.shiftDate))
      .sort((a, b) => String(a.shiftDate).localeCompare(String(b.shiftDate)));
    const latestByDate = new Map();
    matches.forEach((row) => latestByDate.set(row.shiftDate, row));
    const driverWeekRows = [...latestByDate.values()];

    if (!selectedName || weekKeys.length !== 7) {
      byId("driverRosterStatus").textContent = `No roster driver matches the login ${auth.user.username}. Ask the office to match this login to a driver name.`;
      byId("driverRosterStatus").className = "data-status full error-text";
      byId("driverRosterStats").innerHTML = "";
      byId("driverRosterTableBody").innerHTML = "<tr><td colspan='8' class='muted'>Driver roster unavailable.</td></tr>";
      return;
    }

    const weekStart = parseDate(weekKeys[0]);
    const weekEnd = parseDate(weekKeys[6]);
    const activeRows = driverWeekRows.filter((row) => !["leave", "absent"].includes(String(row.status || "").toLowerCase()));
    const completed = driverWeekRows.filter((row) => String(row.status || "").toLowerCase() === "completed").length;
    const nightRuns = activeRows.filter((row) => row.nightRun).length;
    const trucks = [...new Set(activeRows.map((row) => row.truckNumber).filter(Boolean))];
    byId("driverRosterStatus").textContent = `${selectedName} • ${weekStart.toLocaleDateString("en-AU", { day: "2-digit", month: "short" })} to ${weekEnd.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" })}`;
    byId("driverRosterStatus").className = "data-status full muted";
    byId("driverRosterStats").innerHTML = [
      { label: "Rostered Shifts", value: activeRows.length },
      { label: "Completed", value: completed },
      { label: "Night Runs", value: nightRuns },
      { label: "Truck", value: trucks.join(", ") || "—" }
    ].map((item) => `<article class="stat-card"><p>${item.label}</p><h3>${escapeHtml(item.value)}</h3></article>`).join("");

    byId("driverRosterTableBody").innerHTML = weekKeys.map((key, index) => {
      const row = latestByDate.get(key);
      if (!row) return `<tr><td>${DAY_NAMES[index]}</td><td>${key}</td><td colspan="6" class="muted">Off / No shift</td></tr>`;
      const away = ["leave", "absent"].includes(String(row.status || "").toLowerCase());
      return `<tr>
        <td>${DAY_NAMES[index]}</td>
        <td>${escapeHtml(key)}</td>
        <td>${escapeHtml(away ? "—" : row.truckNumber || "—")}</td>
        <td>${escapeHtml(row.shiftTime || "—")}</td>
        <td>${escapeHtml(row.startLocation || "—")}</td>
        <td>${escapeHtml(row.route || "—")}</td>
        <td>${row.nightRun && !away ? "Yes" : "—"}</td>
        <td><span class="${rosterStatusClass(row.status)}">${escapeHtml(row.status || "Scheduled")}</span></td>
      </tr>`;
    }).join("");
    prefillFromTodayRoster(driverWeekRows);
  }

  async function hydrateSharedRoster() {
    const client = window.OPXSupabase?.client;
    if (!client) return false;
    const [rosterResult, driversResult] = await Promise.all([
      client.from("roster").select("*").order("shift_date", { ascending: true }),
      client.from("drivers").select("*").order("name", { ascending: true })
    ]);
    if (rosterResult.error || driversResult.error) {
      byId("driverRosterStatus").textContent = "Shared roster could not be loaded. Showing the roster saved on this device.";
      byId("driverRosterStatus").className = "data-status full error-text";
      renderDriverRoster();
      return false;
    }
    rosterRows = (rosterResult.data || []).map(normalizeRosterRow);
    driverRows = (driversResult.data || []).map(normalizeDriverRow);
    localStorage.setItem(ROSTER_KEY, JSON.stringify(rosterRows));
    localStorage.setItem(DRIVERS_KEY, JSON.stringify(driverRows));
    renderDriverRoster();
    return true;
  }

  function visibleReports() {
    return reports.filter((item) => isReviewer || item.driverUserId === auth.user.id);
  }

  function render() {
    const rows = visibleReports().sort((a, b) => String(b.reportDate).localeCompare(String(a.reportDate)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    byId("reportsTableBody").innerHTML = rows.length ? rows.map((item) => {
      const locked = !isReviewer && item.status === "Submitted";
      const actions = locked ? "<span class='muted'>Locked</span>" : `<button class="btn btn-outline" type="button" data-action="edit" data-id="${escapeHtml(item.id)}">Edit</button> <button class="btn btn-muted" type="button" data-action="delete" data-id="${escapeHtml(item.id)}">Delete</button>`;
      return `<tr><td>${escapeHtml(item.reportDate)}</td><td>${escapeHtml(item.truckNumber)}</td><td>${escapeHtml(item.jobClient || "-")}</td><td>${escapeHtml(item.vehicleCondition)}</td><td><span class="status-pill">${escapeHtml(item.status)}</span></td><td>${escapeHtml(new Date(item.updatedAt).toLocaleString())}</td><td>${actions}</td></tr>`;
    }).join("") : "<tr><td colspan='7' class='muted'>No reports submitted yet.</td></tr>";
  }

  function toRow(item) {
    return { id: item.id, driver_user_id: item.driverUserId, driver_name: item.driverName, report_date: item.reportDate, truck_number: item.truckNumber, shift_start: item.shiftStart || null, shift_finish: item.shiftFinish || null, job_client: item.jobClient || "", delivery_count: item.deliveryCount || 0, fuel_used: item.fuelUsed || 0, vehicle_condition: item.vehicleCondition || "Good", issues: item.issues || "", notes: item.notes || "", status: item.status, updated_at: item.updatedAt };
  }

  function fromRow(row) {
    return { id: row.id, driverUserId: row.driver_user_id, driverName: row.driver_name, reportDate: row.report_date, truckNumber: row.truck_number, shiftStart: row.shift_start || "", shiftFinish: row.shift_finish || "", jobClient: row.job_client || "", deliveryCount: Number(row.delivery_count || 0), fuelUsed: Number(row.fuel_used || 0), vehicleCondition: row.vehicle_condition || "Good", issues: row.issues || "", notes: row.notes || "", status: row.status || "Draft", submittedAt: row.submitted_at || "", updatedAt: row.updated_at || new Date().toISOString() };
  }

  async function hydrateSharedReports() {
    const client = window.OPXSupabase?.client;
    if (!client) return;
    const { data, error } = await client.from("driver_reports").select("*").order("report_date", { ascending: false });
    if (error) { byId("reportStatus").textContent = "Shared reports are not connected yet. Local draft mode is active."; return; }
    const remoteReports = (data || []).map(fromRow);
    if (!remoteReports.length && reports.length) {
      const { error: seedError } = await client.from("driver_reports").upsert(reports.map(toRow), { onConflict: "id" });
      if (seedError) {
        byId("reportStatus").textContent = "Shared reports are connected, but existing drafts could not be migrated yet.";
        return;
      }
      sharedSync = true;
      byId("reportStatus").textContent = "Shared reports connected. Existing drafts were uploaded.";
      render();
      return;
    }
    sharedSync = true; reports = remoteReports; localStorage.setItem(KEY, JSON.stringify(reports)); render();
  }

  async function syncShared(item) {
    const client = window.OPXSupabase?.client;
    if (!client) return;
    const { error } = await client.from("driver_reports").upsert(toRow(item), { onConflict: "id" });
    if (error) byId("reportStatus").textContent = "Saved on this device. Run the driver reports database setup to share it with the office.";
  }

  function resetForm() {
    byId("driverReportForm").reset();
    byId("reportId").value = "";
    byId("reportDate").value = today();
    if (!isReviewer) byId("reportDate").min = today();
    byId("reportDate").readOnly = false;
    byId("deliveryCount").value = "0";
    byId("fuelUsed").value = "0";
    byId("vehicleCondition").value = "Good";
    renderDriverRoster();
  }

  function save(status) {
    const id = byId("reportId").value;
    const existing = reports.find((item) => item.id === id);
    if (existing && !isReviewer && existing.driverUserId !== auth.user.id) return;
    if (existing && !isReviewer && existing.status === "Submitted") {
      byId("reportStatus").textContent = "Submitted reports are locked. Ask the office to make a correction.";
      return;
    }
    if (!isReviewer && byId("reportDate").value !== today()) {
      byId("reportStatus").textContent = "Drivers can only create or update a report for today. The report date cannot be rolled back.";
      return;
    }
    const rosterDriverName = resolveRosterDriver(auth.user.username, rosterDriverNames());
    const item = { id: id || `report_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, driverUserId: existing?.driverUserId || auth.user.id, driverName: existing?.driverName || rosterDriverName || auth.user.username, reportDate: byId("reportDate").value, truckNumber: byId("truckNumber").value.trim(), shiftStart: byId("shiftStart").value, shiftFinish: byId("shiftFinish").value, jobClient: byId("jobClient").value.trim(), deliveryCount: Number(byId("deliveryCount").value || 0), fuelUsed: Number(byId("fuelUsed").value || 0), vehicleCondition: byId("vehicleCondition").value, issues: byId("issues").value.trim(), notes: byId("notes").value.trim(), status, updatedAt: new Date().toISOString() };
    if (status === "Submitted") item.submittedAt = existing?.submittedAt || new Date().toISOString();
    else if (existing?.submittedAt) item.submittedAt = existing.submittedAt;
    if (!item.truckNumber || !item.reportDate) { byId("reportStatus").textContent = "Report date and truck number are required."; return; }
    reports = id ? reports.map((entry) => entry.id === id ? item : entry) : [...reports, item]; write(reports); void syncShared(item); resetForm(); byId("reportStatus").textContent = status === "Submitted" ? "Report submitted to the office." : "Draft saved. You can return and finish it later."; render();
  }

  function edit(item) {
    if (!isReviewer && item.status === "Submitted") {
      byId("reportStatus").textContent = "Submitted reports are locked. Ask the office to make a correction.";
      return;
    }
    ["reportId", "reportDate", "truckNumber", "shiftStart", "shiftFinish", "jobClient", "deliveryCount", "fuelUsed", "vehicleCondition", "issues", "notes"].forEach((field) => { if (byId(field)) byId(field).value = item[field] ?? ""; });
    if (!isReviewer) byId("reportDate").readOnly = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.querySelectorAll("[data-report-status]").forEach((button) => button.addEventListener("click", () => save(button.dataset.reportStatus)));
  byId("cancelReportEdit").addEventListener("click", resetForm);
  byId("driverRosterWeek").value = mondayKey(new Date());
  byId("driverRosterWeek").addEventListener("change", () => {
    byId("driverRosterWeek").value = mondayKey(byId("driverRosterWeek").value) || mondayKey(new Date());
    renderDriverRoster();
  });
  byId("driverRosterDriver").addEventListener("change", () => {
    selectedRosterDriver = byId("driverRosterDriver").value;
    renderDriverRoster();
  });
  byId("driverRosterPreviousWeek").addEventListener("click", () => {
    byId("driverRosterWeek").value = dateKey(addDays(byId("driverRosterWeek").value, -7));
    renderDriverRoster();
  });
  byId("driverRosterCurrentWeek").addEventListener("click", () => {
    byId("driverRosterWeek").value = mondayKey(new Date());
    renderDriverRoster();
  });
  byId("driverRosterNextWeek").addEventListener("click", () => {
    byId("driverRosterWeek").value = dateKey(addDays(byId("driverRosterWeek").value, 7));
    renderDriverRoster();
  });
  byId("logoutBtn").addEventListener("click", () => { window.OPXAuth.logout(); window.location.href = "./login.html"; });
  document.body.addEventListener("click", async (event) => { const button = event.target.closest("button[data-action]"); if (!button) return; const item = reports.find((entry) => entry.id === button.dataset.id); if (!item) return; if (button.dataset.action === "edit") edit(item); if (button.dataset.action === "delete" && (isReviewer || item.driverUserId === auth.user.id) && confirm("Delete this report?")) { reports = reports.filter((entry) => entry.id !== item.id); write(reports); const client = window.OPXSupabase?.client; if (client) await client.from("driver_reports").delete().eq("id", item.id); render(); } });
  window.addEventListener("storage", (event) => {
    if (event.key === KEY) { reports = read(); render(); }
    if (event.key === ROSTER_KEY) { rosterRows = readRows(ROSTER_KEY).map(normalizeRosterRow); renderDriverRoster(); }
    if (event.key === DRIVERS_KEY) { driverRows = readRows(DRIVERS_KEY).map(normalizeDriverRow); renderDriverRoster(); }
  });
  render();
  renderDriverRoster();
  if (window.OPXSupabase?.isReady) {
    void hydrateSharedReports();
    void hydrateSharedRoster();
  }
  window.addEventListener("opx:supabase-ready", () => {
    void hydrateSharedReports();
    void hydrateSharedRoster();
  });
})();
