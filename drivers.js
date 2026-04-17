const auth = window.OPXAuth?.requireAuth("./login.html");
if (!auth) throw new Error("Authentication required");

if (!auth.can("accessCRM") || !auth.can("viewDrivers")) {
  document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>You do not have permission to access the Drivers page.</p></section></main>";
  throw new Error("No drivers access");
}

const KEY = "transport_crm_drivers";
const LEGACY_CONTACT_KEY = "transport_crm_driver_contacts";
const DRIVERS_TABLE = "drivers";
const driversSupabase = window.OPXSupabase?.client || null;
const useSupabase = Boolean(window.OPXSupabase?.isReady && driversSupabase);
const legacyContacts = readLegacyContacts();
const state = { drivers: readData() };

function canManageDrivers() {
  return auth.can("viewDrivers");
}

function firstValue(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function normalizeDriverRow(row) {
  const raw = row && typeof row === "object" ? row : {};
  return {
    ...raw,
    id: String(firstValue(raw, ["id", "driverId", "driver_id"]) || ""),
    name: String(firstValue(raw, ["name", "driverName", "driver", "fullName", "driver_name"]) || ""),
    phone: String(firstValue(raw, ["phone", "mobile", "phoneNumber", "phone_number", "contactNumber"]) || ""),
    email: String(firstValue(raw, ["email", "emailAddress", "email_address"]) || ""),
    licenseNumber: String(firstValue(raw, ["licenseNumber", "licenceNumber", "license", "licence", "license_number"]) || ""),
    licenseExpiry: String(firstValue(raw, ["licenseExpiry", "licenceExpiry", "license_expiry", "licence_expiry"]) || ""),
    hireDate: String(firstValue(raw, ["hireDate", "startDate", "hire_date", "start_date"]) || ""),
    status: String(firstValue(raw, ["status", "driverStatus", "driver_status"]) || "Active"),
    address: String(firstValue(raw, ["address", "homeAddress", "home_address"]) || ""),
    emergencyContact: String(firstValue(raw, ["emergencyContact", "emergency", "nextOfKin", "emergency_contact"]) || "")
  };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}${Math.random().toString(16).slice(2, 10)}`.slice(0, 32);
}

function ensureUuidDrivers(rows) {
  let changed = false;
  const normalized = rows.map((row) => {
    if (isUuid(row.id)) return row;
    changed = true;
    return { ...row, id: newId() };
  });
  if (changed) {
    localStorage.setItem(KEY, JSON.stringify(normalized));
  }
  return normalized;
}

function readLegacyContacts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_CONTACT_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    const rows = Array.isArray(parsed) ? parsed.map(normalizeDriverRow) : [];
    return mergeLegacyEmails(ensureUuidDrivers(rows)).rows;
  } catch {
    return [];
  }
}

function mergeLegacyEmails(rows) {
  let changed = false;
  const merged = rows.map((row) => {
    const legacyEmail = String(legacyContacts?.[row.id]?.email || "").trim();
    if (row.email || !legacyEmail) return row;
    changed = true;
    return { ...row, email: legacyEmail };
  });
  return { rows: merged, changed };
}

function cleanupLegacyContactsForRows(rows) {
  let changed = false;
  rows.forEach((row) => {
    if (legacyContacts[row.id]) {
      delete legacyContacts[row.id];
      changed = true;
    }
  });
  if (changed) {
    localStorage.setItem(LEGACY_CONTACT_KEY, JSON.stringify(legacyContacts));
  }
}

function saveData() {
  localStorage.setItem(KEY, JSON.stringify(state.drivers));
  cleanupLegacyContactsForRows(state.drivers.filter((row) => row.email));
  if (useSupabase) {
    void syncDriversToSupabase();
  }
}

function uid() {
  return newId();
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

function openDriverContact(channel, item) {
  const email = String(item.email || "").trim();
  const phone = cleanPhone(item.phone);
  const message = `Hi ${item.name}, this is Onpoint Express.`;

  if (channel === "email") {
    if (!email) {
      alert(`No email saved for ${item.name} yet.`);
      return;
    }
    const subject = encodeURIComponent(`Onpoint Express update for ${item.name}`);
    const body = encodeURIComponent(`${message}\n\nPlease reply when you can.`);
    launchLink(`mailto:${email}?subject=${subject}&body=${body}`, "_self");
    return;
  }

  if (!phone) {
    alert(`No phone number saved for ${item.name} yet.`);
    return;
  }

  if (channel === "sms") {
    launchLink(`sms:${phone}?body=${encodeURIComponent(message)}`, "_self");
    return;
  }

  if (channel === "whatsapp") {
    const whatsappNumber = toWhatsAppNumber(phone);
    if (!whatsappNumber) {
      alert(`WhatsApp number is not valid for ${item.name}.`);
      return;
    }
    launchLink(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`);
  }
}

