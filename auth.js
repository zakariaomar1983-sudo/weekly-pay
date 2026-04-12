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

  const CORE_DEFAULT_USERS = {
    admin: { username: "admin", password: "Admin@123", roleId: SYSTEM_ROLE_IDS.admin },
    manager: { username: "opsmanager", password: "Ops@123", roleId: SYSTEM_ROLE_IDS.manager },
    viewer: { username: "gm", password: "Gm@123", roleId: SYSTEM_ROLE_IDS.viewer }
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
      "editLogs",
      "backupRestore"
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

  function migrateSystemRoles(existingRoles) {
    const systemRoles = buildSystemRoleDefinitions();
    const systemIds = new Set(systemRoles.map((r) => r.id));
    const customRoles = existingRoles.filter((r) => !systemIds.has(r.id));
    return [...systemRoles, ...customRoles];
  }

  function buildDefaults() {
    const roles = buildSystemRoleDefinitions();

    const users = [];

    write(STORAGE.roles, roles);
    write(STORAGE.users, users);
  }

  function removeLegacyDefaultAdmin(users) {
    return users.filter((u) => !(u.username === "admin" && u.password === "admin123"));
  }

  function uniqueUsername(base, users) {
    const existing = new Set(users.map((u) => String(u.username || "").toLowerCase()));
    if (!existing.has(base.toLowerCase())) return base;

    let i = 2;
    while (existing.has(`${base}${i}`.toLowerCase())) i += 1;
    return `${base}${i}`;
  }

  function ensureCoreUsers(users) {
    const next = [...users];

    const rolePresence = {
      [SYSTEM_ROLE_IDS.admin]: next.some((u) => u.roleId === SYSTEM_ROLE_IDS.admin && u.active),
      [SYSTEM_ROLE_IDS.manager]: next.some((u) => u.roleId === SYSTEM_ROLE_IDS.manager && u.active),
      [SYSTEM_ROLE_IDS.viewer]: next.some((u) => u.roleId === SYSTEM_ROLE_IDS.viewer && u.active)
    };

    const required = [CORE_DEFAULT_USERS.admin, CORE_DEFAULT_USERS.manager, CORE_DEFAULT_USERS.viewer];
    required.forEach((core) => {
      if (rolePresence[core.roleId]) return;
      const username = uniqueUsername(core.username, next);
      next.push({
        id: uid("user"),
        username,
        password: core.password,
        roleId: core.roleId,
        active: true
      });
      rolePresence[core.roleId] = true;
    });

    return next;
  }

  function healCoreAccess() {
    const currentRoles = read(STORAGE.roles, []);
    const currentUsers = read(STORAGE.users, []);

    const nextRoles = migrateSystemRoles(Array.isArray(currentRoles) ? currentRoles : []);
    const cleanedUsers = removeLegacyDefaultAdmin(Array.isArray(currentUsers) ? currentUsers : []);
    const nextUsers = ensureCoreUsers(cleanedUsers);

    if (JSON.stringify(nextRoles) !== JSON.stringify(currentRoles)) {
      write(STORAGE.roles, nextRoles);
    }
    if (JSON.stringify(nextUsers) !== JSON.stringify(currentUsers)) {
      write(STORAGE.users, nextUsers);
    }

    return { roles: nextRoles, users: nextUsers };
  }

  function init() {
    const roles = read(STORAGE.roles, null);
    const users = read(STORAGE.users, null);
    if (!Array.isArray(roles) || !roles.length || !Array.isArray(users)) {
      buildDefaults();
    }

    const nextRoles = read(STORAGE.roles, []);
    const nextUsers = read(STORAGE.users, []);
    const hasAdminRole = nextRoles.some((r) => r.id === SYSTEM_ROLE_IDS.admin);
    if (!hasAdminRole) {
      buildDefaults();
      return;
    }

    const migratedRoles = migrateSystemRoles(nextRoles);
    if (JSON.stringify(migratedRoles) !== JSON.stringify(nextRoles)) {
      write(STORAGE.roles, migratedRoles);
    }

    const cleanedUsers = removeLegacyDefaultAdmin(nextUsers);
    const ensuredUsers = ensureCoreUsers(cleanedUsers);
    if (JSON.stringify(ensuredUsers) !== JSON.stringify(nextUsers)) {
      write(STORAGE.users, ensuredUsers);
    }

    // Final safety net: always heal core system roles/users if anything is missing.
    healCoreAccess();
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

  function hasUsers() {
    return getUsers().length > 0;
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

  function createFirstAdmin(input) {
    init();
    const users = getUsers();
    if (users.length > 0) {
      return { ok: false, message: "Users already exist. Use Control Panel to create additional users." };
    }

    const username = String(input.username || "").trim();
    const password = String(input.password || "");
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
    const users = getUsers();
    if (users.length > 0) {
      return { ok: false, message: "Users already exist. Use Control Panel to create additional users." };
    }

    const adminUsername = String(input.adminUsername || "").trim();
    const adminPassword = String(input.adminPassword || "");
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
      { username: String(input.opsManagerUsername || input.managerUsername || "").trim(), password: String(input.opsManagerPassword || input.managerPassword || ""), roleId: SYSTEM_ROLE_IDS.manager },
      { username: String(input.gmUsername || input.viewerUsername || "").trim(), password: String(input.gmPassword || input.viewerPassword || ""), roleId: SYSTEM_ROLE_IDS.viewer }
    ];

    optionalUsers.forEach((entry) => {
      if (!entry.username && !entry.password) return;
      if (!entry.username || !entry.password) return;
      payload.push({
        id: uid("user"),
        username: entry.username,
        password: entry.password,
        roleId: entry.roleId,
        active: true
      });
    });

    const partialOptional =
      (input.opsManagerUsername && !input.opsManagerPassword) ||
      (!input.opsManagerUsername && input.opsManagerPassword) ||
      (input.gmUsername && !input.gmPassword) ||
      (!input.gmUsername && input.gmPassword) ||
      (input.managerUsername && !input.managerPassword) ||
      (!input.managerUsername && input.managerPassword) ||
      (input.viewerUsername && !input.viewerPassword) ||
      (!input.viewerUsername && input.viewerPassword);
    if (partialOptional) {
      return { ok: false, message: "Ops Manager/GM requires both username and password." };
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
    hasUsers,
    healCoreAccess,
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
})();
