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
        capacity: Number(document.getElementById("truckCapacity").value || 0),
        serviceDueDate: String(document.getElementById("serviceDueDate").value || ""),
        regoExpiryDate: String(document.getElementById("regoExpiryDate").value || ""),
        status: String(document.getElementById("truckStatus").value || "Available"),
        notes: String(document.getElementById("truckNotes").value || "").trim()
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
