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
const DRIVERS_TABLE = "drivers";
const ROSTER_TABLE = "roster";
const TRUCKS_TABLE = "trucks";
const TARGET_DRIVERS = 7;
const TARGET_TRUCKS = 7;
const TARGET_DAYS_PER_DRIVER = 5;
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DEFAULT_SHIFT_TIME = "06:00 - 14:00";
const DEFAULT_ROUTE = "Sydney to Newcastle";
const LEAVE_SHIFT_TIME = "On Leave";
const LEAVE_ROUTE = "Driver away";
const FALLBACK_DRIVERS = [
  { id: "fallback-driver-1", name: "Sharmake Hashi", status: "Active" },
  { id: "fallback-driver-2", name: "Imran Abdella", status: "Active" },
  { id: "fallback-driver-3", name: "Abdirizak Ahmed", status: "Active" },
  { id: "fallback-driver-4", name: "Ramzi Mohamed", status: "Active" },
  { id: "fallback-driver-5", name: "Suhen Omar", status: "Active" },
  { id: "fallback-driver-6", name: "Soleh Sungkar", status: "Active" },
  { id: "fallback-driver-7", name: "Samatar Yusuf", status: "Active" }
];
const FALLBACK_TRUCKS = [
  { id: "fallback-truck-1", truckNumber: "840", status: "Available" },
  { id: "fallback-truck-2", truckNumber: "881", status: "Available" },
  { id: "fallback-truck-3", truckNumber: "855", status: "Available" },
  { id: "fallback-truck-4", truckNumber: "853", status: "Available" },
  { id: "fallback-truck-5", truckNumber: "672", status: "Available" },
  { id: "fallback-truck-6", truckNumber: "620", status: "Available" },
  { id: "fallback-truck-7", truckNumber: "841", status: "Available" }
];
const supabase = window.OPXSupabase?.client || null;
const useSupabase = Boolean(window.OPXSupabase?.isReady && supabase);
const state = { roster: readData() };
const boardDragState = { shiftId: "" };
const weekRenderState = { queued: false };

function readData() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
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

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createNodeFromMarkup(markup) {
  const template = document.createElement("template");
  template.innerHTML = String(markup || "").trim();
  return template.content.firstElementChild;
}

function patchKeyedChildren(container, items, keyAttr) {
  if (!container) return;
  const existing = new Map(Array.from(container.children).map((child) => [child.getAttribute(keyAttr), child]));

  items.forEach((item, index) => {
    const key = String(item.key || "");
    const signature = String(item.signature || "");
    let child = existing.get(key);

    if (!child) {
      child = createNodeFromMarkup(item.markup);
      if (!child) return;
      container.insertBefore(child, container.children[index] || null);
    } else if (child.getAttribute("data-render-signature") !== signature) {
      const nextChild = createNodeFromMarkup(item.markup);
      if (!nextChild) return;
      child.replaceWith(nextChild);
      child = nextChild;
    }

    const currentAtIndex = container.children[index];
    if (currentAtIndex !== child) {
      container.insertBefore(child, currentAtIndex || null);
    }

    existing.delete(key);
  });

  existing.forEach((child) => child.remove());
}

function setMarkupIfChanged(node, markup) {
  if (!node) return;
  if (node.innerHTML !== markup) node.innerHTML = markup;
}

function setTextIfChanged(node, text) {
  if (!node) return;
  if (node.textContent !== text) node.textContent = text;
}

function saveData() {
  localStorage.setItem(KEY, JSON.stringify(state.roster));
  if (useSupabase) {
    void syncRosterToSupabase();
  }
}

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toDbRoster(item) {
  return {
    id: item.id,
    driver_name: item.driverName || "",
    truck_number: item.truckNumber || "",
    run_type: item.nightRun ? "Night Run +" : "",
    shift_date: item.shiftDate || null,
    shift_time: item.shiftTime || "",
    route: item.route || "",
    status: item.status || "Scheduled"
  };
}

function fromDbRoster(row) {
  const runType = String(row.run_type || "").trim().toLowerCase();
  return {
    id: row.id,
    driverName: row.driver_name || "",
    truckNumber: row.truck_number || "",
    nightRun: runType === "night run" || runType === "night run +",
    shiftDate: row.shift_date || "",
    shiftTime: row.shift_time || "",
    route: row.route || "",
    status: row.status || "Scheduled"
  };
}

function fromDbDriver(row) {
  return {
    id: row.id,
    name: row.name || "",
    phone: row.phone || "",
    email: row.email || "",
    licenseNumber: row.license_number || "",
    licenseExpiry: row.license_expiry || "",
    hireDate: row.hire_date || "",
    status: row.status || "",
    address: row.address || "",
    emergencyContact: row.emergency_contact || ""
  };
}

function fromDbTruck(row) {
  return {
    id: row.id,
    truckNumber: row.truck_number || "",
    registration: row.registration || "",
    model: row.model || "",
    capacity: Number(row.capacity || 0),
    serviceDueDate: row.service_due_date || "",
    regoExpiryDate: row.rego_expiry_date || "",
    status: row.status || "",
    notes: row.notes || ""
  };
}

function toDbDriver(item) {
  return {
    id: item.id,
    name: item.name || "",
    phone: item.phone || "",
    email: item.email || "",
    license_number: item.licenseNumber || "",
    license_expiry: item.licenseExpiry || null,
    hire_date: item.hireDate || null,
    status: item.status || "",
    address: item.address || "",
    emergency_contact: item.emergencyContact || ""
  };
}

