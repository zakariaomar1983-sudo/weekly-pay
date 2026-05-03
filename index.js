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
  { label: "Report Page", href: "./report.html", show: auth.can("accessCRM") && auth.can("viewStats") },
  { label: "Log Page", href: "./log.html", show: auth.can("accessLogs") },
  { label: "Control Panel", href: "./control-panel.html", show: auth.can("accessControlPanel") }
];

const state = {
  counts: {
    drivers: readCount("transport_crm_drivers"),
    trucks: readCount("transport_crm_trucks"),
    roster: readCount("transport_crm_roster"),
    income: readCount("transport_crm_truck_income"),
    payslips: readCount("transport_crm_payslips"),
    logs: readCount("transport_crm_logs")
  }
};

function readCount(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]").length;
  } catch {
    return 0;
  }
}

function drawStats() {
  const stats = [
    { label: "Drivers", value: String(state.counts.drivers) },
    { label: "Trucks", value: String(state.counts.trucks) },
    { label: "Roster Shifts", value: String(state.counts.roster) },
    { label: "Income Rows", value: String(state.counts.income) },
    { label: "Payslips", value: String(state.counts.payslips) },
    { label: "Logs", value: String(state.counts.logs) },
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

function getSupabaseClient() {
  return window.OPXSupabase?.client || null;
}

function isSupabaseReady() {
  return Boolean(window.OPXSupabase?.isReady && getSupabaseClient());
}

async function hydrateHomeCountsFromSupabase() {
  if (!isSupabaseReady()) return;
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const [
    driversRes,
    trucksRes,
    rosterRes,
    incomeRes,
    payslipsRes,
    logsRes
  ] = await Promise.all([
    supabase.from("drivers").select("*", { count: "exact", head: true }),
    supabase.from("trucks").select("*", { count: "exact", head: true }),
    supabase.from("roster").select("*", { count: "exact", head: true }),
    supabase.from("truck_income").select("*", { count: "exact", head: true }),
    supabase.from("payslips").select("*", { count: "exact", head: true }),
    supabase.from("app_logs").select("*", { count: "exact", head: true })
  ]);

  if (driversRes.error || trucksRes.error || rosterRes.error || incomeRes.error || payslipsRes.error || logsRes.error) {
    console.error("Supabase home stats load failed:", {
      drivers: driversRes.error?.message || "",
      trucks: trucksRes.error?.message || "",
      roster: rosterRes.error?.message || "",
      income: incomeRes.error?.message || "",
      payslips: payslipsRes.error?.message || "",
      logs: logsRes.error?.message || ""
    });
    return;
  }

  state.counts = {
    drivers: Number(driversRes.count || 0),
    trucks: Number(trucksRes.count || 0),
    roster: Number(rosterRes.count || 0),
    income: Number(incomeRes.count || 0),
    payslips: Number(payslipsRes.count || 0),
    logs: Number(logsRes.count || 0)
  };
  drawStats();
}

drawStats();
drawLinks();

if (isSupabaseReady()) {
  void hydrateHomeCountsFromSupabase();
}

window.addEventListener("opx:supabase-ready", () => {
  void hydrateHomeCountsFromSupabase();
});

window.addEventListener("opx:data-synced", () => {
  state.counts = {
    drivers: readCount("transport_crm_drivers"),
    trucks: readCount("transport_crm_trucks"),
    roster: readCount("transport_crm_roster"),
    income: readCount("transport_crm_truck_income"),
    payslips: readCount("transport_crm_payslips"),
    logs: readCount("transport_crm_logs")
  };
  drawStats();
});
