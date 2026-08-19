(function () {
  const auth = window.OPXAuth?.requireAuth("./login.html");
  if (!auth || !auth.can("accessDriverReports")) {
    document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>Your account does not have access to driver reports.</p></section></main>";
    return;
  }

  const KEY = "transport_crm_driver_reports";
  const isReviewer = auth.can("accessCRM") || auth.can("accessControlPanel");
  const byId = (id) => document.getElementById(id);
  const read = () => { try { const value = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };
  const write = (value) => { localStorage.setItem(KEY, JSON.stringify(value)); window.dispatchEvent(new CustomEvent("opx:driver-reports-updated")); };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;", "'":"&#039;"}[char]));
  const today = () => new Date().toISOString().slice(0, 10);
  let reports = read();
  let sharedSync = false;

  byId("currentUserChip").textContent = `User: ${auth.user.username}`;
  byId("historyTitle").textContent = isReviewer ? "Driver Reports" : "My Reports";
  byId("reportDate").value = today();
  if (!isReviewer) byId("reportDate").min = today();

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
    const item = { id: id || `report_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, driverUserId: existing?.driverUserId || auth.user.id, driverName: existing?.driverName || auth.user.username, reportDate: byId("reportDate").value, truckNumber: byId("truckNumber").value.trim(), shiftStart: byId("shiftStart").value, shiftFinish: byId("shiftFinish").value, jobClient: byId("jobClient").value.trim(), deliveryCount: Number(byId("deliveryCount").value || 0), fuelUsed: Number(byId("fuelUsed").value || 0), vehicleCondition: byId("vehicleCondition").value, issues: byId("issues").value.trim(), notes: byId("notes").value.trim(), status, updatedAt: new Date().toISOString() };
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
  byId("logoutBtn").addEventListener("click", () => { window.OPXAuth.logout(); window.location.href = "./login.html"; });
  document.body.addEventListener("click", async (event) => { const button = event.target.closest("button[data-action]"); if (!button) return; const item = reports.find((entry) => entry.id === button.dataset.id); if (!item) return; if (button.dataset.action === "edit") edit(item); if (button.dataset.action === "delete" && (isReviewer || item.driverUserId === auth.user.id) && confirm("Delete this report?")) { reports = reports.filter((entry) => entry.id !== item.id); write(reports); const client = window.OPXSupabase?.client; if (client) await client.from("driver_reports").delete().eq("id", item.id); render(); } });
  window.addEventListener("storage", (event) => { if (event.key === KEY) { reports = read(); render(); } });
  render();
  if (window.OPXSupabase?.isReady) void hydrateSharedReports();
  window.addEventListener("opx:supabase-ready", () => { void hydrateSharedReports(); });
})();
