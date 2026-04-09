const auth = window.OPXAuth?.requireAuth("./login.html");
if (!auth) {
  throw new Error("Authentication required");
}

if (!auth.can("accessCRM")) {
  document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>You do not have permission to access the CRM page.</p></section></main>";
  throw new Error("No CRM access");
}

const storageKeys = {
  drivers: "transport_crm_drivers",
  trucks: "transport_crm_trucks",
  truckIncome: "transport_crm_truck_income",
  contracts: "transport_crm_contracts",
  spending: "transport_crm_spending",
  roster: "transport_crm_roster",
  payslips: "transport_crm_payslips"
};

const state = {
  drivers: readData(storageKeys.drivers),
  trucks: readData(storageKeys.trucks),
  truckIncome: readData(storageKeys.truckIncome),
  contracts: readData(storageKeys.contracts),
  spending: readData(storageKeys.spending),
  roster: readData(storageKeys.roster),
  payslips: readData(storageKeys.payslips)
};

const moduleAccess = [
  { panelId: "driversPanel", view: "viewDrivers", edit: "editDrivers", formId: "driversForm", exportId: "exportDrivers" },
  { panelId: "trucksPanel", view: "viewTrucks", edit: "editTrucks", formId: "trucksForm", exportId: "exportTrucks" },
  { panelId: "truckIncomePanel", view: "viewTruckIncome", edit: "editTruckIncome", formId: "truckIncomeForm", exportId: "exportIncome" },
  { panelId: "contractsPanel", view: "viewContracts", edit: "editContracts", formId: "contractsForm", exportId: "exportContracts" },
  { panelId: "spendingPanel", view: "viewSpending", edit: "editSpending", formId: "spendingForm", exportId: "exportSpending" },
  { panelId: "rosterPanel", view: "viewRoster", edit: "editRoster", formId: "rosterForm", exportId: "exportRoster" },
  { panelId: "paySlipPanel", view: "viewPayslips", edit: "editPayslips", formId: "payslipForm", exportId: "exportPayslips" }
];

const money = (value) => `$${Number(value || 0).toFixed(2)}`;

function readData(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}

function saveData(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const body = rows.map((r) => headers.map((h) => esc(r[h])).join(",")).join("\n");
  return `${headers.join(",")}\n${body}`;
}

