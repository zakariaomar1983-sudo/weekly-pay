const auth = window.OPXAuth?.requireAuth("./login.html");
if (!auth) {
  throw new Error("Authentication required");
}

if (!auth.can("accessControlPanel")) {
  document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>You do not have permission to access the Control Panel.</p></section></main>";
  throw new Error("No control panel access");
}

const PERMISSIONS = window.OPXAuth.PERMISSIONS;
const supabase = window.OPXSupabase?.client || null;
const useSupabase = Boolean(window.OPXSupabase?.isReady && supabase);

document.getElementById("currentUserChip").textContent = `User: ${auth.user.username}`;

document.getElementById("logoutBtn").addEventListener("click", () => {
  try {
    if (window.OPXAuth?.logout) {
      window.OPXAuth.logout();
    } else {
      localStorage.removeItem("opx_auth_session");
    }
  } catch {
    localStorage.removeItem("opx_auth_session");
  }
  window.location.href = "./login.html?logout=1";
});

if (!auth.can("accessCRM")) {
  document.getElementById("openHomeBtn").style.display = "none";
  document.getElementById("openDriversBtn").style.display = "none";
  document.getElementById("openTrucksBtn").style.display = "none";
  document.getElementById("openRosterBtn").style.display = "none";
  document.getElementById("openFinanceBtn").style.display = "none";
}
if (!auth.can("viewDrivers")) {
  document.getElementById("openDriversBtn").style.display = "none";
}
if (!auth.can("viewTrucks")) {
  document.getElementById("openTrucksBtn").style.display = "none";
}
if (!auth.can("viewRoster")) {
  document.getElementById("openRosterBtn").style.display = "none";
}
if (!(auth.can("viewTruckIncome") || auth.can("viewSpending") || auth.can("viewPayslips") || auth.can("viewStats"))) {
  document.getElementById("openFinanceBtn").style.display = "none";
}
if (!auth.can("accessLogs")) {
  document.getElementById("openLogsBtn").style.display = "none";
}

function boolBadge(isTrue) {
  return isTrue ? "Active" : "Inactive";
}

function checkedPermissionsFromForm() {
  const out = {};
  PERMISSIONS.forEach((perm) => {
    out[perm.key] = Boolean(document.getElementById(`perm_${perm.key}`)?.checked);
  });
  return out;
}

function renderPermissionChecklist() {
  const grid = document.getElementById("permissionsGrid");
  grid.innerHTML = PERMISSIONS
    .map((perm) => `<label class="perm-item"><input type="checkbox" id="perm_${perm.key}" /> ${perm.label}</label>`)
    .join("");
}

function renderSecurityStats() {
  const roles = window.OPXAuth.getRoles();
  const users = window.OPXAuth.getUsers();
  const activeUsers = users.filter((u) => u.active).length;

  const stats = [
    { label: "Total Roles", value: String(roles.length) },
    { label: "Total Users", value: String(users.length) },
    { label: "Active Users", value: String(activeUsers) }
  ];

  document.getElementById("securityStats").innerHTML = stats
    .map((s) => `<article class="stat-card"><p>${s.label}</p><h3>${s.value}</h3></article>`)
    .join("");
}

function renderRoleOptions() {
  const roles = window.OPXAuth.getRoles();
  const select = document.getElementById("userRole");
  select.innerHTML = roles.map((role) => `<option value="${role.id}">${role.name}</option>`).join("");
}

