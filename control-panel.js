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
