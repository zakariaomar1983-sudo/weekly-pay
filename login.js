async function waitForSharedAuth() {
  if (window.OPXSupabase?.isReady && window.OPXAuth?.hydrateAuthFromSupabase) {
    return window.OPXAuth.hydrateAuthFromSupabase();
  }

  return new Promise((resolve) => {
    let settled = false;
    const done = async () => {
      if (settled) return;
      settled = true;
      if (window.OPXSupabase?.isReady && window.OPXAuth?.hydrateAuthFromSupabase) {
        resolve(await window.OPXAuth.hydrateAuthFromSupabase());
        return;
      }
      resolve(false);
    };

    window.addEventListener("opx:supabase-ready", done, { once: true });
    window.addEventListener("opx:supabase-error", done, { once: true });
    setTimeout(done, 1800);
  });
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function routeUser(user) {
  if (window.OPXAuth.canUser(user, "accessCRM")) {
    window.location.href = "./index.html";
    return true;
  }
  if (window.OPXAuth.canUser(user, "accessLogs")) {
    window.location.href = "./log.html";
    return true;
  }
  if (window.OPXAuth.canUser(user, "accessControlPanel")) {
    window.location.href = "./control-panel.html";
    return true;
  }
  return false;
}

async function startLogin() {
  window.OPXAuth.init();

  const params = new URLSearchParams(window.location.search);
  if (params.get("logout") === "1") {
    window.OPXAuth.logout();
  }

  await waitForSharedAuth();

  const loginForm = document.getElementById("loginForm");
  const loginError = document.getElementById("loginError");
  const loginStatus = document.getElementById("loginStatus");
  const repairLoginBtn = document.getElementById("repairLoginBtn");
  const sessionContinueWrap = document.getElementById("sessionContinueWrap");
  const continueSessionBtn = document.getElementById("continueSessionBtn");
  const firstRunPanel = document.getElementById("firstRunPanel");
  const firstRunForm = document.getElementById("firstRunForm");

  if (params.get("locked") === "1") {
    loginError.textContent = "Session locked after 5 minutes of inactivity. Please log in again.";
  }

  const sessionUser = window.OPXAuth.getSessionUser();
  if (sessionUser) {
    if (loginStatus) {
      loginStatus.textContent = `Signed in on this device as ${sessionUser.username}. Enter a username and password below to continue or switch accounts.`;
    }
    if (sessionContinueWrap) sessionContinueWrap.style.display = "";
    if (continueSessionBtn) {
      continueSessionBtn.textContent = `Continue as ${sessionUser.username}`;
      continueSessionBtn.addEventListener("click", () => {
        if (!routeUser(sessionUser)) {
          loginError.textContent = "This account has no page access assigned.";
          window.OPXAuth.logout();
        }
      });
    }
  }

  if (!window.OPXAuth.hasUsers()) {
    loginForm.style.display = "none";
    firstRunPanel.style.display = "block";
  } else {
    loginForm.style.display = "";
    firstRunPanel.style.display = "none";
  }

  repairLoginBtn?.addEventListener("click", async () => {
    loginError.textContent = "";
    if (loginStatus) loginStatus.textContent = "Repairing login data on this device...";

    try {
      window.OPXAuth.logout();
      window.OPXAuth.healCoreAccess();
      await waitForSharedAuth();

      const usernameInput = document.getElementById("username");
      const passwordInput = document.getElementById("password");
      const typedUsername = String(usernameInput?.value || "").trim();
      const typedPassword = String(passwordInput?.value || "");

      const users = window.OPXAuth.getUsers();
      const existing = users.find((user) => normalizeName(user?.username) === normalizeName(typedUsername));

      // If a username + password are entered, use them as a recovery credential.
      if (typedUsername && typedPassword) {
        if (existing) {
          window.OPXAuth.updateUser(existing.id, {
            username: existing.username,
            password: typedPassword,
            roleId: existing.roleId || window.OPXAuth.SYSTEM_ROLE_IDS.admin,
            active: true
          });
        } else {
          window.OPXAuth.createUser({
            username: typedUsername,
            password: typedPassword,
            roleId: window.OPXAuth.SYSTEM_ROLE_IDS.admin,
            active: true
          });
        }
      }

      if (!window.OPXAuth.hasUsers()) {
        loginForm.style.display = "none";
        firstRunPanel.style.display = "block";
        if (loginStatus) {
          loginStatus.textContent = "Repair complete. No users exist yet, so create an admin account below.";
        }
        return;
      }

      loginForm.style.display = "";
      firstRunPanel.style.display = "none";
      if (loginStatus) {
        loginStatus.textContent = typedUsername && typedPassword
          ? "Repair complete. Try logging in with the username and password you entered."
          : "Repair complete. Try logging in again.";
      }
    } catch (error) {
      loginError.textContent = `Repair failed: ${error?.message || error}`;
      if (loginStatus) loginStatus.textContent = "";
    }
  });

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    loginError.textContent = "";

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    const result = window.OPXAuth.login(username, password);
    if (!result.ok) {
      loginError.textContent = result.message;
      return;
    }

    if (!routeUser(result.user)) {
      loginError.textContent = "This account has no page access assigned.";
      window.OPXAuth.logout();
    }
  });

  firstRunForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.textContent = "";

    const adminUsername = document.getElementById("firstRunUsername").value.trim();
    const adminPassword = document.getElementById("firstRunPassword").value;
    const opsManagerUsername = document.getElementById("firstRunOpsManagerUsername").value.trim();
    const opsManagerPassword = document.getElementById("firstRunOpsManagerPassword").value;
    const gmUsername = document.getElementById("firstRunGmUsername").value.trim();
    const gmPassword = document.getElementById("firstRunGmPassword").value;

    const created = window.OPXAuth.createInitialUsers({
      adminUsername,
      adminPassword,
      opsManagerUsername,
      opsManagerPassword,
      gmUsername,
      gmPassword
    });

    if (!created.ok) {
      loginError.textContent = created.message;
      return;
    }

    await window.OPXAuth.syncAuthToSupabase?.();

    const result = window.OPXAuth.login(adminUsername, adminPassword);
    if (!result.ok) {
      loginError.textContent = result.message;
      return;
    }

    routeUser(result.user);
  });
}

void startLogin();