function renderRolesTable() {
  const roles = window.OPXAuth.getRoles();
  const tbody = document.getElementById("rolesTableBody");

  if (!roles.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">No roles yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = roles
    .map((role) => {
      const enabledCount = Object.values(role.permissions || {}).filter(Boolean).length;
      const typeLabel = role.system ? "System" : "Custom";
      const actions = role.system
        ? "<span class='muted'>System role</span>"
        : `<div class='table-actions'><button data-action='edit-role' data-id='${role.id}'>Edit</button><button data-action='delete-role' data-id='${role.id}'>Delete</button></div>`;

      return `<tr><td>${role.name}</td><td>${typeLabel}</td><td>${enabledCount} enabled</td><td>${actions}</td></tr>`;
    })
    .join("");
}

function renderUsersTable() {
  const roles = window.OPXAuth.getRoles();
  const roleNameById = Object.fromEntries(roles.map((r) => [r.id, r.name]));
  const users = window.OPXAuth.getUsers();
  const tbody = document.getElementById("usersTableBody");

  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">No users yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = users
    .map((user) => `<tr><td>${user.username}</td><td>${roleNameById[user.roleId] || "Unknown"}</td><td>${boolBadge(user.active)}</td><td><div class='table-actions'><button data-action='edit-user' data-id='${user.id}'>Edit</button><button data-action='delete-user' data-id='${user.id}'>Delete</button></div></td></tr>`)
    .join("");
}

function resetRoleForm() {
  document.getElementById("roleForm").reset();
  document.getElementById("roleId").value = "";
}

function resetUserForm() {
  document.getElementById("userForm").reset();
  document.getElementById("userId").value = "";
  renderRoleOptions();
}

function fillRoleForm(role) {
  document.getElementById("roleId").value = role.id;
  document.getElementById("roleName").value = role.name;

  PERMISSIONS.forEach((perm) => {
    const checkbox = document.getElementById(`perm_${perm.key}`);
    if (checkbox) checkbox.checked = Boolean(role.permissions?.[perm.key]);
  });
}

function fillUserForm(user) {
  document.getElementById("userId").value = user.id;
  document.getElementById("userName").value = user.username;
  document.getElementById("userPassword").value = "";
  document.getElementById("userRole").value = user.roleId;
  document.getElementById("userActive").value = String(Boolean(user.active));
}

function refresh() {
  renderSecurityStats();
  renderRoleOptions();
  renderRolesTable();
  renderUsersTable();
}

const BACKUP_PREFIXES = ["transport_crm_", "opx_auth_"];
const BACKUP_EXCLUDE_KEYS = new Set([window.OPXAuth.STORAGE.session]);
const CATEGORY_BACKUPS = [
  { category: "drivers", key: "transport_crm_drivers", filename: "drivers-backup.json" },
  { category: "trucks", key: "transport_crm_trucks", filename: "trucks-backup.json" },
  { category: "roster", key: "transport_crm_roster", filename: "roster-backup.json" },
  { category: "truck_income", key: "transport_crm_truck_income", filename: "truck-income-backup.json" },
  { category: "spending", key: "transport_crm_spending", filename: "spending-backup.json" },
  { category: "payslips", key: "transport_crm_payslips", filename: "payslips-backup.json" },
  { category: "logs", key: "transport_crm_logs", filename: "logs-backup.json" },
  { category: "roles", key: window.OPXAuth.STORAGE.roles, filename: "roles-backup.json" },
  { category: "users", key: window.OPXAuth.STORAGE.users, filename: "users-backup.json" }
];
const TABLE_BY_KEY = {
  transport_crm_drivers: "drivers",
  transport_crm_trucks: "trucks",
  transport_crm_truck_income: "truck_income",
  transport_crm_spending: "truck_expense",
  transport_crm_payslips: "payslips",
  transport_crm_roster: "roster",
  transport_crm_logs: "app_logs"
};

function isBackupKey(key) {
  return BACKUP_PREFIXES.some((prefix) => key.startsWith(prefix)) && !BACKUP_EXCLUDE_KEYS.has(key);
}

function setBackupStatus(message, isError = false) {
  const status = document.getElementById("backupStatus");
  if (!status) return;
  status.textContent = message;
  status.className = isError ? "error-text" : "muted";
}

function setSupabaseConfigStatus(message, isError = false) {
  const status = document.getElementById("supabaseConfigStatus");
  if (status) {
    status.textContent = message;
    status.className = isError ? "error-text" : "muted";
  }
  console[isError ? "error" : "log"](`[Supabase] ${message}`);
}

function readSupabaseConfigInputs() {
  const url = String(document.getElementById("supabaseUrlInput")?.value || "").trim();
  const anonKey = String(document.getElementById("supabaseAnonKeyInput")?.value || "").trim();
  return { url, anonKey };
}

async function testSupabaseConnection(url, anonKey) {
  if (!url || !anonKey) {
    setSupabaseConfigStatus("Enter both Supabase URL and anon key.", true);
    alert("Enter both Supabase URL and anon key.");
    return;
  }

  if (!window.supabase?.createClient) {
    setSupabaseConfigStatus("Supabase SDK not loaded.", true);
    alert("Supabase SDK not loaded. Please refresh page.");
    return;
  }

  try {
    const client = window.supabase.createClient(url, anonKey);
    const { count, error } = await client.from("trucks").select("*", { count: "exact", head: true });
    if (error) {
      setSupabaseConfigStatus(`Connection failed: ${error.message}`, true);
      alert(`Connection failed: ${error.message}`);
      return;
    }
    setSupabaseConfigStatus(`Connected. Trucks rows available: ${count ?? 0}.`);
    alert(`Connected. Trucks rows available: ${count ?? 0}.`);
  } catch (error) {
    setSupabaseConfigStatus(`Connection failed: ${error.message || "Unknown error"}`, true);
    alert(`Connection failed: ${error.message || "Unknown error"}`);
  }
}

function initSupabaseConfigPanel() {
  const urlInput = document.getElementById("supabaseUrlInput");
  const anonInput = document.getElementById("supabaseAnonKeyInput");
  const saveBtn = document.getElementById("saveSupabaseConfigBtn");
  const testBtn = document.getElementById("testSupabaseBtn");
  const clearBtn = document.getElementById("clearSupabaseConfigBtn");

  if (!urlInput || !anonInput || !saveBtn || !testBtn || !clearBtn) return;

  const savedUrl = localStorage.getItem("OPX_SUPABASE_URL") || window.OPX_SUPABASE?.url || "";
  const savedAnon = localStorage.getItem("OPX_SUPABASE_ANON_KEY") || window.OPX_SUPABASE?.anonKey || "";

  urlInput.value = savedUrl;
  anonInput.value = savedAnon;

  if (savedUrl && savedAnon) {
    setSupabaseConfigStatus("Supabase credentials are saved in this browser.");
  } else {
    setSupabaseConfigStatus("Supabase credentials are not set yet.", true);
  }

  saveBtn.addEventListener("click", () => {
    const { url, anonKey } = readSupabaseConfigInputs();
    if (!url || !anonKey) {
      setSupabaseConfigStatus("Please enter both URL and anon key before saving.", true);
      alert("Please enter both URL and anon key before saving.");
      return;
    }
    localStorage.setItem("OPX_SUPABASE_URL", url);
    localStorage.setItem("OPX_SUPABASE_ANON_KEY", anonKey);
    setSupabaseConfigStatus("Saved. Reloading page to apply connection...");
    alert("Supabase connection saved. Page will reload.");
    setTimeout(() => window.location.reload(), 500);
  });

  testBtn.addEventListener("click", () => {
    const { url, anonKey } = readSupabaseConfigInputs();
    void testSupabaseConnection(url, anonKey);
  });

  clearBtn.addEventListener("click", () => {
    localStorage.removeItem("OPX_SUPABASE_URL");
    localStorage.removeItem("OPX_SUPABASE_ANON_KEY");
    urlInput.value = "";
    anonInput.value = "";
    setSupabaseConfigStatus("Supabase credentials cleared for this browser.");
    alert("Supabase credentials cleared.");
  });

  if (savedUrl && savedAnon) {
    void testSupabaseConnection(savedUrl, savedAnon);
  }
}

function collectBackupData() {
  const data = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !isBackupKey(key)) continue;
    data[key] = localStorage.getItem(key);
  }
  return data;
}

