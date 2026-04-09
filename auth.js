(function authBootstrap() {
  const STORAGE = {
    roles: "opx_auth_roles",
    users: "opx_auth_users",
    session: "opx_auth_session"
  };

  const PERMISSIONS = [
    { key: "accessCRM", label: "Access CRM page" },
    { key: "accessLogs", label: "Access Log page" },
    { key: "accessControlPanel", label: "Access Control Panel" },
    { key: "viewDrivers", label: "View Driver Details" },
    { key: "editDrivers", label: "Edit Driver Details" },
    { key: "viewTrucks", label: "View Truck Details" },
    { key: "editTrucks", label: "Edit Truck Details" },
    { key: "viewTruckIncome", label: "View Truck Income" },
    { key: "editTruckIncome", label: "Edit Truck Income" },
    { key: "viewContracts", label: "View Contracts" },
    { key: "editContracts", label: "Edit Contracts" },
    { key: "viewSpending", label: "View Spending" },
    { key: "editSpending", label: "Edit Spending" },
    { key: "viewRoster", label: "View Driver Roster" },
    { key: "editRoster", label: "Edit Driver Roster" },
    { key: "viewPayslips", label: "View Payslips" },
    { key: "editPayslips", label: "Edit Payslips" },
    { key: "viewStats", label: "View Dashboard Stats" },
    { key: "editLogs", label: "Edit Logs" },
    { key: "adminData", label: "Clear all data" }
  ];

  const SYSTEM_ROLE_IDS = {
    admin: "role_admin",
    manager: "role_manager",
    viewer: "role_viewer"
  };

  function read(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function uid(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function allPermissions(value) {
    const out = {};
    PERMISSIONS.forEach((perm) => {
      out[perm.key] = value;
    });
    return out;
  }

  function buildDefaults() {
    const adminPerms = allPermissions(true);

    const managerPerms = allPermissions(false);
    [
      "accessCRM",
      "accessLogs",
      "viewDrivers",
      "editDrivers",
      "viewTrucks",
      "editTrucks",
      "viewTruckIncome",
      "editTruckIncome",
      "viewContracts",
      "editContracts",
      "viewSpending",
      "editSpending",
      "viewRoster",
      "editRoster",
      "viewPayslips",
      "editPayslips",
      "viewStats",
      "editLogs"
    ].forEach((key) => {
      managerPerms[key] = true;
    });

    const viewerPerms = allPermissions(false);
    [
      "accessCRM",
      "accessLogs",
      "viewDrivers",
      "viewTrucks",
      "viewTruckIncome",
      "viewContracts",
      "viewSpending",
      "viewRoster",
      "viewPayslips",
      "viewStats"
    ].forEach((key) => {
      viewerPerms[key] = true;
    });

    const roles = [
      { id: SYSTEM_ROLE_IDS.admin, name: "Admin", system: true, permissions: adminPerms },
      { id: SYSTEM_ROLE_IDS.manager, name: "Manager", system: true, permissions: managerPerms },
      { id: SYSTEM_ROLE_IDS.viewer, name: "Viewer", system: true, permissions: viewerPerms }
    ];

    const users = [
      { id: "user_admin", username: "admin", password: "admin123", roleId: SYSTEM_ROLE_IDS.admin, active: true }
    ];

    write(STORAGE.roles, roles);
    write(STORAGE.users, users);
  }

  function init() {
    const roles = read(STORAGE.roles, null);
    const users = read(STORAGE.users, null);
    if (!Array.isArray(roles) || !roles.length || !Array.isArray(users) || !users.length) {
      buildDefaults();
      return;
    }

    const hasAdminRole = roles.some((r) => r.id === SYSTEM_ROLE_IDS.admin);
    const hasAdminUser = users.some((u) => u.roleId === SYSTEM_ROLE_IDS.admin && u.active);
    if (!hasAdminRole || !hasAdminUser) {
      buildDefaults();
    }
  }

  function getRoles() {
    return read(STORAGE.roles, []);
  }

  function setRoles(roles) {
    write(STORAGE.roles, roles);
  }

  function getUsers() {
    return read(STORAGE.users, []);
  }

  function setUsers(users) {
    write(STORAGE.users, users);
  }

  function getSession() {
    return read(STORAGE.session, null);
  }

  function setSession(session) {
    write(STORAGE.session, session);
  }

  function clearSession() {
    localStorage.removeItem(STORAGE.session);
  }

  function getUserById(userId) {
    return getUsers().find((u) => u.id === userId) || null;
  }

  function getRoleById(roleId) {
    return getRoles().find((r) => r.id === roleId) || null;
  }

  function getSessionUser() {
    const session = getSession();
    if (!session || !session.userId) return null;
    const user = getUserById(session.userId);
    if (!user || !user.active) return null;
    return user;
  }

  function getPermissionsForUser(user) {
    if (!user) return {};
    const role = getRoleById(user.roleId);
    return role?.permissions || {};
  }

  function canUser(user, permission) {
    const permissions = getPermissionsForUser(user);
    return Boolean(permissions[permission]);
  }

  function login(username, password) {
    init();
    const users = getUsers();
    const user = users.find((u) => u.username === username && u.password === password && u.active);
    if (!user) return { ok: false, message: "Invalid username or password." };
    setSession({ userId: user.id, loginAt: new Date().toISOString() });
    return { ok: true, user };
  }

  function logout() {
    clearSession();
  }

  function requireAuth(redirectPath) {
    init();
    const user = getSessionUser();
    if (!user) {
      if (redirectPath) window.location.href = redirectPath;
      return null;
    }

    return {
      user,
      can: (permission) => canUser(user, permission),
      permissions: getPermissionsForUser(user)
    };
  }

  function createRole(input) {
    const roles = getRoles();
    const payload = {
      id: uid("role"),
      name: input.name.trim(),
      system: false,
      permissions: { ...allPermissions(false), ...input.permissions }
    };
    roles.push(payload);
    setRoles(roles);
    return payload;
  }

  function updateRole(roleId, input) {
    const roles = getRoles();
    const role = roles.find((r) => r.id === roleId);
    if (!role || role.system) return null;

    role.name = input.name.trim();
    role.permissions = { ...allPermissions(false), ...input.permissions };
    setRoles(roles);
    return role;
  }

  function deleteRole(roleId) {
    const roles = getRoles();
    const role = roles.find((r) => r.id === roleId);
    if (!role || role.system) return { ok: false, message: "System role cannot be deleted." };

    const users = getUsers();
    const inUse = users.some((u) => u.roleId === roleId);
    if (inUse) return { ok: false, message: "Role is assigned to users. Reassign users first." };

    setRoles(roles.filter((r) => r.id !== roleId));
    return { ok: true };
  }

  function createUser(input) {
    const users = getUsers();
    const usernameExists = users.some((u) => u.username.toLowerCase() === input.username.trim().toLowerCase());
    if (usernameExists) return { ok: false, message: "Username already exists." };

    const payload = {
      id: uid("user"),
      username: input.username.trim(),
      password: input.password,
      roleId: input.roleId,
      active: Boolean(input.active)
    };

    users.push(payload);
    setUsers(users);
    return { ok: true, user: payload };
  }

  function updateUser(userId, input) {
    const users = getUsers();
    const user = users.find((u) => u.id === userId);
    if (!user) return { ok: false, message: "User not found." };

    const duplicate = users.some((u) => u.id !== userId && u.username.toLowerCase() === input.username.trim().toLowerCase());
    if (duplicate) return { ok: false, message: "Username already exists." };

    user.username = input.username.trim();
    if (input.password) {
      user.password = input.password;
    }
    user.roleId = input.roleId;
    user.active = Boolean(input.active);

    setUsers(users);
    return { ok: true, user };
  }

  function deleteUser(userId) {
    const users = getUsers();
    const user = users.find((u) => u.id === userId);
    if (!user) return { ok: false, message: "User not found." };

    const remainingAdmin = users.filter((u) => u.id !== userId && u.active).some((u) => u.roleId === SYSTEM_ROLE_IDS.admin);
    if (user.roleId === SYSTEM_ROLE_IDS.admin && !remainingAdmin) {
      return { ok: false, message: "At least one active admin user is required." };
    }

    setUsers(users.filter((u) => u.id !== userId));

    const session = getSession();
    if (session?.userId === userId) {
      clearSession();
    }

    return { ok: true };
  }

  window.OPXAuth = {
    init,
    login,
    logout,
    requireAuth,
    getSessionUser,
    getPermissionsForUser,
    canUser,
    getRoles,
    getUsers,
    createRole,
    updateRole,
    deleteRole,
    createUser,
    updateUser,
    deleteUser,
    PERMISSIONS,
    STORAGE,
    SYSTEM_ROLE_IDS
  };

  init();
})();
