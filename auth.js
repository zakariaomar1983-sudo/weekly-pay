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
    { key: "backupRestore", label: "Backup and Restore Data" },
    { key: "adminData", label: "Clear all data" }
  ];

  const SYSTEM_ROLE_IDS = {
    admin: "role_admin",
    manager: "role_manager",
    viewer: "role_viewer"
  };

  const STARTER_CUSTOM_ROLE_IDS = {
    dispatcher: "role_dispatcher",
    finance: "role_finance",
    fleet: "role_fleet_manager",
    payroll: "role_payroll",
    compliance: "role_compliance",
    dataEntry: "role_data_entry"
  };

  const LEGACY_DISABLED_DEFAULTS = [
    { username: "opsmanager", password: "Ops@123" },
    { username: "gm", password: "Gm@123" }
  ];

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

  function buildSystemRoleDefinitions() {
    const adminPerms = allPermissions(true);

    const managerPerms = allPermissions(false);
    [
      "accessCRM",
      "accessLogs",
      "accessControlPanel",
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

    return [
      { id: SYSTEM_ROLE_IDS.admin, name: "Admin", system: true, permissions: adminPerms },
      { id: SYSTEM_ROLE_IDS.manager, name: "Ops Manager", system: true, permissions: managerPerms },
      { id: SYSTEM_ROLE_IDS.viewer, name: "GM", system: true, permissions: viewerPerms }
    ];
  }

  function buildStarterCustomRoleDefinitions() {
    const dispatcherPerms = allPermissions(false);
    [
      "accessCRM",
      "accessLogs",
      "viewDrivers",
      "editDrivers",
      "viewTrucks",
      "viewRoster",
      "editRoster"
    ].forEach((key) => {
      dispatcherPerms[key] = true;
    });

    const financePerms = allPermissions(false);
    [
      "accessCRM",
      "viewTruckIncome",
      "editTruckIncome",
      "viewSpending",
      "editSpending",
      "viewPayslips",
      "editPayslips",
      "viewStats"
    ].forEach((key) => {
      financePerms[key] = true;
    });

    const fleetPerms = allPermissions(false);
    [
      "accessCRM",
      "accessLogs",
      "viewDrivers",
      "viewTrucks",
      "editTrucks",
      "viewRoster",
      "editRoster",
      "viewStats"
    ].forEach((key) => {
      fleetPerms[key] = true;
    });

    const payrollPerms = allPermissions(false);
    [
      "accessCRM",
      "viewPayslips",
      "editPayslips",
      "viewTruckIncome",
      "viewSpending",
      "viewStats"
    ].forEach((key) => {
      payrollPerms[key] = true;
    });

    const compliancePerms = allPermissions(false);
    [
      "accessCRM",
      "accessLogs",
      "viewDrivers",
      "viewTrucks",
      "editTrucks",
      "viewContracts",
      "viewStats"
    ].forEach((key) => {
      compliancePerms[key] = true;
    });

    const dataEntryPerms = allPermissions(false);
    [
      "accessCRM",
      "viewDrivers",
      "editDrivers",
      "viewTrucks",
      "editTrucks",
      "viewRoster",
      "editRoster",
      "viewTruckIncome",
      "editTruckIncome",
      "viewSpending",
      "editSpending"
    ].forEach((key) => {
      dataEntryPerms[key] = true;
    });

    return [
      { id: STARTER_CUSTOM_ROLE_IDS.dispatcher, name: "Dispatcher", system: false, permissions: dispatcherPerms },
      { id: STARTER_CUSTOM_ROLE_IDS.finance, name: "Finance Officer", system: false, permissions: financePerms },
      { id: STARTER_CUSTOM_ROLE_IDS.fleet, name: "Fleet Manager", system: false, permissions: fleetPerms },
      { id: STARTER_CUSTOM_ROLE_IDS.payroll, name: "Payroll Officer", system: false, permissions: payrollPerms },
      { id: STARTER_CUSTOM_ROLE_IDS.compliance, name: "Compliance Officer", system: false, permissions: compliancePerms },
      { id: STARTER_CUSTOM_ROLE_IDS.dataEntry, name: "Data Entry", system: false, permissions: dataEntryPerms }
    ];
  }

  function normalizeRoles(inputRoles) {
    const systemRoles = buildSystemRoleDefinitions();
    const systemIds = new Set(systemRoles.map((r) => r.id));
    const starter = buildStarterCustomRoleDefinitions();

    const safeInput = Array.isArray(inputRoles) ? inputRoles : [];
    const custom = [];
    const seen = new Set();

    safeInput.forEach((role) => {
      if (!role || typeof role !== "object") return;
      if (!role.id || typeof role.id !== "string") return;
      if (systemIds.has(role.id)) return;
      if (seen.has(role.id)) return;
      seen.add(role.id);

      custom.push({
        id: role.id,
        name: String(role.name || "Custom Role"),
        system: false,
        permissions: { ...allPermissions(false), ...(role.permissions || {}) }
      });
    });

    const missingStarter = starter.filter((r) => !seen.has(r.id));
    return [...systemRoles, ...custom, ...missingStarter];
  }

  function isLegacyDisabledUser(user) {
    return LEGACY_DISABLED_DEFAULTS.some((x) => x.username === user.username && x.password === user.password);
  }

  function normalizeUsers(inputUsers, roles) {
    const safeInput = Array.isArray(inputUsers) ? inputUsers : [];
    const roleIds = new Set(roles.map((r) => r.id));
    const seenNames = new Set();
    const users = [];

    safeInput.forEach((raw) => {
      if (!raw || typeof raw !== "object") return;
      const username = String(raw.username || "").trim();
      const password = String(raw.password || "");
      if (!username || !password) return;
      const lowered = username.toLowerCase();
      if (seenNames.has(lowered)) return;

      const normalized = {
        id: typeof raw.id === "string" && raw.id ? raw.id : uid("user"),
        username,
        password,
        roleId: roleIds.has(raw.roleId) ? raw.roleId : SYSTEM_ROLE_IDS.admin,
        active: raw.active !== false
      };

      if (normalized.username === "admin" && normalized.password === "admin123") return;
      if (isLegacyDisabledUser(normalized)) return;

      seenNames.add(lowered);
      users.push(normalized);
    });

    return users;
  }

  function init() {
    const currentRoles = read(STORAGE.roles, []);
    const nextRoles = normalizeRoles(currentRoles);
    if (JSON.stringify(nextRoles) !== JSON.stringify(currentRoles)) {
      write(STORAGE.roles, nextRoles);
    }

    const currentUsers = read(STORAGE.users, []);
    const nextUsers = normalizeUsers(currentUsers, nextRoles);
    if (JSON.stringify(nextUsers) !== JSON.stringify(currentUsers)) {
      write(STORAGE.users, nextUsers);
    }
  }

  function healCoreAccess() {
    init();
    return { roles: getRoles(), users: getUsers() };
  }

  function recoverRolesFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      if (params.get("recoverRoles") !== "1") return;
      init();
    } catch {
      // ignore
    }
  }

  function getRoles() {
    return read(STORAGE.roles, []);
  }

  function setRoles(roles) {
    write(STORAGE.roles, normalizeRoles(roles));
  }

  function getUsers() {
    return read(STORAGE.users, []);
  }

  function setUsers(users) {
    write(STORAGE.users, normalizeUsers(users, getRoles()));
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

  function hasUsers() {
    return getUsers().length > 0;
  }

  function login(username, password) {
    init();
    const name = String(username || "").trim();
    const pass = String(password || "");
    const users = getUsers();
    const user = users.find((u) => u.username === name && u.password === pass && u.active);
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
    const name = String(input?.name || "").trim();
    if (!name) return null;

    const roles = getRoles();
    const payload = {
      id: uid("role"),
      name,
      system: false,
      permissions: { ...allPermissions(false), ...(input?.permissions || {}) }
    };
    roles.push(payload);
    setRoles(roles);
    return payload;
  }

  function updateRole(roleId, input) {
    const roles = getRoles();
    const role = roles.find((r) => r.id === roleId);
    if (!role || role.system) return null;

    role.name = String(input?.name || "").trim() || role.name;
    role.permissions = { ...allPermissions(false), ...(input?.permissions || {}) };
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
    const username = String(input?.username || "").trim();
    const password = String(input?.password || "");
    if (!username || !password) return { ok: false, message: "Username and password are required." };

    const usernameExists = users.some((u) => u.username.toLowerCase() === username.toLowerCase());
    if (usernameExists) return { ok: false, message: "Username already exists." };

    const payload = {
      id: uid("user"),
      username,
      password,
      roleId: String(input?.roleId || SYSTEM_ROLE_IDS.admin),
      active: Boolean(input?.active)
    };

    users.push(payload);
    setUsers(users);
    return { ok: true, user: payload };
  }

  function createFirstAdmin(input) {
    init();
    if (getUsers().length > 0) {
      return { ok: false, message: "Users already exist. Use Control Panel to create additional users." };
    }

    const username = String(input?.username || "").trim();
    const password = String(input?.password || "");
    if (!username || !password) {
      return { ok: false, message: "Username and password are required." };
    }

    const payload = {
      id: uid("user"),
      username,
      password,
      roleId: SYSTEM_ROLE_IDS.admin,
      active: true
    };

    setUsers([payload]);
    return { ok: true, user: payload };
  }

  function createInitialUsers(input) {
    init();
    if (getUsers().length > 0) {
      return { ok: false, message: "Users already exist. Use Control Panel to create additional users." };
    }

    const adminUsername = String(input?.adminUsername || "").trim();
    const adminPassword = String(input?.adminPassword || "");
    if (!adminUsername || !adminPassword) {
      return { ok: false, message: "Admin username and password are required." };
    }

    const payload = [
      {
        id: uid("user"),
        username: adminUsername,
        password: adminPassword,
        roleId: SYSTEM_ROLE_IDS.admin,
        active: true
      }
    ];

    const optionalUsers = [
      {
        username: String(input?.opsManagerUsername || "").trim(),
        password: String(input?.opsManagerPassword || ""),
        roleId: SYSTEM_ROLE_IDS.manager
      },
      {
        username: String(input?.gmUsername || "").trim(),
        password: String(input?.gmPassword || ""),
        roleId: SYSTEM_ROLE_IDS.viewer
      }
    ];

    for (const entry of optionalUsers) {
      if (!entry.username && !entry.password) continue;
      if (!entry.username || !entry.password) {
        return { ok: false, message: "Ops Manager/GM requires both username and password." };
      }
      payload.push({
        id: uid("user"),
        username: entry.username,
        password: entry.password,
        roleId: entry.roleId,
        active: true
      });
    }

    const names = payload.map((u) => u.username.toLowerCase());
    if (new Set(names).size !== names.length) {
      return { ok: false, message: "Usernames must be unique." };
    }

    setUsers(payload);
    return { ok: true, users: payload };
  }

  function updateUser(userId, input) {
    const users = getUsers();
    const user = users.find((u) => u.id === userId);
    if (!user) return { ok: false, message: "User not found." };

    const username = String(input?.username || "").trim();
    if (!username) return { ok: false, message: "Username is required." };

    const duplicate = users.some((u) => u.id !== userId && u.username.toLowerCase() === username.toLowerCase());
    if (duplicate) return { ok: false, message: "Username already exists." };

    user.username = username;
    if (input?.password) user.password = String(input.password);
    user.roleId = String(input?.roleId || user.roleId);
    user.active = Boolean(input?.active);

    setUsers(users);
    return { ok: true, user };
  }

  function deleteUser(userId) {
    const users = getUsers();
    const user = users.find((u) => u.id === userId);
    if (!user) return { ok: false, message: "User not found." };

    const remainingActiveAdmins = users
      .filter((u) => u.id !== userId && u.active)
      .some((u) => u.roleId === SYSTEM_ROLE_IDS.admin);

    if (user.roleId === SYSTEM_ROLE_IDS.admin && !remainingActiveAdmins) {
      return { ok: false, message: "At least one active admin user is required." };
    }

    setUsers(users.filter((u) => u.id !== userId));

    const session = getSession();
    if (session?.userId === userId) clearSession();
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
    hasUsers,
    healCoreAccess,
    recoverRolesFromUrl,
    getRoles,
    getUsers,
    createFirstAdmin,
    createInitialUsers,
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
  recoverRolesFromUrl();
})();
