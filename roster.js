const auth = window.OPXAuth?.requireAuth("./login.html");
if (!auth) throw new Error("Authentication required");

if (!auth.can("accessCRM") || !auth.can("viewRoster")) {
  document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>You do not have permission to access the Weekly Roster page.</p></section></main>";
  throw new Error("No roster access");
}

const KEY = "transport_crm_roster";
const DRIVERS_KEY = "transport_crm_drivers";
const CONTACT_KEY = "transport_crm_driver_contacts";
const TRUCKS_KEY = "transport_crm_trucks";
const ROSTER_TABLE = "roster";
const supabase = window.OPXSupabase?.client || null;
const useSupabase = Boolean(window.OPXSupabase?.isReady && supabase);
const TARGET_DRIVERS = 7;
const TARGET_TRUCKS = 7;
const TARGET_DAYS_PER_DRIVER = 5;
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const state = { roster: readData() };

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}${Math.random().toString(16).slice(2, 10)}`.slice(0, 32);
}

function normalizeShiftDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoMatch?.[1]) return isoMatch[1];
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return dateToKey(parsed);
  return text;
}

function normalizeRosterRows(rows) {
  let changed = false;
  const normalized = rows.map((row) => {
    const nextId = isUuid(row.id) ? row.id : newId();
    const nextShiftDate = normalizeShiftDate(row.shiftDate);
    const nextRow = { ...row, id: nextId, shiftDate: nextShiftDate };
    if (nextId !== row.id || nextShiftDate !== String(row.shiftDate || "")) changed = true;
    return nextRow;
  });
  if (changed) {
    localStorage.setItem(KEY, JSON.stringify(normalized));
  }
  return normalized;
}

function readData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? normalizeRosterRows(parsed) : [];
  } catch {
    return [];
  }
}

function readArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readContacts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONTACT_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveData() {
  localStorage.setItem(KEY, JSON.stringify(state.roster));
  if (useSupabase) {
    void syncRosterToSupabase();
  }
}

function uid() {
  return newId();
}

function parseDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function todayKey() {
  return dateToKey(new Date());
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const body = rows.map((r) => headers.map((h) => esc(r[h])).join(",")).join("\n");
  return `${headers.join(",")}\n${body}`;
}

function mondayOf(dateStr) {
  const d = parseDateOnly(dateStr);
  if (!d || Number.isNaN(d.getTime())) return null;
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + offset);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function dateToKey(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDbRoster(item) {
  return {
    id: item.id,
    driver_name: item.driverName || "",
    truck_number: item.truckNumber || "",
    shift_date: normalizeShiftDate(item.shiftDate) || null,
    shift_time: item.shiftTime || "",
    route: item.route || "",
    status: item.status || ""
  };
}

function fromDbRoster(row) {
  return {
    id: row.id,
    driverName: row.driver_name || "",
    truckNumber: row.truck_number || "",
    shiftDate: normalizeShiftDate(row.shift_date || ""),
    shiftTime: row.shift_time || "",
    route: row.route || "",
    status: row.status || ""
  };
}

async function syncRosterToSupabase() {
  if (!useSupabase) return;
  const rows = state.roster.map(toDbRoster);
  const { error } = await supabase.from(ROSTER_TABLE).upsert(rows, { onConflict: "id" });
  if (error) {
    console.error("Supabase sync failed for roster:", error.message);
    return;
  }

  const ids = rows.map((r) => r.id);
  if (!ids.length) {
    const wipe = await supabase.from(ROSTER_TABLE).delete().not("id", "is", null);
    if (wipe.error) console.error("Supabase delete sync failed for roster:", wipe.error.message);
    return;
  }

  const inList = `(${ids.map((id) => `"${String(id).replaceAll('"', "")}"`).join(",")})`;
  const cleanup = await supabase.from(ROSTER_TABLE).delete().not("id", "in", inList);
  if (cleanup.error) {
    console.error("Supabase cleanup failed for roster:", cleanup.error.message);
  }
}

async function hydrateRosterFromSupabase() {
  if (!useSupabase) return;
  const { data, error } = await supabase.from(ROSTER_TABLE).select("*");
  if (error) {
    console.error("Supabase load failed for roster:", error.message);
    return;
  }
  if (!Array.isArray(data)) return;
  if (!data.length && state.roster.length) {
    console.warn("Supabase roster table is empty; keeping local data and seeding Supabase.");
    await syncRosterToSupabase();
    refresh();
    return;
  }

  state.roster = normalizeRosterRows(data.map(fromDbRoster));
  localStorage.setItem(KEY, JSON.stringify(state.roster));
  refresh();
}

function defaultWeekStartKey() {
  const todayMonday = mondayOf(todayKey());
  let latestDate = null;

  state.roster.forEach((item) => {
    const parsed = parseDateOnly(normalizeShiftDate(item.shiftDate));
    if (!parsed) return;
    if (!latestDate || parsed.getTime() > latestDate.getTime()) {
      latestDate = parsed;
    }
  });

  const rosterMonday = latestDate ? mondayOf(dateToKey(latestDate)) : null;
  return dateToKey(rosterMonday || todayMonday || new Date());
}

function getWeekDates(startKey) {
  const start = parseDateOnly(startKey);
  if (!start) return [];
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const x = new Date(start);
    x.setDate(start.getDate() + i);
    days.push(x);
  }
  return days;
}

function selectedWeekStartKey() {
  const input = document.getElementById("weekStart").value;
  const monday = mondayOf(input || todayKey());
  return monday ? dateToKey(monday) : "";
}

function getWeekContext() {
  const weekKey = selectedWeekStartKey();
  const weekDates = getWeekDates(weekKey);
  const weekKeys = weekDates.map(dateToKey);
  const weekSet = new Set(weekKeys);
  const weekRows = state.roster.filter((r) => weekSet.has(r.shiftDate));

  return { weekKey, weekDates, weekKeys, weekSet, weekRows };
}

function getActiveDrivers() {
  return readArray(DRIVERS_KEY)
    .filter((item) => String(item.status || "").toLowerCase() !== "inactive")
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function getActiveTrucks() {
  return readArray(TRUCKS_KEY)
    .filter((item) => String(item.status || "").toLowerCase() !== "under repair")
    .sort((a, b) => String(a.truckNumber || "").localeCompare(String(b.truckNumber || "")));
}

function cleanPhone(phone) {
  return String(phone || "").replace(/[^\d+]/g, "").trim();
}

function toWhatsAppNumber(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 10) {
    digits = `61${digits.slice(1)}`;
  }
  return digits;
}

function launchLink(url, target = "_blank") {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = target;
  anchor.rel = "noopener noreferrer";
  anchor.click();
}

function buildDriverLookup() {
  const contacts = readContacts();
  return new Map(readArray(DRIVERS_KEY).map((driver) => [
    driver.name,
    {
      id: driver.id,
      name: driver.name || "",
      phone: driver.phone || "",
      email: String(driver.email || contacts?.[driver.id]?.email || "").trim()
    }
  ]));
}

function getDriverContactByName(driverName) {
  return buildDriverLookup().get(driverName) || { id: "", name: driverName || "", phone: "", email: "" };
}

function renderRosterContactButtons(item) {
  const contact = getDriverContactByName(item.driverName);
  const hasPhone = Boolean(cleanPhone(contact.phone));
  return `<div class='contact-actions'>
    <button type='button' class='contact-link' data-action='email-shift' data-id='${item.id}' ${contact.email ? "" : "disabled"}>Email</button>
    <button type='button' class='contact-link' data-action='sms-shift' data-id='${item.id}' ${hasPhone ? "" : "disabled"}>SMS</button>
    <button type='button' class='contact-link' data-action='whatsapp-shift' data-id='${item.id}' ${hasPhone ? "" : "disabled"}>WhatsApp</button>
  </div>`;
}

function openShiftContact(channel, item) {
  const contact = getDriverContactByName(item.driverName);
  const phone = cleanPhone(contact.phone);
  const message = `Hi ${item.driverName}, your Onpoint Express shift is ${item.shiftDate} from ${item.shiftTime} with truck ${item.truckNumber} on route ${item.route}. Status: ${item.status}.`;

  if (channel === "email") {
    if (!contact.email) {
      alert(`No email saved for ${item.driverName} yet.`);
      return;
    }
    const subject = encodeURIComponent(`Onpoint Express shift update for ${item.driverName}`);
    const body = encodeURIComponent(`${message}\n\nPlease confirm when received.`);
    launchLink(`mailto:${contact.email}?subject=${subject}&body=${body}`, "_self");
    return;
  }

  if (!phone) {
    alert(`No phone number saved for ${item.driverName} yet.`);
    return;
  }

  if (channel === "sms") {
    launchLink(`sms:${phone}?body=${encodeURIComponent(message)}`, "_self");
    return;
  }

  if (channel === "whatsapp") {
    const whatsappNumber = toWhatsAppNumber(phone);
    if (!whatsappNumber) {
      alert(`WhatsApp number is not valid for ${item.driverName}.`);
      return;
    }
    launchLink(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`);
  }
}

