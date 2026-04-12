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
      `<tr><td>${t.truckNumber || ""}</td><td>${t.registration || ""}</td><td>${t.model || ""}</td><td>${t.capacity ?? ""}</td><td>${t.serviceDueDate || ""}</td><td>${t.regoExpiryDate || ""}</td><td>${t.status || ""}</td><td><span class='muted'>Loaded</span></td></tr>`
    )).join("");
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
  }

  setTimeout(run, 600);
  setTimeout(run, 1500);
})();
