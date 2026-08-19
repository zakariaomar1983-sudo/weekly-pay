(function () {
  const auth = window.OPXAuth?.requireAuth("./login.html");
  if (!auth || !auth.can("accessAI")) { document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>CRM AI is not enabled for this account.</p></section></main>"; return; }
  const byId = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;", "'":"&#039;"}[char]));
  let staffToken = "";
  let candidates = [];
  byId("currentUserChip").textContent = `User: ${auth.user.username}`;

  async function getStaffToken() {
    if (staffToken) return staffToken;
    const session = await window.OPXAuth.refreshServerSession(false);
    if (!session.ok) throw new Error("Your staff session has expired. Please sign in again.");
    staffToken = window.OPXAuth.getApiToken();
    if (!staffToken) throw new Error("A current staff session is required. Please sign in again.");
    return staffToken;
  }

  function context() {
    const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } };
    return { drivers: read("transport_crm_drivers"), trucks: read("transport_crm_trucks"), roster: read("transport_crm_roster"), income: read("transport_crm_truck_income"), expenses: read("transport_crm_spending"), payslips: read("transport_crm_payslips") };
  }

  byId("questionForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const answer = byId("answer"); answer.textContent = "Thinking...";
    try { const token = await getStaffToken(); const response = await fetch("./api/ai-assistant", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: byId("question").value, context: context() }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "AI request failed."); answer.textContent = data.answer || "No answer returned."; } catch (error) { answer.textContent = error.message || String(error); }
  });

  function renderCandidates() {
    byId("payslipCandidates").innerHTML = candidates.length ? candidates.map((item, index) => `<tr><td>${escapeHtml(item.driver)}</td><td>${escapeHtml(item.payPeriod)}</td><td>${escapeHtml(item.daysWorked)}</td><td>$${Number(item.dailyRate || 0).toFixed(2)}</td><td>$${Number(item.netPay || 0).toFixed(2)}</td><td>${escapeHtml(item.confidence || "Review")}</td><td><button class="btn" type="button" data-approve="${index}">Approve to Finance</button></td></tr>`).join("") : "<tr><td colspan='7' class='muted'>No extracted payslips waiting for approval.</td></tr>";
  }

  function validUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
  }

  byId("scanPayslips").addEventListener("click", async () => { byId("scanStatus").textContent = "Scanning Google mailbox..."; try { const token = await getStaffToken(); const response = await fetch("./api/ai-payslip-mail", { headers: { Authorization: `Bearer ${token}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Mailbox scan failed."); candidates = data.items || []; renderCandidates(); byId("scanStatus").textContent = `${candidates.length} payslip candidate(s) found. Review before approving.`; } catch (error) { byId("scanStatus").innerHTML = `${escapeHtml(error.message || String(error))} <a href="./login.html?reauth=1">Sign in again</a>`; } });

  document.body.addEventListener("click", async (event) => { const button = event.target.closest("button[data-approve]"); if (!button) return; const item = candidates[Number(button.dataset.approve)]; if (!item) return; const pay = { id: validUuid(item.id) ? item.id : crypto.randomUUID(), driver: item.driver, truckNumber: item.truckNumber || "", payPeriod: item.payPeriod || "", daysWorked: Number(item.daysWorked || 0), dailyRate: Number(item.dailyRate || 0), nightRunDrops: Number(item.nightRunDrops || 0), dropRate: 90, nightRunPay: Number(item.nightRunPay || 0), driverBonus: Number(item.driverBonus || 0), deductions: Number(item.deductions || 0), paymentDate: item.paymentDate || new Date().toISOString().slice(0, 10), autoPay: "No", autoPayRef: `AI:${item.sourceMessageId || "mail"}` }; const client = window.OPXSupabase?.client; if (client) { const { error } = await client.from("payslips").upsert({ id: pay.id, driver: pay.driver, truck_number: pay.truckNumber, pay_period: pay.payPeriod, days_worked: pay.daysWorked, daily_rate: pay.dailyRate, night_run_drops: pay.nightRunDrops, drop_rate: pay.dropRate, night_run_pay: pay.nightRunPay, driver_bonus: pay.driverBonus, deductions: pay.deductions, payment_date: pay.paymentDate, auto_pay: pay.autoPay, auto_pay_ref: pay.autoPayRef }, { onConflict: "id" }); if (error) { byId("scanStatus").textContent = error.message; return; } } const local = (() => { try { return JSON.parse(localStorage.getItem("transport_crm_payslips") || "[]"); } catch { return []; } })(); localStorage.setItem("transport_crm_payslips", JSON.stringify([...local.filter((entry) => entry.id !== pay.id), pay])); candidates = candidates.filter((entry) => entry !== item); renderCandidates(); byId("scanStatus").textContent = "Payslip approved and added to Finance."; });
  byId("logoutBtn").addEventListener("click", () => { window.OPXAuth.logout(); window.location.href = "./login.html"; });
  renderCandidates();
})();