function normalizeRouteLabel(route) {
  const text = String(route || "").trim();
  if (!text) return "Run";
  return text.length > 24 ? `${text.slice(0, 21)}...` : text;
}

function firstTruckForDriver(rows) {
  return rows.find((row) => row.truckNumber)?.truckNumber || "-";
}

function buildDriverPlans(weekRows) {
  const activeDrivers = getActiveDrivers();
  const activeDriverNames = activeDrivers.map((item) => item.name).filter(Boolean);
  const namesFromRoster = [...new Set(weekRows.map((item) => item.driverName).filter(Boolean))];
  const combined = [...new Set([...activeDriverNames, ...namesFromRoster])].slice(0, TARGET_DRIVERS);

  while (combined.length < TARGET_DRIVERS) {
    combined.push(`Open Driver Slot ${combined.length + 1}`);
  }

  return combined.map((driverName) => {
    const driverRows = weekRows.filter((row) => row.driverName === driverName);
    const assignments = {};

    driverRows.forEach((row) => {
      if (!assignments[row.shiftDate]) assignments[row.shiftDate] = [];
      assignments[row.shiftDate].push(row);
    });

    const plannedDays = Object.keys(assignments).length;
    const weekdayDays = Object.keys(assignments).filter((dateKey) => {
      const date = parseDateOnly(dateKey);
      const day = date?.getDay?.() ?? -1;
      return day >= 1 && day <= 5;
    }).length;
    const weekendDays = Object.keys(assignments).filter((dateKey) => {
      const date = parseDateOnly(dateKey);
      const day = date?.getDay?.() ?? -1;
      return day === 0 || day === 6;
    }).length;

    return {
      driverName,
      truckNumber: firstTruckForDriver(driverRows),
      assignments,
      plannedDays,
      weekdayDays,
      weekendDays,
      isPlaceholder: driverRows.length === 0 && driverName.startsWith("Open Driver Slot ")
    };
  });
}