function renderContactButtons(item) {
  const email = String(item.email || "").trim();
  const hasPhone = Boolean(cleanPhone(item.phone));
  return `<div class='contact-actions'>
    <button type='button' class='contact-link contact-link-email' data-action='email-driver' data-id='${item.id}' ${email ? "" : "disabled"}>Email</button>
    <button type='button' class='contact-link contact-link-sms' data-action='sms-driver' data-id='${item.id}' ${hasPhone ? "" : "disabled"}>SMS</button>
    <button type='button' class='contact-link contact-link-whatsapp' data-action='whatsapp-driver' data-id='${item.id}' ${hasPhone ? "" : "disabled"}>WhatsApp</button>
  </div>`;
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

async function syncDriversToSupabase() {
  if (!useSupabase) return;
  const rows = state.drivers.map(toDbDriver);
  const { error } = await driversSupabase.from(DRIVERS_TABLE).upsert(rows, { onConflict: "id" });
  if (error) {
    console.error("Supabase sync failed for drivers:", error.message);
    return;
  }

  const ids = rows.map((r) => r.id);
  if (!ids.length) {
    const wipe = await driversSupabase.from(DRIVERS_TABLE).delete().not("id", "is", null);
    if (wipe.error) console.error("Supabase delete sync failed for drivers:", wipe.error.message);
    return;
  }

  const inList = `(${ids.map((id) => `"${String(id).replaceAll('"', "")}"`).join(",")})`;
  const cleanup = await driversSupabase.from(DRIVERS_TABLE).delete().not("id", "in", inList);
  if (cleanup.error) {
    console.error("Supabase cleanup failed for drivers:", cleanup.error.message);
  }
}

async function hydrateDriversFromSupabase() {
  if (!useSupabase) return;
  updateDataStatus("Checking shared driver data...");
  const { data, error } = await driversSupabase.from(DRIVERS_TABLE).select("*");
  if (error) {
    console.error("Supabase load failed for drivers:", error.message);
    updateDataStatus(`Shared driver data could not load: ${error.message}. Showing this device's saved driver data.`);
    return;
  }
  if (!Array.isArray(data)) return;
  if (!data.length && state.drivers.length) {
    console.warn("Supabase drivers table is empty; keeping local data and seeding Supabase.");
    await syncDriversToSupabase();
    refresh();
    return;
  }

  const merged = mergeLegacyEmails(data.map(fromDbDriver));
  state.drivers = merged.rows;
  localStorage.setItem(KEY, JSON.stringify(state.drivers));
  cleanupLegacyContactsForRows(state.drivers.filter((row) => row.email));
  if (merged.changed) {
    await syncDriversToSupabase();
  }
  refresh();
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const body = rows.map((r) => headers.map((h) => esc(r[h])).join(",")).join("\n");
  return `${headers.join(",")}\n${body}`;
}

function drawStats() {
  const active = state.drivers.filter((d) => d.status === "Active").length;
  const onLeave = state.drivers.filter((d) => d.status === "On Leave").length;
  const stats = [
    { label: "Total Drivers", value: String(state.drivers.length) },
    { label: "Active", value: String(active) },
    { label: "On Leave", value: String(onLeave) }
  ];

  const grid = document.getElementById("driversStats");
  if (!auth.can("viewStats")) {
    grid.style.display = "none";
    return;
  }

  grid.style.display = "grid";
  grid.innerHTML = stats.map((s) => `<article class='stat-card'><p>${s.label}</p><h3>${s.value}</h3></article>`).join("");
}

function drawTable() {
  const tbody = document.getElementById("driversTableBody");
  const query = (document.getElementById("driversSearch")?.value || "").trim().toLowerCase();
  const filtered = state.drivers.filter((item) => {
    if (!query) return true;
    const hay = Object.values(item).concat([
      item.name,
      item.phone,
      item.email,
      item.licenseNumber,
      item.licenseExpiry,
      item.hireDate,
      item.status,
      item.address,
      item.emergencyContact
    ]).join(" ").toLowerCase();
    return hay.includes(query);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan='6' class='empty'>${query ? "No drivers match your search." : "No drivers yet."}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    .map((item) => {
      const adminActions = canManageDrivers()
        ? `<div class='table-actions'><button data-action='edit' data-id='${item.id}'>Edit</button><button data-action='delete' data-id='${item.id}'>Delete</button></div>`
        : "<span class='muted'>View only</span>";
      return `<tr><td><strong>${item.name || "Unnamed driver"}</strong><div class='table-actions table-actions-stack'>${renderContactButtons(item)}${adminActions}</div></td><td>${item.phone || "-"}</td><td>${item.email || "-"}</td><td>${item.licenseNumber || "-"}</td><td>${item.status || "-"}</td><td>${item.emergencyContact || "-"}</td></tr>`;
    })
    .join("");
}

function refresh() {
  state.drivers = readData();
  drawStats();
  drawTable();
  updateDataStatus(null, getFilteredDriverCount());
}

function getFilteredDriverCount() {
  const query = (document.getElementById("driversSearch")?.value || "").trim().toLowerCase();
  if (!query) return state.drivers.length;
  return state.drivers.filter((item) => Object.values(item).join(" ").toLowerCase().includes(query)).length;
}

function updateDataStatus(message, visibleCount = state.drivers.length) {
  const status = document.getElementById("driversDataStatus");
  if (!status) return;
  const query = (document.getElementById("driversSearch")?.value || "").trim();
  if (message) {
    status.textContent = message;
    return;
  }
  status.textContent = query
    ? `Search is active. Showing ${visibleCount} of ${state.drivers.length} driver record${state.drivers.length === 1 ? "" : "s"}.`
    : `Loaded ${state.drivers.length} driver record${state.drivers.length === 1 ? "" : "s"}. Edit and Delete are under each driver's name.`;
}

function setForm(item) {
  document.getElementById("driverDetailsId").value = item.id;
  document.getElementById("driverDetailsName").value = item.name;
  document.getElementById("driverPhone").value = item.phone;
  document.getElementById("driverEmail").value = item.email || "";
  document.getElementById("licenseNumber").value = item.licenseNumber;
  document.getElementById("licenseExpiry").value = item.licenseExpiry;
  document.getElementById("hireDate").value = item.hireDate;
  document.getElementById("driverStatus").value = item.status;
  document.getElementById("driverAddress").value = item.address || "";
  document.getElementById("emergencyContact").value = item.emergencyContact || "";
}

function applyAccessControl() {
  document.getElementById("currentUserChip").textContent = `User: ${auth.user.username}`;
  if (!auth.can("accessControlPanel")) document.getElementById("controlPanelLink").style.display = "none";

  if (!auth.can("accessLogs")) {
    document.querySelector("a[href='./log.html']").style.display = "none";
  }

  if (!auth.can("viewRoster")) {
    const rosterLink = document.getElementById("rosterLink");
    if (rosterLink) rosterLink.style.display = "none";
  }

  if (!(auth.can("viewTruckIncome") || auth.can("viewSpending") || auth.can("viewPayslips") || auth.can("viewStats"))) {
    const financeLink = document.getElementById("financeLink");
    if (financeLink) financeLink.style.display = "none";
  }

  if (!canManageDrivers()) {
    const form = document.getElementById("driversForm");
    Array.from(form.elements).forEach((element) => {
      if (element.type !== "hidden") element.disabled = true;
    });
    document.getElementById("exportDrivers").style.display = "none";
  }
}

document.getElementById("logoutBtn").addEventListener("click", () => {
  window.OPXAuth.logout();
  window.location.href = "./login.html";
});

document.getElementById("driversForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!canManageDrivers()) return;

  const id = document.getElementById("driverDetailsId").value;
  const payload = {
    id: id || uid(),
    name: document.getElementById("driverDetailsName").value.trim(),
    phone: document.getElementById("driverPhone").value.trim(),
    email: document.getElementById("driverEmail").value.trim(),
    licenseNumber: document.getElementById("licenseNumber").value.trim(),
    licenseExpiry: document.getElementById("licenseExpiry").value,
    hireDate: document.getElementById("hireDate").value,
    status: document.getElementById("driverStatus").value,
    address: document.getElementById("driverAddress").value.trim(),
    emergencyContact: document.getElementById("emergencyContact").value.trim()
  };

  state.drivers = id ? state.drivers.map((d) => d.id === id ? payload : d) : [...state.drivers, payload];
  saveData();
  e.target.reset();
  document.getElementById("driverDetailsId").value = "";
  refresh();
});

document.getElementById("cancelDriverEdit").addEventListener("click", () => {
  document.getElementById("driversForm").reset();
  document.getElementById("driverDetailsId").value = "";
});

document.getElementById("exportDrivers").addEventListener("click", () => {
  if (!canManageDrivers()) return;
  const csv = toCsv(state.drivers);
  if (!csv) return alert("No records to export.");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "drivers.csv";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("driversSearch").addEventListener("input", refresh);
document.getElementById("clearDriversFilters").addEventListener("click", () => {
  document.getElementById("driversSearch").value = "";
  refresh();
});

document.body.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;
  state.drivers = readData();
  const item = state.drivers.find((d) => d.id === id);

  if (action === "email-driver" || action === "sms-driver" || action === "whatsapp-driver") {
    if (!item) return;
    if (action === "email-driver") openDriverContact("email", item);
    if (action === "sms-driver") openDriverContact("sms", item);
    if (action === "whatsapp-driver") openDriverContact("whatsapp", item);
    return;
  }

  if (!canManageDrivers()) return;

  if (action === "edit") {
    if (item) setForm(item);
    return;
  }

  if (action === "delete") {
    if (item && !confirm(`Delete driver ${item.name}?`)) return;
    state.drivers = state.drivers.filter((d) => d.id !== id);
    if (legacyContacts[id]) {
      delete legacyContacts[id];
      localStorage.setItem(LEGACY_CONTACT_KEY, JSON.stringify(legacyContacts));
    }
    saveData();
    refresh();
  }
});

applyAccessControl();
refresh();
void hydrateDriversFromSupabase();

if (!useSupabase) {
  window.addEventListener("opx:supabase-ready", () => {
    window.location.reload();
  }, { once: true });
}
