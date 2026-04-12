window.OPXAuth.init();

const RECOVERY_USERS = {
  admin: { username: "admin", password: "Admin@123" },
  manager: { username: "opsmanager", password: "Ops@123" },
  gm: { username: "gm", password: "Gm@123" }
};

function runUrlRecoveryIfRequested() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("recover") !== "1") return false;

  localStorage.removeItem(window.OPXAuth.STORAGE.users);
  localStorage.removeItem(window.OPXAuth.STORAGE.roles);
  localStorage.removeItem(window.OPXAuth.STORAGE.session);
  window.OPXAuth.init();

  const created = window.OPXAuth.createInitialUsers({
    adminUsername: RECOVERY_USERS.admin.username,
    adminPassword: RECOVERY_USERS.admin.password,
    opsManagerUsername: RECOVERY_USERS.manager.username,
    opsManagerPassword: RECOVERY_USERS.manager.password,
    gmUsername: RECOVERY_USERS.gm.username,
    gmPassword: RECOVERY_USERS.gm.password
  });

  if (!created.ok) return false;
  const loginResult = window.OPXAuth.login(RECOVERY_USERS.admin.username, RECOVERY_USERS.admin.password);
  if (!loginResult.ok) return false;
  routeUser(loginResult.user);
  return true;
}

function routeUser(user) {
  const hasCRM = window.OPXAuth.canUser(user, "accessCRM");
  const hasLogs = window.OPXAuth.canUser(user, "accessLogs");
  const hasCP = window.OPXAuth.canUser(user, "accessControlPanel");

  if (hasCRM) {
    window.location.href = "./index.html";
    return true;
  }
  if (hasLogs) {
    window.location.href = "./log.html";
    return true;
  }
  if (hasCP) {
    window.location.href = "./control-panel.html";
    return true;
  }
  return false;
}

function tryCredentialRecovery(username, password) {
  const isKnownDefault =
    (username === RECOVERY_USERS.admin.username && password === RECOVERY_USERS.admin.password) ||
    (username === RECOVERY_USERS.manager.username && password === RECOVERY_USERS.manager.password) ||
    (username === RECOVERY_USERS.gm.username && password === RECOVERY_USERS.gm.password);

  if (!isKnownDefault) return null;

  try {
    localStorage.removeItem(window.OPXAuth.STORAGE.users);
    localStorage.removeItem(window.OPXAuth.STORAGE.roles);
    localStorage.removeItem(window.OPXAuth.STORAGE.session);
    window.OPXAuth.init();

    const created = window.OPXAuth.createInitialUsers({
      adminUsername: RECOVERY_USERS.admin.username,
      adminPassword: RECOVERY_USERS.admin.password,
      opsManagerUsername: RECOVERY_USERS.manager.username,
      opsManagerPassword: RECOVERY_USERS.manager.password,
      gmUsername: RECOVERY_USERS.gm.username,
      gmPassword: RECOVERY_USERS.gm.password
    });
    if (!created.ok) return null;

    return window.OPXAuth.login(username, password);
  } catch {
    return null;
  }
}

const sessionUser = window.OPXAuth.getSessionUser();
if (sessionUser) {
  routeUser(sessionUser);
}

if (runUrlRecoveryIfRequested()) {
  // URL recovery performed and routed user.
}

const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const firstRunPanel = document.getElementById("firstRunPanel");
const firstRunForm = document.getElementById("firstRunForm");

if (!window.OPXAuth.hasUsers()) {
  loginForm.style.display = "none";
  firstRunPanel.style.display = "block";
}

loginForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  const result = window.OPXAuth.login(username, password);
  if (!result.ok) {
    const recovered = tryCredentialRecovery(username, password);
    if (!recovered?.ok) {
      loginError.textContent = result.message;
      return;
    }

    const recoveredRouted = routeUser(recovered.user);
    if (!recoveredRouted) {
      loginError.textContent = "This account has no page access assigned.";
      window.OPXAuth.logout();
    }
    return;
  }

  const routed = routeUser(result.user);
  if (!routed) {
    loginError.textContent = "This account has no page access assigned.";
    window.OPXAuth.logout();
  }
});

firstRunForm?.addEventListener("submit", (e) => {
  e.preventDefault();

  const username = document.getElementById("firstRunUsername").value.trim();
  const password = document.getElementById("firstRunPassword").value;
  const opsManagerUsername = document.getElementById("firstRunOpsManagerUsername").value.trim();
  const opsManagerPassword = document.getElementById("firstRunOpsManagerPassword").value;
  const gmUsername = document.getElementById("firstRunGmUsername").value.trim();
  const gmPassword = document.getElementById("firstRunGmPassword").value;

  const created = window.OPXAuth.createInitialUsers({
    adminUsername: username,
    adminPassword: password,
    opsManagerUsername,
    opsManagerPassword,
    gmUsername,
    gmPassword
  });
  if (!created.ok) {
    loginError.textContent = created.message;
    return;
  }

  const result = window.OPXAuth.login(username, password);
  if (!result.ok) {
    loginError.textContent = result.message;
    return;
  }

  routeUser(result.user);
});