function downloadCsv(filename, rows, permission) {
  if (!auth.can(permission)) {
    alert("You do not have permission to export this section.");
    return;
  }

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

function renderActions(editPermission, editAction, deleteAction, id) {
  if (!auth.can(editPermission)) return "<span class='muted'>View only</span>";
  return `<div class="table-actions"><button data-action="${editAction}" data-id="${id}">Edit</button><button data-action="${deleteAction}" data-id="${id}">Delete</button></div>`;
}

function drawStats() {
  const grid = document.getElementById("statsGrid");
  if (!auth.can("viewStats")) {
    grid.innerHTML = "";
    grid.style.display = "none";
    return;
  }

  grid.style.display = "grid";

  const totalIncome = state.truckIncome.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalSpending = state.spending.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const stats = [
    { label: "Total Drivers", value: String(state.drivers.length) },
    { label: "Total Trucks", value: String(state.trucks.length) },
    { label: "Truck Income Total", value: money(totalIncome) },
    { label: "Total Spending", value: money(totalSpending) },
    { label: "Contracts", value: String(state.contracts.length) },
    { label: "Gross Margin", value: money(totalIncome - totalSpending) },
    { label: "Shifts Scheduled", value: String(state.roster.length) },
    {
      label: "Payslips Net Total",
      value: money(
        state.payslips.reduce((sum, p) => sum + (Number(p.hoursWorked || 0) * Number(p.hourlyRate || 0) - Number(p.deductions || 0)), 0)
      )
    }
  ];

  grid.innerHTML = stats.map((s) => `<article class="stat-card"><p>${s.label}</p><h3>${s.value}</h3></article>`).join("");
}

function drawDrivers() {
  const tbody = document.getElementById("driversTableBody");
  if (!state.drivers.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">No records yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.drivers
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => `<tr><td>${item.name}</td><td>${item.phone}</td><td>${item.licenseNumber}</td><td>${item.licenseExpiry}</td><td>${item.status}</td><td>${item.emergencyContact || "-"}</td><td>${renderActions("editDrivers", "edit-driver", "delete-driver", item.id)}</td></tr>`)
    .join("");
}

function drawTrucks() {
  const tbody = document.getElementById("trucksTableBody");
  if (!state.trucks.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">No records yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.trucks
    .sort((a, b) => a.truckNumber.localeCompare(b.truckNumber))
    .map((item) => `<tr><td>${item.truckNumber}</td><td>${item.registration}</td><td>${item.model}</td><td>${item.capacity}</td><td>${item.serviceDueDate}</td><td>${item.status}</td><td>${renderActions("editTrucks", "edit-truck", "delete-truck", item.id)}</td></tr>`)
    .join("");
}

function drawTruckIncome() {
  const tbody = document.getElementById("truckIncomeTableBody");
  if (!state.truckIncome.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">No records yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.truckIncome
    .sort((a, b) => a.incomeDate < b.incomeDate ? 1 : -1)
    .map((item) => `<tr><td>${item.incomeDate}</td><td>${item.truckNumber}</td><td>${item.jobRef}</td><td>${item.client}</td><td>${money(item.amount)}</td><td>${item.status}</td><td>${renderActions("editTruckIncome", "edit-income", "delete-income", item.id)}</td></tr>`)
    .join("");
}

function drawContracts() {
  const tbody = document.getElementById("contractsTableBody");
  if (!state.contracts.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">No records yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.contracts
    .sort((a, b) => a.startDate < b.startDate ? 1 : -1)
    .map((item) => `<tr><td>${item.contractCode}</td><td>${item.client}</td><td>${item.startDate}</td><td>${item.endDate}</td><td>${money(item.value)}</td><td>${item.status}</td><td>${renderActions("editContracts", "edit-contract", "delete-contract", item.id)}</td></tr>`)
    .join("");
}

function drawSpending() {
  const tbody = document.getElementById("spendingTableBody");
  if (!state.spending.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">No records yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.spending
    .sort((a, b) => a.date < b.date ? 1 : -1)
    .map((item) => `<tr><td>${item.date}</td><td>${item.category}</td><td>${money(item.amount)}</td><td>${item.vendor}</td><td>${item.notes || "-"}</td><td>${renderActions("editSpending", "edit-spending", "delete-spending", item.id)}</td></tr>`)
    .join("");
}

function drawRoster() {
  const tbody = document.getElementById("rosterTableBody");
  if (!state.roster.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">No records yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.roster
    .sort((a, b) => a.shiftDate < b.shiftDate ? 1 : -1)
    .map((item) => `<tr><td>${item.driverName}</td><td>${item.truckNumber}</td><td>${item.shiftDate}</td><td>${item.shiftTime}</td><td>${item.route}</td><td>${item.status}</td><td>${renderActions("editRoster", "edit-roster", "delete-roster", item.id)}</td></tr>`)
    .join("");
}

function drawPayslips() {
  const tbody = document.getElementById("payslipTableBody");
  if (!state.payslips.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">No records yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.payslips
    .sort((a, b) => a.paymentDate < b.paymentDate ? 1 : -1)
    .map((item) => {
      const net = Number(item.hoursWorked || 0) * Number(item.hourlyRate || 0) - Number(item.deductions || 0);
      return `<tr><td>${item.driver}</td><td>${item.payPeriod}</td><td>${item.hoursWorked}</td><td>${money(item.hourlyRate)}</td><td>${money(item.deductions)}</td><td>${money(net)}</td><td>${item.paymentDate}</td><td>${renderActions("editPayslips", "edit-payslip", "delete-payslip", item.id)}</td></tr>`;
    })
    .join("");
}

function refresh() {
  drawDrivers();
  drawTrucks();
  drawTruckIncome();
  drawContracts();
  drawSpending();
  drawRoster();
  drawPayslips();
  drawStats();
}

function applyAccessControl() {
  moduleAccess.forEach((item) => {
    const panel = document.getElementById(item.panelId);
    if (!panel) return;

    if (!auth.can(item.view)) {
      panel.style.display = "none";
      return;
    }

    panel.style.display = "block";

    if (!auth.can(item.edit)) {
      const form = document.getElementById(item.formId);
      if (form) {
        Array.from(form.elements).forEach((element) => {
          if (element.type !== "hidden") element.disabled = true;
        });
      }

      const exportBtn = document.getElementById(item.exportId);
      if (exportBtn) exportBtn.style.display = "none";
    }
  });

  const openLogLink = document.getElementById("openLogLink");
  if (openLogLink && !auth.can("accessLogs")) openLogLink.style.display = "none";

  const controlPanelLink = document.getElementById("controlPanelLink");
  if (controlPanelLink && !auth.can("accessControlPanel")) controlPanelLink.style.display = "none";

  const clearAllBtn = document.getElementById("clearAllBtn");
  if (clearAllBtn && !auth.can("adminData")) clearAllBtn.style.display = "none";
}

document.getElementById("currentUserChip").textContent = `User: ${auth.user.username}`;

document.getElementById("logoutBtn").addEventListener("click", () => {
  window.OPXAuth.logout();
  window.location.href = "./login.html";
});

document.getElementById("driversForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!auth.can("editDrivers")) return;

  const id = document.getElementById("driverDetailsId").value;
  const payload = {
    id: id || uid(),
    name: document.getElementById("driverDetailsName").value.trim(),
    phone: document.getElementById("driverPhone").value.trim(),
    licenseNumber: document.getElementById("licenseNumber").value.trim(),
    licenseExpiry: document.getElementById("licenseExpiry").value,
    hireDate: document.getElementById("hireDate").value,
    status: document.getElementById("driverStatus").value,
    address: document.getElementById("driverAddress").value.trim(),
    emergencyContact: document.getElementById("emergencyContact").value.trim()
  };

  state.drivers = id ? state.drivers.map((item) => item.id === id ? payload : item) : [...state.drivers, payload];
  saveData(storageKeys.drivers, state.drivers);
  e.target.reset();
  document.getElementById("driverDetailsId").value = "";
  refresh();
});

document.getElementById("trucksForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!auth.can("editTrucks")) return;

  const id = document.getElementById("truckDetailsId").value;
  const payload = {
    id: id || uid(),
    truckNumber: document.getElementById("truckDetailsNumber").value.trim(),
    registration: document.getElementById("truckRegistration").value.trim(),
    model: document.getElementById("truckModel").value.trim(),
    capacity: Number(document.getElementById("truckCapacity").value),
    serviceDueDate: document.getElementById("serviceDueDate").value,
    status: document.getElementById("truckStatus").value,
    notes: document.getElementById("truckNotes").value.trim()
  };

  state.trucks = id ? state.trucks.map((item) => item.id === id ? payload : item) : [...state.trucks, payload];
  saveData(storageKeys.trucks, state.trucks);
  e.target.reset();
  document.getElementById("truckDetailsId").value = "";
  refresh();
});

document.getElementById("truckIncomeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!auth.can("editTruckIncome")) return;

  const id = document.getElementById("truckIncomeId").value;
  const payload = {
    id: id || uid(),
    incomeDate: document.getElementById("incomeDate").value,
    truckNumber: document.getElementById("incomeTruckNumber").value.trim(),
    jobRef: document.getElementById("incomeJobRef").value.trim(),
    client: document.getElementById("incomeClient").value.trim(),
    amount: Number(document.getElementById("incomeAmount").value),
    status: document.getElementById("incomeStatus").value,
    notes: document.getElementById("incomeNotes").value.trim()
  };

  state.truckIncome = id ? state.truckIncome.map((item) => item.id === id ? payload : item) : [...state.truckIncome, payload];
  saveData(storageKeys.truckIncome, state.truckIncome);
  e.target.reset();
  document.getElementById("truckIncomeId").value = "";
  refresh();
});

document.getElementById("contractsForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!auth.can("editContracts")) return;

  const id = document.getElementById("contractId").value;
  const payload = {
    id: id || uid(),
    contractCode: document.getElementById("contractCode").value.trim(),
    client: document.getElementById("contractClient").value.trim(),
    startDate: document.getElementById("contractStartDate").value,
    endDate: document.getElementById("contractEndDate").value,
    value: Number(document.getElementById("contractValue").value),
    status: document.getElementById("contractStatus").value,
    terms: document.getElementById("contractTerms").value.trim()
  };

  state.contracts = id ? state.contracts.map((item) => item.id === id ? payload : item) : [...state.contracts, payload];
  saveData(storageKeys.contracts, state.contracts);
  e.target.reset();
  document.getElementById("contractId").value = "";
  refresh();
});

document.getElementById("spendingForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!auth.can("editSpending")) return;

  const id = document.getElementById("spendingId").value;
  const payload = {
    id: id || uid(),
    date: document.getElementById("expenseDate").value,
    category: document.getElementById("expenseCategory").value.trim(),
    amount: Number(document.getElementById("expenseAmount").value),
    vendor: document.getElementById("expenseVendor").value.trim(),
    notes: document.getElementById("expenseNotes").value.trim()
  };

  state.spending = id ? state.spending.map((item) => item.id === id ? payload : item) : [...state.spending, payload];
  saveData(storageKeys.spending, state.spending);
  e.target.reset();
  document.getElementById("spendingId").value = "";
  refresh();
});

document.getElementById("rosterForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!auth.can("editRoster")) return;

  const id = document.getElementById("rosterId").value;
  const payload = {
    id: id || uid(),
    driverName: document.getElementById("driverName").value.trim(),
    truckNumber: document.getElementById("truckNumber").value.trim(),
    shiftDate: document.getElementById("shiftDate").value,
    shiftTime: document.getElementById("shiftTime").value.trim(),
    route: document.getElementById("route").value.trim(),
    status: document.getElementById("rosterStatus").value
  };

  state.roster = id ? state.roster.map((item) => item.id === id ? payload : item) : [...state.roster, payload];
  saveData(storageKeys.roster, state.roster);
  e.target.reset();
  document.getElementById("rosterId").value = "";
  refresh();
});

document.getElementById("payslipForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!auth.can("editPayslips")) return;

  const id = document.getElementById("payslipId").value;
  const payload = {
    id: id || uid(),
    driver: document.getElementById("payslipDriver").value.trim(),
    payPeriod: document.getElementById("payPeriod").value.trim(),
    hoursWorked: Number(document.getElementById("hoursWorked").value),
    hourlyRate: Number(document.getElementById("hourlyRate").value),
    deductions: Number(document.getElementById("deductions").value),
    paymentDate: document.getElementById("paymentDate").value
  };

  state.payslips = id ? state.payslips.map((item) => item.id === id ? payload : item) : [...state.payslips, payload];
  saveData(storageKeys.payslips, state.payslips);
  e.target.reset();
  document.getElementById("payslipId").value = "";
  refresh();
});