function targetTone(plannedDays) {
  if (plannedDays >= TARGET_DAYS_PER_DRIVER) return "on-target";
  if (plannedDays >= TARGET_DAYS_PER_DRIVER - 1) return "near-target";
  return "under-target";
}

function drawStats() {
  const panel = document.getElementById("rosterStats");
  const { weekRows } = getWeekContext();
  const activeDrivers = getActiveDrivers();
  const activeTrucks = getActiveTrucks();
  const driversPlanned = new Set(weekRows.map((item) => item.driverName).filter(Boolean)).size;
  const trucksAssigned = new Set(weekRows.map((item) => item.truckNumber).filter(Boolean)).size;
  const driverPlans = buildDriverPlans(weekRows);
  const targetHit = driverPlans.filter((item) => item.plannedDays >= TARGET_DAYS_PER_DRIVER).length;
  const weekendShifts = weekRows.filter((item) => {
    const date = parseDateOnly(item.shiftDate);
    const day = date?.getDay?.() ?? -1;
    return day === 0 || day === 6;
  }).length;

  const stats = [
    { label: "Drivers Planned", value: `${driversPlanned}/${Math.min(activeDrivers.length || TARGET_DRIVERS, TARGET_DRIVERS)}` },
    { label: "Trucks Assigned", value: `${trucksAssigned}/${Math.min(activeTrucks.length || TARGET_TRUCKS, TARGET_TRUCKS)}` },
    { label: "Drivers At 5 Days", value: String(targetHit) },
    { label: "Weekday Shifts", value: String(weekRows.filter((x) => {
      const date = parseDateOnly(x.shiftDate);
      const day = date?.getDay?.() ?? -1;
      return day >= 1 && day <= 5;
    }).length) },
    { label: "Weekend Shifts", value: String(weekendShifts) }
  ];

  panel.style.display = "grid";
  panel.innerHTML = stats.map((s) => `<article class='stat-card'><p>${s.label}</p><h3>${s.value}</h3></article>`).join("");
}

