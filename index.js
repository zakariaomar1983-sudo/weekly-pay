const auth = window.OPXAuth?.requireAuth("./login.html");
if (!auth) {
  throw new Error("Authentication required");
}

if (!auth.can("accessCRM") && !auth.can("accessLogs") && !auth.can("accessControlPanel")) {
  document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>No page access assigned to this user.</p></section></main>";
  throw new Error("No page access");
}

const links = [
  { label: "Drivers Page", href: "./drivers.html", show: auth.can("accessCRM") && auth.can("viewDrivers") },
  { label: "Trucks Page", href: "./trucks.html", show: auth.can("accessCRM") && auth.can("viewTrucks") },
  { label: "Weekly Roster Page", href: "./roster.html", show: auth.can("accessCRM") && auth.can("viewRoster") },
  { label: "Finance & Pay Page", href: "./finance.html", show: auth.can("accessCRM") && (auth.can("viewTruckIncome") || auth.can("viewSpending") || auth.can("viewPayslips") || auth.can("viewStats")) },
  { label: "Log Page", href: "./log.html", show: auth.can("accessLogs") },
  { label: "Control Panel", href: "./control-panel.html", show: auth.can("accessControlPanel") }
];

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
    { label: "Logs", value: String(readCount("transport_crm_logs")) },
    { label: "Users", value: String(window.OPXAuth.getUsers().length) }
  ];

  document.getElementById("homeStats").innerHTML = stats
    .map((s) => `<article class="stat-card"><p>${s.label}</p><h3>${s.value}</h3></article>`)
    .join("");
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

document.getElementById("currentUserChip").textContent = `User: ${auth.user.username}`;

document.getElementById("logoutBtn").addEventListener("click", () => {
  window.OPXAuth.logout();
  window.location.href = "./login.html";
});

drawStats();
drawLinks();