function hookCancelButtons() {
  const pairs = [
    ["cancelDriverEdit", "driversForm", "driverDetailsId"],
    ["cancelTruckEdit", "trucksForm", "truckDetailsId"],
    ["cancelIncomeEdit", "truckIncomeForm", "truckIncomeId"],
    ["cancelContractEdit", "contractsForm", "contractId"],
    ["cancelSpendingEdit", "spendingForm", "spendingId"],
    ["cancelRosterEdit", "rosterForm", "rosterId"],
    ["cancelPayslipEdit", "payslipForm", "payslipId"]
  ];

  pairs.forEach(([buttonId, formId, hiddenId]) => {
    const button = document.getElementById(buttonId);
    if (!button) return;
    button.addEventListener("click", () => {
      document.getElementById(formId).reset();
      document.getElementById(hiddenId).value = "";
    });
  });
}

function setDriverForm(item) {
  document.getElementById("driverDetailsId").value = item.id;
  document.getElementById("driverDetailsName").value = item.name;
  document.getElementById("driverPhone").value = item.phone;
  document.getElementById("licenseNumber").value = item.licenseNumber;
  document.getElementById("licenseExpiry").value = item.licenseExpiry;
  document.getElementById("hireDate").value = item.hireDate;
  document.getElementById("driverStatus").value = item.status;
  document.getElementById("driverAddress").value = item.address || "";
  document.getElementById("emergencyContact").value = item.emergencyContact || "";
}