function drawRosterModel() {
  const strip = document.getElementById("rosterRuleStrip");
  const activeDrivers = getActiveDrivers();
  const activeTrucks = getActiveTrucks();

  const items = [
    { label: "Active drivers", value: `${Math.min(activeDrivers.length, TARGET_DRIVERS)}/${TARGET_DRIVERS}` },
    { label: "Active trucks", value: `${Math.min(activeTrucks.length, TARGET_TRUCKS)}/${TARGET_TRUCKS}` },
    { label: "Driver target", value: `${TARGET_DAYS_PER_DRIVER} days` },
    { label: "Core pattern", value: "Mon-Fri" },
    { label: "Overflow", value: "Sat-Sun when required" }
  ];

  strip.innerHTML = items.map((item) => `<div class='rule-pill'><span>${item.label}</span><strong>${item.value}</strong></div>`).join("");
}

function drawDriverBoard() {
  const body = document.getElementById("rosterDriverBoardBody");
  const summary = document.getElementById("rosterBoardSummary");
  const notes = document.getElementById("rosterCoverageNotes");
  const { weekRows, weekKeys } = getWeekContext();
  const driverPlans = buildDriverPlans(weekRows);

  if (!driverPlans.length) {
    body.innerHTML = `<tr><td colspan='10' class='empty'>No active drivers found yet. Add drivers on the Drivers page or create shifts for this week.</td></tr>`;
    summary.textContent = "Weekly board is waiting for driver assignments.";
    notes.innerHTML = "";
    return;
  }

  const rows = driverPlans.map((plan) => {
    const cells = weekKeys.map((dayKey, index) => {
      const items = plan.assignments[dayKey] || [];
      if (!items.length) {
        return `<td class='board-cell board-cell-empty ${index >= 5 ? "weekend-col" : ""}'><span>Off</span></td>`;
      }

      const cellBody = items.map((item) => {
        const tone = item.status === "Leave" ? "board-badge-leave" : item.status === "Completed" ? "board-badge-done" : "board-badge-live";
        return `<div class='board-chip ${index >= 5 ? "weekend-col" : ""}'>
          <strong>${item.truckNumber}</strong>
          <span>${normalizeRouteLabel(item.route)}</span>
          <em class='board-badge ${tone}'>${item.status}</em>
        </div>`;
      }).join("");

      return `<td class='board-cell ${index >= 5 ? "weekend-col" : ""}'>${cellBody}</td>`;
    }).join("");

    const tone = targetTone(plan.plannedDays);
    return `<tr>
      <td><strong>${plan.driverName}</strong>${plan.isPlaceholder ? "<div class='muted'>Needs assignment</div>" : ""}</td>
      <td>${plan.truckNumber}</td>
      ${cells}
      <td>
        <div class='load-indicator ${tone}'>
          <strong>${plan.plannedDays}/${TARGET_DAYS_PER_DRIVER}</strong>
          <span>${plan.weekdayDays} weekday | ${plan.weekendDays} weekend</span>
        </div>
      </td>
    </tr>`;
  });

  body.innerHTML = rows.join("");

  const onTarget = driverPlans.filter((plan) => plan.plannedDays >= TARGET_DAYS_PER_DRIVER).length;
  const underTarget = driverPlans.filter((plan) => plan.plannedDays < TARGET_DAYS_PER_DRIVER).length;
  const weekendDrivers = driverPlans.filter((plan) => plan.weekendDays > 0).length;
  summary.textContent = `${driverPlans.length} drivers are shown on the weekly board. ${onTarget} have hit the 5-day target, ${underTarget} still need more coverage, and ${weekendDrivers} are carrying weekend work.`;

  const coverageItems = [
    {
      label: "5-day target",
      value: `${onTarget}/${driverPlans.length} drivers`,
      detail: underTarget ? `${underTarget} drivers are still below target for the week.` : "All listed drivers have reached the weekly target."
    },
    {
      label: "Driver coverage",
      value: `${new Set(weekRows.map((item) => item.driverName).filter(Boolean)).size}/${TARGET_DRIVERS}`,
      detail: "Use this as the live check for whether all 7 roster slots are covered."
    },
    {
      label: "Truck coverage",
      value: `${new Set(weekRows.map((item) => item.truckNumber).filter(Boolean)).size}/${TARGET_TRUCKS}`,
      detail: "Truck count shows how many fleet units are actually assigned this week."
    },
    {
      label: "Weekend usage",
      value: `${weekendDrivers} drivers`,
      detail: weekendDrivers ? "Weekend shifts are being used as overflow coverage." : "No weekend shifts planned right now."
    }
  ];

  notes.innerHTML = coverageItems.map((item) => `<article class='note-card'><p>${item.label}</p><h3>${item.value}</h3><span>${item.detail}</span></article>`).join("");
}