function downloadBackup() {
  if (!(auth.can("backupRestore") || auth.can("adminData"))) return;

  const payload = {
    type: "onpoint_express_backup",
    version: 1,
    createdAt: new Date().toISOString(),
    data: collectBackupData()
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = payload.createdAt.replaceAll(":", "-").replaceAll(".", "-");
  a.href = url;
  a.download = `onpoint-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);

  setBackupStatus("Backup downloaded successfully.");
}

function triggerJsonDownload(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCategoryBackups() {
  if (!(auth.can("backupRestore") || auth.can("adminData"))) return;

  const createdAt = new Date().toISOString();
  const available = CATEGORY_BACKUPS.filter((item) => localStorage.getItem(item.key) !== null);

  if (!available.length) {
    setBackupStatus("No category data found to export.", true);
    return;
  }

  available.forEach((item, index) => {
    const payload = {
      type: "onpoint_express_category_backup",
      version: 1,
      createdAt,
      category: item.category,
      key: item.key,
      value: localStorage.getItem(item.key)
    };
    setTimeout(() => triggerJsonDownload(item.filename, payload), index * 120);
  });

  setBackupStatus(`Category backup files downloaded (${available.length}).`);
}

function restoreBackupFromText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    setBackupStatus("Invalid backup file: JSON parse failed.", true);
    return;
  }

  let keys = [];
  let valuesByKey = {};

  if (parsed?.type === "onpoint_express_backup" && typeof parsed.data === "object") {
    keys = Object.keys(parsed.data).filter((key) => isBackupKey(key));
    valuesByKey = parsed.data;
  } else if (parsed?.type === "onpoint_express_category_backup" && typeof parsed.key === "string") {
    if (!isBackupKey(parsed.key)) {
      setBackupStatus("Category backup key is not valid for restore.", true);
      return;
    }
    keys = [parsed.key];
    valuesByKey = { [parsed.key]: parsed.value };
  } else {
    setBackupStatus("Invalid backup file format.", true);
    return;
  }

  if (!keys.length) {
    setBackupStatus("Backup file has no valid CRM/auth data.", true);
    return;
  }

  const ok = confirm(`Restore ${keys.length} key(s)? This will overwrite current local data on this browser.`);
  if (!ok) return;

  keys.forEach((key) => {
    const value = valuesByKey[key];
    localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  });

  window.OPXAuth.init();
  resetRoleForm();
  resetUserForm();
  refresh();
  void syncRestoredKeysToSupabase(keys).then((synced) => {
    const where = synced ? "browser + Supabase" : "browser storage";
    setBackupStatus(`Restore complete. ${keys.length} key(s) imported to ${where}.`);
  });
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}${Math.random().toString(16).slice(2, 10)}`.slice(0, 32);
}

function ensureUuidRows(rows) {
  return rows.map((row) => {
    if (isUuid(row.id)) return row;
    return { ...row, id: newId() };
  });
}

function parseRowsFromStorageKey(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toDbRowsForKey(key, rows) {
  if (key === "transport_crm_drivers") {
    return rows.map((x) => ({
      id: x.id, name: x.name || "", phone: x.phone || "", license_number: x.licenseNumber || "",
      license_expiry: x.licenseExpiry || null, hire_date: x.hireDate || null, status: x.status || "",
      address: x.address || "", emergency_contact: x.emergencyContact || ""
    }));
  }
  if (key === "transport_crm_trucks") {
    return rows.map((x) => ({
      id: x.id, truck_number: x.truckNumber || "", registration: x.registration || "", model: x.model || "",
      capacity: Number(x.capacity || 0), service_due_date: x.serviceDueDate || null, rego_expiry_date: x.regoExpiryDate || null,
      status: x.status || "", notes: x.notes || ""
    }));
  }
  if (key === "transport_crm_truck_income") {
    return rows.map((x) => ({
      id: x.id, income_date: x.incomeDate || null, truck_number: x.truckNumber || "", job_ref: x.jobRef || "",
      client: x.client || "", amount: Number(x.amount || 0), status: x.status || "", notes: x.notes || ""
    }));
  }
  if (key === "transport_crm_spending") {
    return rows.map((x) => ({
      id: x.id, expense_date: x.date || null, truck_number: x.truckNumber || "", category: x.category || "",
      amount: Number(x.amount || 0), vendor: x.vendor || "", notes: x.notes || ""
    }));
  }
  if (key === "transport_crm_payslips") {
    return rows.map((x) => ({
      id: x.id, driver: x.driver || "", truck_number: x.truckNumber || "", pay_period: x.payPeriod || "",
      days_worked: Number(x.daysWorked ?? x.hoursWorked ?? 0), daily_rate: Number(x.dailyRate ?? x.hourlyRate ?? 0),
      night_run_drops: Number(x.nightRunDrops ?? 0), drop_rate: Number(x.dropRate ?? 90),
      night_run_pay: Number(x.nightRunPay ?? 0), driver_bonus: Number(x.driverBonus ?? 0),
      deductions: Number(x.deductions ?? 0), payment_date: x.paymentDate || null, auto_pay: x.autoPay || "No",
      auto_pay_ref: x.autoPayRef || ""
    }));
  }
  if (key === "transport_crm_roster") {
    return rows.map((x) => ({
      id: x.id, driver_name: x.driverName || "", truck_number: x.truckNumber || "",
      shift_date: x.shiftDate || null, shift_time: x.shiftTime || "", route: x.route || "", status: x.status || ""
    }));
  }
  if (key === "transport_crm_logs") {
    return rows.map((x) => ({
      id: x.id, log_date: x.date || x.logDate || null, level: x.level || "", message: x.message || "", details: x.details || x.notes || ""
    }));
  }
  return [];
}

async function syncRestoredKeysToSupabase(keys) {
  if (!useSupabase) return false;
  let syncedAny = false;

  for (const key of keys) {
    const table = TABLE_BY_KEY[key];
    if (!table) continue;

    const rows = ensureUuidRows(parseRowsFromStorageKey(key));
    localStorage.setItem(key, JSON.stringify(rows));
    const dbRows = toDbRowsForKey(key, rows);

    const { error } = await supabase.from(table).upsert(dbRows, { onConflict: "id" });
    if (error) {
      console.error(`Supabase restore sync failed for ${table}:`, error.message);
      continue;
    }

    syncedAny = true;
    const ids = dbRows.map((r) => r.id);
    if (!ids.length) {
      await supabase.from(table).delete().not("id", "is", null);
      continue;
    }
    const inList = `(${ids.map((id) => `"${String(id).replaceAll('"', "")}"`).join(",")})`;
    await supabase.from(table).delete().not("id", "in", inList);
  }

  return syncedAny;
}

async function syncAllLocalDataToSupabase() {
  if (!(auth.can("backupRestore") || auth.can("adminData"))) return;
  if (!useSupabase) {
    setBackupStatus("Supabase is not configured on this page.", true);
    return;
  }

  const keys = Object.keys(TABLE_BY_KEY).filter((key) => localStorage.getItem(key) !== null);
  if (!keys.length) {
    setBackupStatus("No local CRM data found to sync.", true);
    return;
  }

  setBackupStatus("Syncing local data to Supabase...");
  const synced = await syncRestoredKeysToSupabase(keys);
  if (synced) {
    setBackupStatus(`Sync complete. ${keys.length} data group(s) uploaded to Supabase.`);
  } else {
    setBackupStatus("Sync attempted, but no data groups were uploaded.", true);
  }
}

function hookBackupActions() {
  const downloadBtn = document.getElementById("downloadBackupBtn");
  const downloadCategoryBtn = document.getElementById("downloadCategoryBackupsBtn");
  const syncSupabaseBtn = document.getElementById("syncSupabaseBtn");
  const restoreBtn = document.getElementById("restoreBackupBtn");
  const fileInputVisible = document.getElementById("backupFileInputVisible");
  const importBackupBtn = document.getElementById("importBackupBtn");

  const canBackup = auth.can("backupRestore") || auth.can("adminData");
  if (!canBackup) {
    if (downloadBtn) downloadBtn.style.display = "none";
    if (downloadCategoryBtn) downloadCategoryBtn.style.display = "none";
    if (syncSupabaseBtn) syncSupabaseBtn.style.display = "none";
    if (restoreBtn) restoreBtn.style.display = "none";
    if (fileInputVisible) fileInputVisible.style.display = "none";
    if (importBackupBtn) importBackupBtn.style.display = "none";
    setBackupStatus("Backup/restore is available to users with backup permission.");
    return;
  }

  if (downloadBtn) {
    downloadBtn.addEventListener("click", downloadBackup);
  }

  if (downloadCategoryBtn) {
    downloadCategoryBtn.addEventListener("click", downloadCategoryBackups);
  }

  if (syncSupabaseBtn) {
    syncSupabaseBtn.addEventListener("click", () => {
      void syncAllLocalDataToSupabase();
    });
  }

  if (restoreBtn) {
    restoreBtn.addEventListener("click", () => {
      setBackupStatus("Opening backup file picker...");
      try {
        const tempInput = document.createElement("input");
        tempInput.type = "file";
        tempInput.accept = ".json,application/json";
        tempInput.style.position = "fixed";
        tempInput.style.left = "-9999px";
        tempInput.style.top = "0";
        document.body.appendChild(tempInput);

        tempInput.addEventListener("change", async () => {
          const file = tempInput.files?.[0];
          if (!file) {
            setBackupStatus("No backup file selected.", true);
            tempInput.remove();
            return;
          }
          try {
            const text = await file.text();
            restoreBackupFromText(text);
          } catch {
            setBackupStatus("Failed to read backup file.", true);
          } finally {
            tempInput.remove();
          }
        }, { once: true });

        if (typeof tempInput.showPicker === "function") {
          tempInput.showPicker();
        } else {
          tempInput.click();
        }
      } catch (error) {
        console.error("Backup picker open failed:", error);
        setBackupStatus("Could not open file picker. Please refresh and try again.", true);
      }
    });
  }

  if (importBackupBtn && fileInputVisible) {
    importBackupBtn.addEventListener("click", async () => {
      const file = fileInputVisible.files?.[0];
      if (!file) {
        setBackupStatus("Please choose a backup file first.", true);
        return;
      }
      try {
        const text = await file.text();
        restoreBackupFromText(text);
      } catch {
        setBackupStatus("Failed to read selected backup file.", true);
      }
    });
  }
}

document.getElementById("roleForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const roleId = document.getElementById("roleId").value;
  const roleName = document.getElementById("roleName").value.trim();
  if (!roleName) return;

  const payload = {
    name: roleName,
    permissions: checkedPermissionsFromForm()
  };

  if (roleId) {
    const updated = window.OPXAuth.updateRole(roleId, payload);
    if (!updated) {
      alert("System roles cannot be edited.");
      return;
    }
  } else {
    window.OPXAuth.createRole(payload);
  }

  resetRoleForm();
  refresh();
});

document.getElementById("userForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const userId = document.getElementById("userId").value;
  const username = document.getElementById("userName").value.trim();
  const password = document.getElementById("userPassword").value;
  const roleId = document.getElementById("userRole").value;
  const active = document.getElementById("userActive").value === "true";

  if (!username || !roleId) return;

  if (userId) {
    const result = window.OPXAuth.updateUser(userId, { username, password, roleId, active });
    if (!result.ok) {
      alert(result.message);
      return;
    }
  } else {
    if (!password) {
      alert("Password is required for new user.");
      return;
    }

    const result = window.OPXAuth.createUser({ username, password, roleId, active });
    if (!result.ok) {
      alert(result.message);
      return;
    }
  }

  resetUserForm();
  refresh();
});

document.getElementById("cancelRoleEdit").addEventListener("click", resetRoleForm);
document.getElementById("cancelUserEdit").addEventListener("click", resetUserForm);

document.body.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;

  if (action === "edit-role") {
    const role = window.OPXAuth.getRoles().find((r) => r.id === id);
    if (role) fillRoleForm(role);
    return;
  }

  if (action === "delete-role") {
    const ok = confirm("Delete this role?");
    if (!ok) return;

    const result = window.OPXAuth.deleteRole(id);
    if (!result.ok) {
      alert(result.message);
      return;
    }

    refresh();
    return;
  }

  if (action === "edit-user") {
    const user = window.OPXAuth.getUsers().find((u) => u.id === id);
    if (user) fillUserForm(user);
    return;
  }

  if (action === "delete-user") {
    const ok = confirm("Delete this user?");
    if (!ok) return;

    const result = window.OPXAuth.deleteUser(id);
    if (!result.ok) {
      alert(result.message);
      return;
    }

    refresh();
  }
});

renderPermissionChecklist();
resetRoleForm();
resetUserForm();
refresh();
hookBackupActions();
initSupabaseConfigPanel();

if (document.getElementById("restoreBackupBtn")) {
  setBackupStatus("Backup actions ready.");
}