function setTruckForm(item) {
  document.getElementById("truckDetailsId").value = item.id;
  document.getElementById("truckDetailsNumber").value = item.truckNumber;
  document.getElementById("truckRegistration").value = item.registration;
  document.getElementById("truckModel").value = item.model;
  document.getElementById("truckCapacity").value = item.capacity;
  document.getElementById("serviceDueDate").value = item.serviceDueDate;
  document.getElementById("truckStatus").value = item.status;
  document.getElementById("truckNotes").value = item.notes || "";
}

function setIncomeForm(item) {
  document.getElementById("truckIncomeId").value = item.id;
  document.getElementById("incomeDate").value = item.incomeDate;
  document.getElementById("incomeTruckNumber").value = item.truckNumber;
  document.getElementById("incomeJobRef").value = item.jobRef;
  document.getElementById("incomeClient").value = item.client;
  document.getElementById("incomeAmount").value = item.amount;
  document.getElementById("incomeStatus").value = item.status;
  document.getElementById("incomeNotes").value = item.notes || "";
}

function setContractForm(item) {
  document.getElementById("contractId").value = item.id;
  document.getElementById("contractCode").value = item.contractCode;
  document.getElementById("contractClient").value = item.client;
  document.getElementById("contractStartDate").value = item.startDate;
  document.getElementById("contractEndDate").value = item.endDate;
  document.getElementById("contractValue").value = item.value;
  document.getElementById("contractStatus").value = item.status;
  document.getElementById("contractTerms").value = item.terms || "";
}