function drawWeekTable() {
  const tbody = document.getElementById("weeklyRosterTableBody");
  const { weekKey, weekDates } = getWeekContext();
  const query = (document.getElementById("rosterSearch")?.value || "").trim().toLowerCase();
  const statusFilter = document.getElementById("rosterFilterStatus")?.value || "";
  if (!weekKey) {
    tbody.innerHTML = `<tr><td colspan='8' class='empty'>Choose a valid week start.</td></tr>`;
    return;
  }

  const rows = [];

  weekDates.forEach((dateObj, idx) => {
    const key = dateToKey(dateObj);
    const entries = state.roster
      .filter((x) => x.shiftDate === key)
      .filter((x) => !statusFilter || x.status === statusFilter)
      .filter((x) => {
        if (!query) return true;
        const hay = `${x.driverName} ${x.truckNumber} ${x.shiftTime} ${x.route} ${x.status}`.toLowerCase();
        return hay.includes(query);
      })
      .sort((a, b) => a.shiftTime.localeCompare(b.shiftTime));

    if (!entries.length) {
      rows.push(`<tr><td>${DAY_NAMES[idx]}</td><td>${key}</td><td colspan='6' class='muted'>No shifts</td></tr>`);
      return;
    }

    entries.forEach((item, rowIndex) => {
      const adminActions = auth.can("editRoster")
        ? `<div class='table-actions'><button data-action='edit' data-id='${item.id}'>Edit</button><button data-action='delete' data-id='${item.id}'>Delete</button></div>`
        : "<span class='muted'>View only</span>";
      rows.push(`<tr>
        <td>${rowIndex === 0 ? DAY_NAMES[idx] : ""}</td>
        <td>${rowIndex === 0 ? key : ""}</td>
        <td>${item.driverName}</td>
        <td>${item.truckNumber}</td>
        <td>${item.shiftTime}</td>
        <td>${item.route}</td>
        <td>${item.status}</td>
        <td><div class='table-actions table-actions-stack'>${renderRosterContactButtons(item)}${adminActions}</div></td>
      </tr>`);
    });
  });

  tbody.innerHTML = rows.join("");
}