function toDbTruck(item) {
  return {
    id: item.id,
    truck_number: item.truckNumber || "",
    registration: item.registration || "",
    model: item.model || "",
    capacity: Number(item.capacity || 0),
    service_due_date: item.serviceDueDate || null,
    rego_expiry_date: item.regoExpiryDate || null,
    status: item.status || "",
    notes: item.notes || ""
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

  const ids = rows.map((row) => row.id);
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
    console.warn("Supabase roster table is empty; keeping local roster and seeding Supabase.");
    await syncRosterToSupabase();
    refresh();
    return;
  }

  state.roster = data.map(fromDbRoster);
  localStorage.setItem(KEY, JSON.stringify(state.roster));
  refresh();
}

async function hydrateRosterReferencesFromSupabase() {
  if (!useSupabase) return;

  const localDrivers = readArray(DRIVERS_KEY);
  const localTrucks = readArray(TRUCKS_KEY);

  const [driversRes, trucksRes] = await Promise.all([
    supabase.from(DRIVERS_TABLE).select("*"),
    supabase.from(TRUCKS_TABLE).select("*")
  ]);

  if (!driversRes.error && Array.isArray(driversRes.data)) {
    if (!driversRes.data.length && localDrivers.length) {
      const { error } = await supabase.from(DRIVERS_TABLE).upsert(localDrivers.map(toDbDriver), { onConflict: "id" });
      if (error) {
        console.error("Supabase seed failed for roster drivers:", error.message);
      } else {
        localStorage.setItem(DRIVERS_KEY, JSON.stringify(localDrivers));
      }
    } else {
      localStorage.setItem(DRIVERS_KEY, JSON.stringify(driversRes.data.map(fromDbDriver)));
    }
  } else if (driversRes.error) {
    console.error("Supabase load failed for roster drivers:", driversRes.error.message);
  }

  if (!trucksRes.error && Array.isArray(trucksRes.data)) {
    if (!trucksRes.data.length && localTrucks.length) {
      const { error } = await supabase.from(TRUCKS_TABLE).upsert(localTrucks.map(toDbTruck), { onConflict: "id" });
      if (error) {
        console.error("Supabase seed failed for roster trucks:", error.message);
      } else {
        localStorage.setItem(TRUCKS_KEY, JSON.stringify(localTrucks));
      }
    } else {
      localStorage.setItem(TRUCKS_KEY, JSON.stringify(trucksRes.data.map(fromDbTruck)));
    }
  } else if (trucksRes.error) {
    console.error("Supabase load failed for roster trucks:", trucksRes.error.message);
  }

  refresh();
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

function normalizeRosterPayload(payload) {
  if (payload.status !== "Leave") return payload;
  return {
    ...payload,
    truckNumber: "",
    nightRun: false,
    shiftTime: payload.shiftTime || LEAVE_SHIFT_TIME,
    route: payload.route || LEAVE_ROUTE
  };
}

function dedupeRosterRows(rows) {
  const latestByDriverDate = new Map();
  rows.forEach((row) => {
    const driverName = String(row.driverName || "").trim();
    const shiftDate = String(row.shiftDate || "").trim();
    if (!driverName || !shiftDate) return;
    latestByDriverDate.set(`${driverName}__${shiftDate}`, row);
  });
  return rows.filter((row) => {
    const driverName = String(row.driverName || "").trim();
    const shiftDate = String(row.shiftDate || "").trim();
    if (!driverName || !shiftDate) return true;
    return latestByDriverDate.get(`${driverName}__${shiftDate}`) === row;
  });
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
  const actualWeekRows = state.roster.filter((r) => weekSet.has(r.shiftDate));
  const weekRows = [...actualWeekRows, ...buildWeekTemplateRows(weekKeys, actualWeekRows)];

  return { weekKey, weekDates, weekKeys, weekSet, weekRows, actualWeekRows };
}

function getActiveDrivers() {
  const rows = readArray(DRIVERS_KEY);
  const source = rows.length ? rows : FALLBACK_DRIVERS;
  return source
    .filter((item) => String(item.status || "").toLowerCase() !== "inactive")
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function getActiveTrucks() {
  const rows = readArray(TRUCKS_KEY);
  const source = rows.length ? rows : FALLBACK_TRUCKS;
  return source
    .filter((item) => String(item.status || "").toLowerCase() !== "under repair")
    .sort((a, b) => String(a.truckNumber || "").localeCompare(String(b.truckNumber || "")));
}

function ensureRosterReferenceFallbacks() {
  const drivers = readArray(DRIVERS_KEY);
  const trucks = readArray(TRUCKS_KEY);

  if (!drivers.length) {
    localStorage.setItem(DRIVERS_KEY, JSON.stringify(FALLBACK_DRIVERS));
  }
  if (!trucks.length) {
    localStorage.setItem(TRUCKS_KEY, JSON.stringify(FALLBACK_TRUCKS));
  }
}

function getMatchedTruckForDriver(driverName) {
  const name = String(driverName || "").trim();
  if (!name) return "";

  const activeTruckNumbers = new Set(getActiveTrucks().map((item) => String(item.truckNumber || "").trim()).filter(Boolean));
  for (let index = state.roster.length - 1; index >= 0; index -= 1) {
    const row = state.roster[index];
    if (row.driverName === name && activeTruckNumbers.has(String(row.truckNumber || "").trim())) {
      return row.truckNumber;
    }
  }

  const activeDrivers = getActiveDrivers();
  const activeTrucks = getActiveTrucks();
  const matchIndex = activeDrivers.findIndex((item) => item.name === name);
  return matchIndex >= 0 ? (activeTrucks[matchIndex]?.truckNumber || "") : "";
}

function getPreferredTruckForDriver(driverName) {
  const matched = getMatchedTruckForDriver(driverName);
  if (matched) return matched;
  const activeDrivers = getActiveDrivers();
  const activeTrucks = getActiveTrucks();
  const matchIndex = activeDrivers.findIndex((item) => item.name === driverName);
  return matchIndex >= 0 ? (activeTrucks[matchIndex]?.truckNumber || "") : "";
}

function buildWeekTemplateRows(weekKeys, actualWeekRows = []) {
  const uniqueActualRows = dedupeRosterRows(actualWeekRows);
  const activeDrivers = getActiveDrivers().slice(0, TARGET_DRIVERS);
  const activeTrucks = getActiveTrucks().slice(0, TARGET_TRUCKS);
  const existingDriverDates = new Set();
  const existingTruckDates = new Set();
  const templateRows = [];

  uniqueActualRows.forEach((row) => {
    const driverName = String(row.driverName || "").trim();
    const truckNumber = String(row.truckNumber || "").trim();
    const shiftDate = String(row.shiftDate || "").trim();
    if (driverName && shiftDate) existingDriverDates.add(`${driverName}__${shiftDate}`);
    if (truckNumber && shiftDate) existingTruckDates.add(`${truckNumber}__${shiftDate}`);
  });

  activeDrivers.forEach((driver, index) => {
    const driverName = String(driver.name || "").trim();
    const truckNumber = String(activeTrucks[index]?.truckNumber || "").trim();
    if (!driverName || !truckNumber) return;

    weekKeys.slice(0, 5).forEach((shiftDate) => {
      if (existingDriverDates.has(`${driverName}__${shiftDate}`) || existingTruckDates.has(`${truckNumber}__${shiftDate}`)) return;
      templateRows.push({
        id: `template-${shiftDate}-${driver.id || index}`,
        driverName,
        truckNumber,
        nightRun: false,
        shiftDate,
        shiftTime: DEFAULT_SHIFT_TIME,
        route: DEFAULT_ROUTE,
        status: "Scheduled",
        isTemplate: true
      });
    });
  });

  return templateRows;
}

function getAssignedTruckNumbersForDate(dateKey, excludeId = "") {
  if (!dateKey) return new Set();
  return new Set(
    state.roster
      .filter((row) => row.shiftDate === dateKey && row.id !== excludeId)
      .map((row) => String(row.truckNumber || "").trim())
      .filter(Boolean)
  );
}

function getAvailableTruckNumbers(dateKey, excludeId = "") {
  const activeTruckNumbers = getActiveTrucks().map((item) => String(item.truckNumber || "").trim()).filter(Boolean);
  if (!dateKey) return activeTruckNumbers;
  const assigned = getAssignedTruckNumbersForDate(dateKey, excludeId);
  return activeTruckNumbers.filter((truckNumber) => !assigned.has(truckNumber));
}

function setSelectOptions(selectId, values, placeholder, currentValue = "") {
  const select = document.getElementById(selectId);
  if (!select) return;

  const uniqueValues = [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  if (currentValue && !uniqueValues.includes(currentValue)) {
    uniqueValues.unshift(currentValue);
  }

  select.innerHTML = [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...uniqueValues.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
  ].join("");

  select.value = currentValue || "";
}

function populateRosterPickers(selectedDriver = "", selectedTruck = "", options = {}) {
  const driverNames = getActiveDrivers().map((item) => item.name || "");
  setSelectOptions("driverName", driverNames, "Select driver", selectedDriver);

  const shiftDate = document.getElementById("shiftDate")?.value || "";
  const editId = document.getElementById("rosterId")?.value || "";
  const availableTruckNumbers = getAvailableTruckNumbers(shiftDate, editId);
  const matchedTruck = getMatchedTruckForDriver(selectedDriver);
  const placeholder = shiftDate ? "Select available truck" : "Select truck";

  let nextTruck = selectedTruck;
  if (options.preferMatched) {
    nextTruck = availableTruckNumbers.includes(matchedTruck) ? matchedTruck : (availableTruckNumbers[0] || "");
  } else if (!nextTruck || !availableTruckNumbers.includes(nextTruck)) {
    nextTruck = availableTruckNumbers.includes(matchedTruck) ? matchedTruck : (availableTruckNumbers[0] || "");
  }

  if (options.preserveSelectedTruck && selectedTruck) {
    nextTruck = selectedTruck;
  }

  setSelectOptions("truckNumber", availableTruckNumbers, placeholder, nextTruck);
}

function syncStatusDependentFields() {
  const statusField = document.getElementById("rosterStatus");
  const truckField = document.getElementById("truckNumber");
  const timeField = document.getElementById("shiftTime");
  const routeField = document.getElementById("route");
  const nightRunField = document.getElementById("rosterNightRun");
  if (!statusField || !truckField || !timeField || !routeField || !nightRunField) return;

  if (statusField.value === "Leave") {
    truckField.required = false;
    truckField.disabled = true;
    truckField.value = "";
    nightRunField.checked = false;
    nightRunField.disabled = true;
    if (!timeField.value || timeField.value === DEFAULT_SHIFT_TIME) timeField.value = LEAVE_SHIFT_TIME;
    if (!routeField.value || routeField.value === DEFAULT_ROUTE) routeField.value = LEAVE_ROUTE;
    return;
  }

  truckField.disabled = false;
  truckField.required = true;
  nightRunField.disabled = false;
  if (timeField.value === LEAVE_SHIFT_TIME) timeField.value = DEFAULT_SHIFT_TIME;
  if (routeField.value === LEAVE_ROUTE) routeField.value = DEFAULT_ROUTE;
}

function scrollFormIntoView() {
  document.getElementById("rosterForm")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

function loadTemplateIntoForm(item) {
  document.getElementById("rosterForm").reset();
  document.getElementById("rosterId").value = "";
  document.getElementById("shiftDate").value = item.shiftDate || "";
  document.getElementById("driverName").value = item.driverName || "";
  document.getElementById("truckNumber").value = item.truckNumber || "";
  document.getElementById("rosterNightRun").checked = Boolean(item.nightRun);
  document.getElementById("shiftTime").value = item.shiftTime || DEFAULT_SHIFT_TIME;
  document.getElementById("route").value = item.route || DEFAULT_ROUTE;
  document.getElementById("rosterStatus").value = item.status || "Scheduled";
  populateRosterPickers(item.driverName || "", item.truckNumber || "", { preserveSelectedTruck: true });
  syncStatusDependentFields();
  resetBatchControls();
  scrollFormIntoView();
}

function hasTruckConflict(truckNumber, shiftDate, excludeIds = []) {
  if (!truckNumber || !shiftDate) return false;
  const exclusions = new Set(excludeIds);
  return state.roster.some((row) => row.shiftDate === shiftDate && row.truckNumber === truckNumber && !exclusions.has(row.id));
}

function applyBoardMoveOrSwap(sourceId, targetMeta, targetShiftId = "") {
  const source = state.roster.find((row) => row.id === sourceId);
  if (!source) return;

  const targetDriverName = String(targetMeta?.driverName || "").trim();
  const targetShiftDate = String(targetMeta?.shiftDate || "").trim();
  const targetTruckNumber = String(targetMeta?.truckNumber || "").trim() || getPreferredTruckForDriver(targetDriverName);
  if (!targetDriverName || !targetShiftDate) return;

  if (targetShiftId && targetShiftId !== sourceId) {
    const target = state.roster.find((row) => row.id === targetShiftId);
    if (!target) return;

    const nextSource = normalizeRosterPayload({
      ...source,
      driverName: target.driverName,
      shiftDate: target.shiftDate,
      truckNumber: source.status === "Leave" ? "" : (target.truckNumber || getPreferredTruckForDriver(target.driverName))
    });
    const nextTarget = normalizeRosterPayload({
      ...target,
      driverName: source.driverName,
      shiftDate: source.shiftDate,
      truckNumber: target.status === "Leave" ? "" : (source.truckNumber || getPreferredTruckForDriver(source.driverName))
    });

    if (nextSource.truckNumber && hasTruckConflict(nextSource.truckNumber, nextSource.shiftDate, [source.id, target.id])) {
      alert(`Truck ${nextSource.truckNumber} is already assigned on ${nextSource.shiftDate}.`);
      return;
    }
    if (nextTarget.truckNumber && hasTruckConflict(nextTarget.truckNumber, nextTarget.shiftDate, [source.id, target.id])) {
      alert(`Truck ${nextTarget.truckNumber} is already assigned on ${nextTarget.shiftDate}.`);
      return;
    }

    state.roster = state.roster.map((row) => {
      if (row.id === source.id) return nextSource;
      if (row.id === target.id) return nextTarget;
      return row;
    });
    saveData();
    refreshWeekView();
    return;
  }

  const nextSource = normalizeRosterPayload({
    ...source,
    driverName: targetDriverName,
    shiftDate: targetShiftDate,
    truckNumber: source.status === "Leave" ? "" : (targetTruckNumber || source.truckNumber)
  });

  if (nextSource.truckNumber && hasTruckConflict(nextSource.truckNumber, nextSource.shiftDate, [source.id])) {
    alert(`Truck ${nextSource.truckNumber} is already assigned on ${nextSource.shiftDate}.`);
    return;
  }

  state.roster = state.roster.map((row) => row.id === source.id ? nextSource : row);
  saveData();
  refreshWeekView();
}

function getBatchToggle() {
  return document.getElementById("batchAddWeekdays");
}

function getBatchWeekdayInputs() {
  return Array.from(document.querySelectorAll("input[name='weekdayBatch']"));
}

function syncBatchControls() {
  const toggle = getBatchToggle();
  const grid = document.getElementById("weekdayBatchGrid");
  if (!toggle || !grid) return;

  const isEditing = Boolean(document.getElementById("rosterId")?.value);
  const batchActive = !isEditing && toggle.checked;
  toggle.disabled = isEditing;
  grid.classList.toggle("is-disabled", !batchActive);
  getBatchWeekdayInputs().forEach((input) => {
    input.disabled = !batchActive;
  });
}

function resetBatchControls() {
  const toggle = getBatchToggle();
  if (toggle) toggle.checked = false;
  getBatchWeekdayInputs().forEach((input) => {
    input.checked = true;
  });
  syncBatchControls();
}

function getBatchShiftDates(anchorDate) {
  const toggle = getBatchToggle();
  if (!toggle || !toggle.checked) return [];

  const monday = mondayOf(anchorDate);
  if (!monday) return [];

  return getBatchWeekdayInputs()
    .filter((input) => input.checked)
    .map((input) => Number(input.value))
    .filter((offset) => Number.isInteger(offset) && offset >= 0 && offset <= 4)
    .map((offset) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + offset);
      return dateToKey(date);
    });
}

function isTruckAvailableForDate(truckNumber, shiftDate, excludeId = "") {
  if (!truckNumber || !shiftDate) return false;
  return !getAssignedTruckNumbersForDate(shiftDate, excludeId).has(String(truckNumber || "").trim());
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

function displayTruckNumber(item) {
  return item.status === "Leave" ? "-" : (item.truckNumber || "-");
}

function displayShiftTime(item) {
  return item.shiftTime || (item.status === "Leave" ? LEAVE_SHIFT_TIME : DEFAULT_SHIFT_TIME);
}

function displayRoute(item) {
  return item.route || (item.status === "Leave" ? LEAVE_ROUTE : DEFAULT_ROUTE);
}

function openShiftContact(channel, item) {
  const contact = getDriverContactByName(item.driverName);
  const phone = cleanPhone(contact.phone);
  const nightRunText = item.nightRun ? " plus Night Run" : "";
  const message = `Hi ${item.driverName}, your Onpoint Express shift is ${item.shiftDate} from ${item.shiftTime} with truck ${item.truckNumber} on route ${item.route}${nightRunText}. Status: ${item.status}.`;

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

function drawBoardLegend() {
  const legend = document.getElementById("rosterBoardLegend");
  if (!legend) return;

  const items = [
    { tone: "live", label: "Scheduled" },
    { tone: "done", label: "Completed" },
    { tone: "leave", label: "Leave" },
    { tone: "night", label: "Night Run +" },
    { tone: "weekend", label: "Weekend lane" }
  ];

  legend.innerHTML = items.map((item) => `<div class="legend-chip"><span class="legend-dot ${item.tone}"></span>${item.label}</div>`).join("");
}

function drawStats() {
  const panel = document.getElementById("rosterStats");
  if (!auth.can("viewStats")) {
    panel.style.display = "none";
    return;
  }

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

function buildBoardRowMarkup(plan, weekKeys) {
  const cells = weekKeys.map((dayKey, index) => {
    const items = plan.assignments[dayKey] || [];
    if (!items.length) {
      return `<td class='board-cell board-cell-empty ${index >= 5 ? "weekend-col" : ""}' data-drop-date='${dayKey}' data-drop-driver='${escapeHtml(plan.driverName)}' data-drop-truck='${escapeHtml(plan.truckNumber || "")}'><span>Off</span></td>`;
    }

    const cellBody = items.map((item) => {
      const isLeave = item.status === "Leave";
      const tone = isLeave ? "board-badge-leave" : item.status === "Completed" ? "board-badge-done" : "board-badge-live";
      const runLabel = item.nightRun ? "<span>Night Run +</span>" : "";
      const templateLabel = item.isTemplate ? "<span>Template</span>" : "";
      const deleteButton = !item.isTemplate && auth.can("editRoster")
        ? `<button type='button' class='board-chip-delete' data-board-delete='${escapeHtml(item.id)}' aria-label='Delete shift for ${escapeHtml(item.driverName)} on ${escapeHtml(item.shiftDate)}' title='Delete shift'>&times;</button>`
        : "";
      const primaryLabel = isLeave ? "On Leave" : displayTruckNumber(item);
      const detailLabel = isLeave ? "Unavailable today" : normalizeRouteLabel(displayRoute(item));
      const badgeLabel = isLeave ? "Away" : item.status;
      return `<div class='board-chip ${item.isTemplate ? "board-chip-template" : "board-chip-movable"} ${isLeave ? "board-chip-leave" : ""} ${item.nightRun ? "board-chip-night" : ""} ${index >= 5 ? "weekend-col" : ""}'
        data-board-id='${escapeHtml(item.id)}'
        data-board-driver='${escapeHtml(item.driverName)}'
        data-board-date='${escapeHtml(item.shiftDate)}'
        data-board-truck='${escapeHtml(item.truckNumber || "")}'
        data-board-status='${escapeHtml(item.status)}'
        data-board-shift-time='${escapeHtml(item.shiftTime || "")}'
        data-board-route='${escapeHtml(item.route || "")}'
        data-board-night-run='${item.nightRun ? "true" : "false"}'
        data-template='${item.isTemplate ? "true" : "false"}'
        draggable='${!item.isTemplate && auth.can("editRoster") ? "true" : "false"}'
        title='${item.isTemplate ? "Click to load this template into the form." : auth.can("editRoster") ? "Click to edit or drag to move/swap this shift." : "Shift card"}'>
        ${deleteButton}
        <strong>${primaryLabel}</strong>
        ${templateLabel}
        ${runLabel}
        <span>${detailLabel}</span>
        <em class='board-badge ${tone}'>${badgeLabel}</em>
      </div>`;
    }).join("");

    return `<td class='board-cell ${index >= 5 ? "weekend-col" : ""}' data-drop-date='${dayKey}' data-drop-driver='${escapeHtml(plan.driverName)}' data-drop-truck='${escapeHtml(plan.truckNumber || "")}'>${cellBody}</td>`;
  }).join("");

  const tone = targetTone(plan.plannedDays);
  const fillPercent = Math.min((plan.plannedDays / TARGET_DAYS_PER_DRIVER) * 100, 100);
  const nightRuns = Object.values(plan.assignments).flat().filter((item) => item.nightRun).length;
  const leaveDays = Object.values(plan.assignments).flat().filter((item) => item.status === "Leave").length;
  const signature = [
    plan.driverName,
    plan.truckNumber,
    plan.plannedDays,
    plan.weekdayDays,
    plan.weekendDays,
    nightRuns,
    leaveDays,
    weekKeys.map((dayKey) => (plan.assignments[dayKey] || []).map((item) => `${item.id}:${item.status}:${item.truckNumber}:${item.nightRun ? 1 : 0}:${item.isTemplate ? 1 : 0}`).join("|")).join("~")
  ].join("::");

  return {
    key: plan.driverName,
    signature,
    markup: `<tr data-driver-key='${escapeHtml(plan.driverName)}' data-render-signature='${escapeHtml(signature)}'>
      <td class='board-driver-cell'>
        <div class='board-driver-name'>
          <strong>${plan.driverName}</strong>
          ${plan.isPlaceholder ? "<span class='board-slot-badge'>Open slot</span>" : `<span class='board-driver-meta'>Primary truck ${plan.truckNumber || "-"} | ${nightRuns} night run${nightRuns === 1 ? "" : "s"} | ${leaveDays} leave day${leaveDays === 1 ? "" : "s"}</span>`}
        </div>
      </td>
      ${cells}
      <td>
        <div class='load-indicator ${tone}'>
          <strong>${plan.plannedDays}/${TARGET_DAYS_PER_DRIVER}</strong>
          <span>${plan.weekdayDays} weekday | ${plan.weekendDays} weekend</span>
          <div class='load-meter'><span class='load-meter-fill' style='width:${fillPercent}%;'></span></div>
        </div>
      </td>
    </tr>`
  };
}

function drawDriverBoard() {
  const body = document.getElementById("rosterDriverBoardBody");
  const summary = document.getElementById("rosterBoardSummary");
  const notes = document.getElementById("rosterCoverageNotes");
  const { weekRows, weekKeys } = getWeekContext();
  const driverPlans = buildDriverPlans(weekRows);

  if (!driverPlans.length) {
    setMarkupIfChanged(body, `<tr><td colspan='9' class='empty'>No active drivers found yet. Add drivers on the Drivers page or create shifts for this week.</td></tr>`);
    setTextIfChanged(summary, "Weekly board is waiting for driver assignments.");
    setMarkupIfChanged(notes, "");
    return;
  }

  patchKeyedChildren(body, driverPlans.map((plan) => buildBoardRowMarkup(plan, weekKeys)), "data-driver-key");

  const onTarget = driverPlans.filter((plan) => plan.plannedDays >= TARGET_DAYS_PER_DRIVER).length;
  const underTarget = driverPlans.filter((plan) => plan.plannedDays < TARGET_DAYS_PER_DRIVER).length;
  const weekendDrivers = driverPlans.filter((plan) => plan.weekendDays > 0).length;
  const nightRunDrivers = driverPlans.filter((plan) => Object.values(plan.assignments).flat().some((item) => item.nightRun)).length;
  setTextIfChanged(summary, `${driverPlans.length} drivers are shown on the weekly board. ${onTarget} have hit the 5-day target, ${underTarget} still need more coverage, ${weekendDrivers} are carrying weekend work, and ${nightRunDrivers} are covering Night Run +.`);

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
    },
    {
      label: "Night Run +",
      value: `${nightRunDrivers} drivers`,
      detail: nightRunDrivers ? "Night Run coverage is assigned as an extra layer after the main shift." : "No Night Run + cover is marked this week."
    }
  ];

  setMarkupIfChanged(notes, coverageItems.map((item) => `<article class='note-card'><p>${item.label}</p><h3>${item.value}</h3><span>${item.detail}</span></article>`).join(""));
}

function drawWeekTable() {
  const tbody = document.getElementById("weeklyRosterTableBody");
  const { weekKey, weekDates, weekRows } = getWeekContext();
  const query = (document.getElementById("rosterSearch")?.value || "").trim().toLowerCase();
  const statusFilter = document.getElementById("rosterFilterStatus")?.value || "";
  if (!weekKey) {
    setMarkupIfChanged(tbody, `<tr><td colspan='8' class='empty'>Choose a valid week start.</td></tr>`);
    return;
  }

  const rows = [];

  weekDates.forEach((dateObj, idx) => {
    const key = dateToKey(dateObj);
    const entries = weekRows
      .filter((x) => x.shiftDate === key)
      .filter((x) => !statusFilter || x.status === statusFilter)
      .filter((x) => {
        if (!query) return true;
        const hay = `${x.driverName} ${x.truckNumber} ${x.nightRun ? "night run" : ""} ${x.shiftTime} ${x.route} ${x.status} ${x.isTemplate ? "template" : ""}`.toLowerCase();
        return hay.includes(query);
      })
      .sort((a, b) => {
        const timeCompare = a.shiftTime.localeCompare(b.shiftTime);
        if (timeCompare !== 0) return timeCompare;
        return String(a.driverName || "").localeCompare(String(b.driverName || ""));
      });

    if (!entries.length) {
      rows.push(`<tr><td>${DAY_NAMES[idx]}</td><td>${key}</td><td colspan='6' class='muted'>No shifts</td></tr>`);
      return;
    }

    entries.forEach((item, rowIndex) => {
      const rowClass = [
        item.status === "Leave" ? "row-leave-highlight" : "",
        item.isTemplate ? "row-template-highlight" : ""
      ].filter(Boolean).join(" ");
      const rowActions = item.isTemplate ? "<span class='muted'>Week template</span>" : renderRosterContactButtons(item);
      const adminActions = item.isTemplate
        ? "<span class='muted'>Template</span>"
        : auth.can("editRoster")
        ? `<div class='table-actions'><button data-action='edit' data-id='${item.id}'>Edit</button><button data-action='delete' data-id='${item.id}'>Delete</button></div>`
        : "<span class='muted'>View only</span>";
      rows.push(`<tr class='${rowClass}'>
        <td>${rowIndex === 0 ? DAY_NAMES[idx] : ""}</td>
        <td>${rowIndex === 0 ? key : ""}</td>
        <td>${item.driverName}</td>
        <td>${item.nightRun ? "Yes" : "-"}</td>
        <td>${displayShiftTime(item)}</td>
        <td>${displayRoute(item)}</td>
        <td>${item.status}</td>
        <td><div class='table-actions table-actions-stack'>${rowActions}${adminActions}</div></td>
      </tr>`);
    });
  });

  setMarkupIfChanged(tbody, rows.join(""));
}

function refreshWeekViewNow() {
  drawStats();
  drawDriverBoard();
  drawWeekTable();
}

function refreshWeekView() {
  if (weekRenderState.queued) return;
  weekRenderState.queued = true;
  window.requestAnimationFrame(() => {
    weekRenderState.queued = false;
    refreshWeekViewNow();
  });
}

function refresh() {
  const isEditing = Boolean(document.getElementById("rosterId")?.value);
  populateRosterPickers(
    document.getElementById("driverName")?.value || "",
    document.getElementById("truckNumber")?.value || "",
    { preserveSelectedTruck: isEditing }
  );
  syncBatchControls();
  drawBoardLegend();
  drawRosterModel();
  refreshWeekViewNow();
}

function setForm(item) {
  document.getElementById("rosterId").value = item.id;
  document.getElementById("shiftDate").value = item.shiftDate;
  document.getElementById("driverName").value = item.driverName;
  document.getElementById("truckNumber").value = item.truckNumber;
  document.getElementById("rosterNightRun").checked = Boolean(item.nightRun);
  document.getElementById("shiftTime").value = item.shiftTime;
  document.getElementById("route").value = item.route;
  document.getElementById("rosterStatus").value = item.status;
  populateRosterPickers(item.driverName, item.truckNumber, { preserveSelectedTruck: true });
  syncStatusDependentFields();
  resetBatchControls();
}

function materializeWeekTemplate() {
  const { weekKeys, actualWeekRows } = getWeekContext();
  const templateRows = buildWeekTemplateRows(weekKeys, actualWeekRows).map(({ isTemplate, ...row }) => ({
    ...row,
    id: uid()
  }));
  if (!templateRows.length) {
    alert("This week template is already saved.");
    return;
  }
  state.roster = [...state.roster, ...templateRows];
  state.roster = dedupeRosterRows(state.roster);
  saveData();
  refreshWeekView();
}

function applyAccess() {
  document.getElementById("currentUserChip").textContent = `User: ${auth.user.username}`;
  if (!auth.can("accessControlPanel")) document.getElementById("controlPanelLink").style.display = "none";
  if (!auth.can("accessLogs")) document.querySelector("a[href='./log.html']").style.display = "none";
  if (!(auth.can("viewTruckIncome") || auth.can("viewSpending") || auth.can("viewPayslips") || auth.can("viewStats"))) {
    const link = document.getElementById("financeLink");
    if (link) link.style.display = "none";
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
  const basePayload = normalizeRosterPayload({
    driverName: document.getElementById("driverName").value.trim(),
    truckNumber: document.getElementById("truckNumber").value.trim(),
    nightRun: document.getElementById("rosterNightRun").checked,
    shiftDate: document.getElementById("shiftDate").value,
    shiftTime: document.getElementById("shiftTime").value.trim(),
    route: document.getElementById("route").value.trim(),
    status: document.getElementById("rosterStatus").value
  });

  if (!basePayload.driverName || !basePayload.shiftDate) {
    alert("Choose a driver and date first.");
    return;
  }
  if (basePayload.status !== "Leave" && (!basePayload.truckNumber || !basePayload.shiftTime || !basePayload.route)) {
    alert("Driver, truck, time, and route are required for a real shift.");
    return;
  }

  if (id) {
    if (basePayload.truckNumber && !isTruckAvailableForDate(basePayload.truckNumber, basePayload.shiftDate, id)) {
      alert(`Truck ${basePayload.truckNumber} is already assigned on ${basePayload.shiftDate}. Choose another truck or date.`);
      return;
    }
    const payload = { ...basePayload, id };
    state.roster = state.roster
      .filter((row) => row.id === id || !(row.driverName === payload.driverName && row.shiftDate === payload.shiftDate))
      .map((row) => row.id === id ? payload : row);
  } else {
    const batchDates = getBatchShiftDates(basePayload.shiftDate);
    if (getBatchToggle()?.checked && !batchDates.length) {
      alert("Choose at least one weekday for the batch add, or untick Weekday Batch for a single shift.");
      return;
    }
    const targetDates = batchDates.length ? batchDates : [basePayload.shiftDate];
    const createdRows = [];
    const skippedDates = [];

    targetDates.forEach((shiftDate) => {
      if (basePayload.truckNumber && !isTruckAvailableForDate(basePayload.truckNumber, shiftDate)) {
        skippedDates.push(shiftDate);
        return;
      }
      createdRows.push({
        ...basePayload,
        id: uid(),
        shiftDate
      });
    });

    if (!createdRows.length) {
      alert(`Truck ${basePayload.truckNumber} is already assigned on the selected day(s). Choose another truck or date.`);
      return;
    }

    const targetKeys = new Set(createdRows.map((row) => `${row.driverName}__${row.shiftDate}`));
    state.roster = [
      ...state.roster.filter((row) => !targetKeys.has(`${row.driverName}__${row.shiftDate}`)),
      ...createdRows
    ];
    if (skippedDates.length) {
      alert(`Created ${createdRows.length} shift(s). Skipped these dates because truck ${basePayload.truckNumber} is already assigned: ${skippedDates.join(", ")}`);
    }
  }

  state.roster = dedupeRosterRows(state.roster);
  saveData();
  e.target.reset();
  document.getElementById("rosterId").value = "";
  resetBatchControls();
  populateRosterPickers();

  const monday = mondayOf(basePayload.shiftDate);
  if (monday) {
    document.getElementById("weekStart").value = dateToKey(monday);
  }

  refreshWeekView();
});

document.getElementById("cancelRosterEdit").addEventListener("click", () => {
  document.getElementById("rosterForm").reset();
  document.getElementById("rosterId").value = "";
  resetBatchControls();
  populateRosterPickers();
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

document.getElementById("weekStart").addEventListener("change", refreshWeekView);
document.getElementById("rosterSearch").addEventListener("input", refreshWeekView);
document.getElementById("rosterFilterStatus").addEventListener("change", refreshWeekView);
document.getElementById("rosterStatus").addEventListener("change", () => {
  syncStatusDependentFields();
  populateRosterPickers(
    document.getElementById("driverName").value,
    document.getElementById("truckNumber").value,
    { preferMatched: true, preserveSelectedTruck: document.getElementById("rosterStatus").value === "Leave" }
  );
});
document.getElementById("driverName").addEventListener("change", () => {
  populateRosterPickers(
    document.getElementById("driverName").value,
    document.getElementById("truckNumber").value,
    { preferMatched: true }
  );
});
document.getElementById("shiftDate").addEventListener("change", () => {
  populateRosterPickers(
    document.getElementById("driverName").value,
    document.getElementById("truckNumber").value,
    { preferMatched: true }
  );
});
getBatchToggle()?.addEventListener("change", syncBatchControls);
document.getElementById("saveWeekTemplate")?.addEventListener("click", () => {
  if (!auth.can("editRoster")) return;
  materializeWeekTemplate();
});
document.getElementById("clearRosterFilters").addEventListener("click", () => {
  document.getElementById("rosterSearch").value = "";
  document.getElementById("rosterFilterStatus").value = "";
  const monday = mondayOf(todayKey());
  if (monday) {
    document.getElementById("weekStart").value = dateToKey(monday);
  } else {
    document.getElementById("weekStart").value = "";
  }
  refreshWeekView();
});

document.body.addEventListener("click", (e) => {
  const boardDelete = e.target.closest(".board-chip-delete[data-board-delete]");
  if (boardDelete) {
    e.stopPropagation();
    if (!auth.can("editRoster")) return;
    const id = boardDelete.dataset.boardDelete || "";
    const item = state.roster.find((row) => row.id === id);
    if (!item) return;
    if (!confirm(`Delete shift for ${item.driverName} on ${item.shiftDate}?`)) return;
    state.roster = state.roster.filter((row) => row.id !== id);
    saveData();
    refreshWeekView();
    return;
  }

  const boardChip = e.target.closest(".board-chip[data-board-id]");
  if (boardChip) {
    const boardItem = {
      id: boardChip.dataset.boardId || "",
      driverName: boardChip.dataset.boardDriver || "",
      shiftDate: boardChip.dataset.boardDate || "",
      truckNumber: boardChip.dataset.boardTruck || "",
      status: boardChip.dataset.boardStatus || "Scheduled",
      shiftTime: boardChip.dataset.boardShiftTime || "",
      route: boardChip.dataset.boardRoute || "",
      nightRun: boardChip.dataset.boardNightRun === "true",
      isTemplate: boardChip.dataset.template === "true"
    };

    if (boardItem.isTemplate) {
      loadTemplateIntoForm(boardItem);
    } else {
      const saved = state.roster.find((row) => row.id === boardItem.id);
      if (saved) setForm(saved);
    }
    return;
  }

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
    refreshWeekView();
  }
});

document.body.addEventListener("dragstart", (event) => {
  const chip = event.target.closest(".board-chip[data-board-id]");
  if (!chip || chip.dataset.template === "true" || !auth.can("editRoster")) return;
  boardDragState.shiftId = chip.dataset.boardId || "";
  chip.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", boardDragState.shiftId);
});

document.body.addEventListener("dragend", (event) => {
  const chip = event.target.closest(".board-chip[data-board-id]");
  if (chip) chip.classList.remove("is-dragging");
  boardDragState.shiftId = "";
  document.querySelectorAll(".board-cell.is-drop-target").forEach((cell) => cell.classList.remove("is-drop-target"));
});

document.body.addEventListener("dragover", (event) => {
  const cell = event.target.closest(".board-cell[data-drop-date]");
  if (!cell || !boardDragState.shiftId || !auth.can("editRoster")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  cell.classList.add("is-drop-target");
});

document.body.addEventListener("dragleave", (event) => {
  const cell = event.target.closest(".board-cell[data-drop-date]");
  if (cell) cell.classList.remove("is-drop-target");
});

document.body.addEventListener("drop", (event) => {
  const cell = event.target.closest(".board-cell[data-drop-date]");
  if (!cell || !boardDragState.shiftId || !auth.can("editRoster")) return;
  event.preventDefault();
  cell.classList.remove("is-drop-target");

  const targetChip = event.target.closest(".board-chip[data-board-id]");
  const targetShiftId = targetChip && targetChip.dataset.template !== "true" ? (targetChip.dataset.boardId || "") : "";
  applyBoardMoveOrSwap(
    boardDragState.shiftId,
    {
      driverName: cell.dataset.dropDriver || "",
      shiftDate: cell.dataset.dropDate || "",
      truckNumber: cell.dataset.dropTruck || ""
    },
    targetShiftId
  );
});

applyAccess();
ensureRosterReferenceFallbacks();
const todayMonday = mondayOf(todayKey());
if (todayMonday) {
  document.getElementById("weekStart").value = dateToKey(todayMonday);
}
resetBatchControls();
syncStatusDependentFields();
refresh();
void hydrateRosterReferencesFromSupabase();
void hydrateRosterFromSupabase();

if (!useSupabase) {
  window.addEventListener("opx:supabase-ready", () => {
    window.location.reload();
  }, { once: true });
}

window.addEventListener("storage", (event) => {
  if (event.key === DRIVERS_KEY || event.key === TRUCKS_KEY) {
    refresh();
  }
});