function setSpendingForm(item) {
  document.getElementById("spendingId").value = item.id;
  document.getElementById("expenseDate").value = item.date;
  document.getElementById("expenseCategory").value = item.category;
  document.getElementById("expenseAmount").value = item.amount;
  document.getElementById("expenseVendor").value = item.vendor;
  document.getElementById("expenseNotes").value = item.notes || "";
}

function setRosterForm(item) {
  document.getElementById("rosterId").value = item.id;
  document.getElementById("driverName").value = item.driverName;
  document.getElementById("truckNumber").value = item.truckNumber;
  document.getElementById("shiftDate").value = item.shiftDate;
  document.getElementById("shiftTime").value = item.shiftTime;
  document.getElementById("route").value = item.route;
  document.getElementById("rosterStatus").value = item.status;
}

function setPayslipForm(item) {
  document.getElementById("payslipId").value = item.id;
  document.getElementById("payslipDriver").value = item.driver;
  document.getElementById("payPeriod").value = item.payPeriod;
  document.getElementById("hoursWorked").value = item.hoursWorked;
  document.getElementById("hourlyRate").value = item.hourlyRate;
  document.getElementById("deductions").value = item.deductions;
  document.getElementById("paymentDate").value = item.paymentDate;
}

function hookTableActions() {
  document.body.addEventListener("click", (e) => {
    const button = e.target.closest("button[data-action]");
    if (!button) return;
    const { action, id } = button.dataset;

    if (action === "edit-driver" && auth.can("editDrivers")) {
      const item = state.drivers.find((x) => x.id === id);
      if (item) setDriverForm(item);
      return;
    }
    if (action === "delete-driver" && auth.can("editDrivers")) {
      state.drivers = state.drivers.filter((x) => x.id !== id);
      saveData(storageKeys.drivers, state.drivers);
      refresh();
      return;
    }

    if (action === "edit-truck" && auth.can("editTrucks")) {
      const item = state.trucks.find((x) => x.id === id);
      if (item) setTruckForm(item);
      return;
    }
    if (action === "delete-truck" && auth.can("editTrucks")) {
      state.trucks = state.trucks.filter((x) => x.id !== id);
      saveData(storageKeys.trucks, state.trucks);
      refresh();
      return;
    }

    if (action === "edit-income" && auth.can("editTruckIncome")) {
      const item = state.truckIncome.find((x) => x.id === id);
      if (item) setIncomeForm(item);
      return;
    }
    if (action === "delete-income" && auth.can("editTruckIncome")) {
      state.truckIncome = state.truckIncome.filter((x) => x.id !== id);
      saveData(storageKeys.truckIncome, state.truckIncome);
      refresh();
      return;
    }

    if (action === "edit-contract" && auth.can("editContracts")) {
      const item = state.contracts.find((x) => x.id === id);
      if (item) setContractForm(item);
      return;
    }
    if (action === "delete-contract" && auth.can("editContracts")) {
      state.contracts = state.contracts.filter((x) => x.id !== id);
      saveData(storageKeys.contracts, state.contracts);
      refresh();
      return;
    }

    if (action === "edit-spending" && auth.can("editSpending")) {
      const item = state.spending.find((x) => x.id === id);
      if (item) setSpendingForm(item);
      return;
    }
    if (action === "delete-spending" && auth.can("editSpending")) {
      state.spending = state.spending.filter((x) => x.id !== id);
      saveData(storageKeys.spending, state.spending);
      refresh();
      return;
    }

    if (action === "edit-roster" && auth.can("editRoster")) {
      const item = state.roster.find((x) => x.id === id);
      if (item) setRosterForm(item);
      return;
    }
    if (action === "delete-roster" && auth.can("editRoster")) {
      state.roster = state.roster.filter((x) => x.id !== id);
      saveData(storageKeys.roster, state.roster);
      refresh();
      return;
    }

    if (action === "edit-payslip" && auth.can("editPayslips")) {
      const item = state.payslips.find((x) => x.id === id);
      if (item) setPayslipForm(item);
      return;
    }
    if (action === "delete-payslip" && auth.can("editPayslips")) {
      state.payslips = state.payslips.filter((x) => x.id !== id);
      saveData(storageKeys.payslips, state.payslips);
      refresh();
    }
  });
}