function refresh() {
  drawRosterModel();
  drawStats();
  drawDriverBoard();
  drawWeekTable();
}

function setForm(item) {
  document.getElementById("rosterId").value = item.id;
  document.getElementById("driverName").value = item.driverName;
  document.getElementById("truckNumber").value = item.truckNumber;
  document.getElementById("shiftDate").value = item.shiftDate;
  document.getElementById("shiftTime").value = item.shiftTime;
  document.getElementById("route").value = item.route;
  document.getElementById("rosterStatus").value = item.status;
}

function applyAccess() {
  document.getElementById("currentUserChip").textContent = `User: ${auth.user.username}`;
  if (!auth.can("accessControlPanel")) document.getElementById("controlPanelLink").style.display = "none";
  if (!auth.can("accessLogs")) document.querySelector("a[href='./log.html']").style.display = "none";
  if (!(auth.can("viewTruckIncome") || auth.can("viewSpending") || auth.can("viewPayslips") || auth.can("viewStats"))) {
    const link = document.getElementById("financeLink");
    if (link) link.style.display = "none";
  }
  if (!auth.can("viewStats")) {
    const reportLink = document.getElementById("reportLink");
    if (reportLink) reportLink.style.display = "none";
  }

  if (!auth.can("editRoster")) {
    const form = document.getElementById("rosterForm");
    Array.from(form.elements).forEach((el) => { if (el.type !== "hidden") el.disabled = true; });
    document.getElementById("exportRoster").style.display = "none";
  }
}

document.getElementById("logoutBtn").addEventListener("click", () => {
  window.OPXAuth.logout();
  window.location.href = "./login.html";
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

  state.roster = id ? state.roster.map((r) => r.id === id ? payload : r) : [...state.roster, payload];
  saveData();
  e.target.reset();
  document.getElementById("rosterId").value = "";

  const monday = mondayOf(payload.shiftDate);
  if (monday) {
    document.getElementById("weekStart").value = dateToKey(monday);
  }

  refresh();
});

document.getElementById("cancelRosterEdit").addEventListener("click", () => {
  document.getElementById("rosterForm").reset();
  document.getElementById("rosterId").value = "";
});

document.getElementById("exportRoster").addEventListener("click", () => {
  if (!auth.can("editRoster")) return;
  const csv = toCsv(state.roster);
  if (!csv) return alert("No records to export.");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "weekly_roster.csv";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("weekStart").addEventListener("change", refresh);
document.getElementById("rosterSearch").addEventListener("input", refresh);
document.getElementById("rosterFilterStatus").addEventListener("change", refresh);
document.getElementById("clearRosterFilters").addEventListener("click", () => {
  document.getElementById("rosterSearch").value = "";
  document.getElementById("rosterFilterStatus").value = "";
  const monday = mondayOf(todayKey());
  if (monday) {
    document.getElementById("weekStart").value = dateToKey(monday);
  } else {
    document.getElementById("weekStart").value = "";
  }
  refresh();
});

document.body.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;
  const item = state.roster.find((r) => r.id === id);

  if (action === "email-shift" || action === "sms-shift" || action === "whatsapp-shift") {
    if (!item) return;
    if (action === "email-shift") openShiftContact("email", item);
    if (action === "sms-shift") openShiftContact("sms", item);
    if (action === "whatsapp-shift") openShiftContact("whatsapp", item);
    return;
  }

  if (!auth.can("editRoster")) return;

  if (action === "edit") {
    if (item) setForm(item);
    return;
  }

  if (action === "delete") {
    state.roster = state.roster.filter((r) => r.id !== id);
    saveData();
    refresh();
  }
});

applyAccess();
document.getElementById("weekStart").value = defaultWeekStartKey();
refresh();
void hydrateRosterFromSupabase();

if (!useSupabase) {
  window.addEventListener("opx:supabase-ready", () => {
    window.location.reload();
  }, { once: true });
}
