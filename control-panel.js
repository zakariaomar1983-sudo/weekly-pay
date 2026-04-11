const auth = window.OPXAuth?.requireAuth("./login.html");
if (!auth) {
  throw new Error("Authentication required");
}

if (!auth.can("accessControlPanel")) {
  document.body.innerHTML = "<main class='app-shell'><section class='panel'><h2>Access Denied</h2><p>You do not have permission to access the Control Panel.</p></section></main>";
  throw new Error("No control panel access");
}

const PERMISSIONS = window.OPXAuth.PERMISSIONS;

document.getElementById("currentUserChip").textContent = `User: ${auth.user.username}`;

document.getElementById("logoutBtn").addEventListener("click", () => {
  window.OPXAuth.logout();
  window.location.href = "./login.html";
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

function isBackupKey(key) {
  return BACKUP_PREFIXES.some((prefix) => key.startsWith(prefix)) && !BACKUP_EXCLUDE_KEYS.has(key);
}

function setBackupStatus(message, isError = false) {
  const status = document.getElementById("backupStatus");
  if (!status) return;
  status.textContent = message;
  status.className = isError ? "error-text" : "muted";
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
  setBackupStatus(`Restore complete. ${keys.length} key(s) imported.`);
}

function hookBackupActions() {
  const downloadBtn = document.getElementById("downloadBackupBtn");
  const downloadCategoryBtn = document.getElementById("downloadCategoryBackupsBtn");
  const restoreBtn = document.getElementById("restoreBackupBtn");
  const fileInput = document.getElementById("backupFileInput");

  if (!downloadBtn || !downloadCategoryBtn || !restoreBtn || !fileInput) return;

  if (!(auth.can("backupRestore") || auth.can("adminData"))) {
    downloadBtn.style.display = "none";
    downloadCategoryBtn.style.display = "none";
    restoreBtn.style.display = "none";
    fileInput.style.display = "none";
    setBackupStatus("Backup/restore is available to users with backup permission.");
    return;
  }

  downloadBtn.addEventListener("click", downloadBackup);
  downloadCategoryBtn.addEventListener("click", downloadCategoryBackups);
  restoreBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      restoreBackupFromText(text);
    } catch {
      setBackupStatus("Failed to read backup file.", true);
    } finally {
      fileInput.value = "";
    }
  });
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