function hookUtilityActions() {
  document.getElementById("exportDrivers").addEventListener("click", () => {
    downloadCsv("drivers.csv", state.drivers, "editDrivers");
  });

  document.getElementById("exportTrucks").addEventListener("click", () => {
    downloadCsv("trucks.csv", state.trucks, "editTrucks");
  });

  document.getElementById("exportIncome").addEventListener("click", () => {
    downloadCsv("truck_income.csv", state.truckIncome, "editTruckIncome");
  });

  document.getElementById("exportContracts").addEventListener("click", () => {
    downloadCsv("contracts.csv", state.contracts, "editContracts");
  });

  document.getElementById("exportSpending").addEventListener("click", () => {
    downloadCsv("spending.csv", state.spending, "editSpending");
  });

  document.getElementById("exportRoster").addEventListener("click", () => {
    downloadCsv("driver_roster.csv", state.roster, "editRoster");
  });

  document.getElementById("exportPayslips").addEventListener("click", () => {
    const rows = state.payslips.map((item) => {
      const netPay = Number(item.hoursWorked || 0) * Number(item.hourlyRate || 0) - Number(item.deductions || 0);
      return { ...item, netPay: netPay.toFixed(2) };
    });
    downloadCsv("payslips.csv", rows, "editPayslips");
  });

  document.getElementById("clearAllBtn").addEventListener("click", () => {
    if (!auth.can("adminData")) return;

    const ok = confirm("Delete all CRM records? This cannot be undone.");
    if (!ok) return;

    state.drivers = [];
    state.trucks = [];
    state.truckIncome = [];
    state.contracts = [];
    state.spending = [];
    state.roster = [];
    state.payslips = [];

    saveData(storageKeys.drivers, state.drivers);
    saveData(storageKeys.trucks, state.trucks);
    saveData(storageKeys.truckIncome, state.truckIncome);
    saveData(storageKeys.contracts, state.contracts);
    saveData(storageKeys.spending, state.spending);
    saveData(storageKeys.roster, state.roster);
    saveData(storageKeys.payslips, state.payslips);

    ["driversForm", "trucksForm", "truckIncomeForm", "contractsForm", "spendingForm", "rosterForm", "payslipForm"].forEach((id) => {
      document.getElementById(id).reset();
    });

    ["driverDetailsId", "truckDetailsId", "truckIncomeId", "contractId", "spendingId", "rosterId", "payslipId"].forEach((id) => {
      document.getElementById(id).value = "";
    });

    refresh();
  });
}

applyAccessControl();
hookCancelButtons();
hookTableActions();
hookUtilityActions();
refresh();
