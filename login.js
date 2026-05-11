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

function routeUser(user, options = {}) {
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
  if (options.recoverRolesFallback) {
    window.location.href = "./control-panel.html?recoverRoles=1";
    return true;
  }
  return false;
}

async function startLogin() {
  if (!window.OPXAuth) {
    throw new Error("Authentication module failed to load.");
  }
  window.OPXAuth.init();

  const loginForm = document.getElementById("loginForm");
  const loginError = document.getElementById("loginError");
  const loginStatus = document.getElementById("loginStatus");
  const sessionContinueWrap = document.getElementById("sessionContinueWrap");
  const continueSessionBtn = document.getElementById("continueSessionBtn");
  const firstRunPanel = document.getElementById("firstRunPanel");
  const firstRunForm = document.getElementById("firstRunForm");
  const repairLoginBtn = document.getElementById("repairLoginBtn");
  const params = new URLSearchParams(window.location.search);

  // Attach submit handler immediately so fast clicks can't trigger native form navigation.
  loginForm?.addEventListener("submit", (e) => {
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

  if (params.get("locked") === "1") {
    loginError.textContent = "Session locked after 5 minutes of inactivity. Please log in again.";
  }

  if (params.get("logout") === "1") {
    window.OPXAuth.logout();
  }

  await waitForSharedAuth();

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

  firstRunForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.textContent = "";

    const submitBtn = firstRunForm.querySelector("button[type='submit']");
    if (submitBtn) submitBtn.disabled = true;

    try {
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
        loginError.textContent = created.message || "Could not create users.";
        return;
      }

      await window.OPXAuth.syncAuthToSupabase?.();

      const result = window.OPXAuth.login(adminUsername, adminPassword);
      if (!result.ok) {
        loginError.textContent = result.message || "Could not log in after user creation.";
        return;
      }

      if (!routeUser(result.user, { recoverRolesFallback: true })) {
        loginError.textContent = "Users were created, but this account has no page access yet. Open Control Panel and assign access.";
        window.OPXAuth.logout();
      }
    } catch (error) {
      loginError.textContent = `Create users failed: ${error?.message || error}`;
      console.error("First-run create users failed:", error);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  repairLoginBtn?.addEventListener("click", async () => {
    loginError.textContent = "";
    const adminUsername = (
      document.getElementById("firstRunUsername")?.value
      || document.getElementById("username")?.value
      || ""
    ).trim();
    const adminPassword = (
      document.getElementById("firstRunPassword")?.value
      || document.getElementById("password")?.value
      || ""
    );

    if (!adminUsername || !adminPassword) {
      loginError.textContent = "Enter username and password, then click Repair Login.";
      return;
    }

    try {
      window.OPXAuth.resetLocalAuthData?.();

      const created = window.OPXAuth.createInitialUsers({
        adminUsername,
        adminPassword,
        opsManagerUsername: "",
        opsManagerPassword: "",
        gmUsername: "",
        gmPassword: ""
      });

      if (!created.ok) {
        loginError.textContent = created.message || "Could not repair login.";
        return;
      }

      await window.OPXAuth.syncAuthToSupabase?.();
      const result = window.OPXAuth.login(adminUsername, adminPassword);
      if (!result.ok) {
        loginError.textContent = result.message || "Repair finished, but sign-in failed.";
        return;
      }
      routeUser(result.user, { recoverRolesFallback: true });
    } catch (error) {
      loginError.textContent = `Repair failed: ${error?.message || error}`;
    }
  });
}

void startLogin().catch((error) => {
  const loginError = document.getElementById("loginError");
  if (loginError) {
    loginError.textContent = `Login startup failed: ${error?.message || error}`;
  }
  console.error("Login startup failed:", error);
});
