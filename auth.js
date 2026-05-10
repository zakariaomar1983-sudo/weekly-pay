(function authBootstrap() {
  const STORAGE = {
    roles: "opx_auth_roles",
    users: "opx_auth_users",
    session: "opx_auth_session",
    audit: "transport_crm_staff_audit"
  };
  const SYNC_HEALTH_STORAGE_KEYS = [
    "transport_crm_drivers_sync_status",
    "transport_crm_trucks_sync_status",
    "transport_crm_roster_sync_status",
    "transport_crm_finance_sync_status",
    "transport_crm_logs_sync_status"
  ];
  const SYNC_HISTORY_KEY = "transport_crm_sync_history";
  const SYNC_HISTORY_MAX_ENTRIES = 30;
  const SYNC_HISTORY_MAX_MESSAGE_CHARS = 280;
  const SYNC_HISTORY_MAX_SOURCE_CHARS = 40;
  const AUTH_STORAGE_EVICT_KEYS = [
    SYNC_HISTORY_KEY,
    "transport_crm_drivers_sync_status",
    "transport_crm_trucks_sync_status",
    "transport_crm_roster_sync_status",
    "transport_crm_finance_sync_status",
    "transport_crm_logs_sync_status"
  ];
  const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
  const ACTIVITY_TOUCH_MS = 15 * 1000;
  const AUTH_TABLES = {
    roles: "auth_roles",
    users: "auth_users"
  };
  let authSyncBusy = false;
  let sharedAuthStatus = "Shared login not checked yet.";
  let idleTimerId = null;
  let lastActivityTouch = 0;
  let authSyncTimerId = null;
  let syncToastTimerId = null;
  const volatileStore = new Map();
  const TAB_STORE_PREFIX = "__opx_tab_store__:";

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
    { key: "viewReports", label: "View Reports" },
    { key: "emailReports", label: "Email Reports" },
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
  const IMMUTABLE_ROLE_IDS = new Set([SYSTEM_ROLE_IDS.admin]);
  const OWNER_ADMIN_USERNAMES = new Set(["zakaria omar"]);

  const STARTER_CUSTOM_ROLE_IDS = {
    manager: "role_manager",
    viewer: "role_viewer",
    teamBasic: "role_team_basic",
    dispatcher: "role_dispatcher",
    finance: "role_finance",
    fleet: "role_fleet_manager",
    payroll: "role_payroll",
    compliance: "role_compliance",
    dataEntry: "role_data_entry"
  };

  function readTabStore() {
    if (typeof window === "undefined") return {};
    const raw = String(window.name || "");
    if (!raw.startsWith(TAB_STORE_PREFIX)) return {};
    try {
      const parsed = JSON.parse(raw.slice(TAB_STORE_PREFIX.length));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeTabStore(store) {
    if (typeof window === "undefined") return false;
    try {
      window.name = `${TAB_STORE_PREFIX}${JSON.stringify(store || {})}`;
      return true;
    } catch {
      return false;
    }
  }

  function readTabStoreValue(key) {
    const store = readTabStore();
    return typeof store[key] === "string" ? store[key] : null;
  }

  function writeTabStoreValue(key, serialized) {
    const store = readTabStore();
    store[key] = serialized;
    return writeTabStore(store);
  }

  function removeTabStoreValue(key) {
    const store = readTabStore();
    if (!(key in store)) return true;
    delete store[key];
    return writeTabStore(store);
  }

  function read(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      if (parsed != null) return parsed;
    } catch {
      // fall through to sessionStorage fallback
    }
    try {
      const parsed = JSON.parse(sessionStorage.getItem(key) || "null");
      if (parsed != null) return parsed;
    } catch {
      // fall through to fallback stores
    }
    const tabRaw = readTabStoreValue(key);
    if (typeof tabRaw === "string") {
      try {
        const parsed = JSON.parse(tabRaw);
        if (parsed != null) return parsed;
      } catch {
        // ignore
      }
    }
    const raw = volatileStore.get(key);
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return parsed == null ? fallback : parsed;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }

  function removeFallbackValue(key) {
    removeTabStoreValue(key);
    volatileStore.delete(key);
  }

  function write(key, value) {
    const serialized = JSON.stringify(value);
    try {
      localStorage.setItem(key, serialized);
      try {
        sessionStorage.removeItem(key);
      } catch {
        // ignore
      }
      removeFallbackValue(key);
      return true;
    }
    catch (localError) {
      reclaimStorageForAuthWrites();
      try {
        localStorage.setItem(key, serialized);
        removeFallbackValue(key);
        return true;
      } catch {
        // fall through to sessionStorage fallback
      }
      try {
        sessionStorage.setItem(key, serialized);
        removeFallbackValue(key);
        return true;
      } catch (sessionError) {
        // Final fallback keeps app usable across page navigation in this tab.
        writeTabStoreValue(key, serialized);
        volatileStore.set(key, serialized);
        console.warn(`Storage write fell back to tab memory for ${key}.`, localError, sessionError);
        return true;
      }
    }
  }

  function removeStorageKey(storage, key) {
    try {
      storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  function clearKeyEverywhere(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
    try {
      sessionStorage.removeItem(key);
    } catch {}
    removeFallbackValue(key);
  }

  function trimAuditHistory(maxRows) {
    const rows = read(STORAGE.audit, []);
    if (!Array.isArray(rows) || rows.length <= maxRows) return false;
    const trimmed = rows.slice(0, maxRows);
    return write(STORAGE.audit, trimmed);
  }

  function reclaimStorageForAuthWrites() {
    let changed = false;
    AUTH_STORAGE_EVICT_KEYS.forEach((key) => {
      try {
        if (localStorage.getItem(key) != null) {
          removeStorageKey(localStorage, key);
          changed = true;
        }
      } catch {
        // ignore
      }
      try {
        if (sessionStorage.getItem(key) != null) {
          removeStorageKey(sessionStorage, key);
          changed = true;
        }
      } catch {
        // ignore
      }
      changed = removeTabStoreValue(key) || changed;
      volatileStore.delete(key);
    });

    // Keep audit history but shrink it if needed.
    changed = trimAuditHistory(120) || changed;
    changed = trimAuditHistory(40) || changed;
    return changed;
  }

  function readSyncHealthStatus(key) {
    const parsed = read(key, null);
    return parsed && typeof parsed === "object" ? parsed : null;
  }

  function readSyncHistory() {
    const history = read(SYNC_HISTORY_KEY, []);
    return Array.isArray(history) ? history : [];
  }

  function normalizeSyncHistoryEntries(entries) {
    if (!Array.isArray(entries)) return [];
    return entries
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => {
        const source = String(entry.source || "CRM").trim().slice(0, SYNC_HISTORY_MAX_SOURCE_CHARS);
        const message = String(entry.message || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, SYNC_HISTORY_MAX_MESSAGE_CHARS);
        const tone = String(entry.tone || "neutral").trim().slice(0, 20) || "neutral";
        const atNum = Number(entry.at);
        const at = Number.isFinite(atNum) ? atNum : Date.now();
        return { source, message, tone, at };
      })
      .filter((entry) => entry.message);
  }

  function writeSyncHistory(entries) {
    const normalized = normalizeSyncHistoryEntries(entries).slice(0, SYNC_HISTORY_MAX_ENTRIES);
    if (write(SYNC_HISTORY_KEY, normalized)) return;

    // If storage is tight, keep retrying with a smaller history payload.
    let compact = normalized.slice();
    while (compact.length > 1) {
      compact = compact.slice(0, Math.max(1, Math.floor(compact.length / 2)));
      if (write(SYNC_HISTORY_KEY, compact)) return;
    }

    // Final fallback: avoid repeated crashes by dropping this key when quota is exhausted.
    clearKeyEverywhere(SYNC_HISTORY_KEY);
  }

  function appendSyncHistoryEvent(detail) {
    if (!detail?.message) return;
    const nextEntry = {
      source: String(detail.source || "CRM"),
      message: String(detail.message || ""),
      tone: String(detail.tone || "neutral"),
      at: Number(detail.at || Date.now())
    };
    const history = readSyncHistory();
    const latest = history[0];
    if (
      latest
      && latest.source === nextEntry.source
      && latest.message === nextEntry.message
      && latest.tone === nextEntry.tone
      && Math.abs(Number(latest.at || 0) - nextEntry.at) < 10000
    ) {
      return;
    }
    history.unshift(nextEntry);
    writeSyncHistory(history);
  }

  function isQueuedSyncEntry(entry) {
    const message = String(entry?.message || "").toLowerCase();
    return entry?.tone === "error"
      || entry?.tone === "syncing"
      || message.includes("retry")
      || message.includes("waiting for internet")
      || message.includes("saved here");
  }

  function clearSyncHistory() {
    writeSyncHistory([]);
  }

  function ensureSyncHistoryDrawer() {
    if (typeof document === "undefined") return null;
    let drawer = document.getElementById("syncHistoryDrawer");
    if (drawer) return drawer;

    drawer = document.createElement("aside");
    drawer.id = "syncHistoryDrawer";
    drawer.className = "sync-history-drawer";
    drawer.hidden = true;
    drawer.innerHTML = `
      <div class="sync-history-head">
        <div>
          <p class="eyebrow">Sync History</p>
          <h3>Recent activity</h3>
        </div>
        <div class="actions">
          <button id="copySyncDiagnosticsBtn" class="btn btn-outline" type="button">Copy diagnostics</button>
          <button id="clearSyncHistoryBtn" class="btn btn-outline" type="button">Clear</button>
          <button id="closeSyncHistoryBtn" class="btn btn-muted" type="button">Close</button>
        </div>
      </div>
      <p id="syncHistoryStatus" class="muted sync-history-status"></p>
      <div id="syncHistoryList" class="sync-history-list"></div>
    `;
    document.body.appendChild(drawer);

    drawer.querySelector("#closeSyncHistoryBtn")?.addEventListener("click", () => {
      drawer.hidden = true;
      document.getElementById("crmHealthChip")?.setAttribute("aria-expanded", "false");
    });

    drawer.querySelector("#clearSyncHistoryBtn")?.addEventListener("click", () => {
      clearSyncHistory();
      renderSyncHistoryDrawer();
    });

    drawer.querySelector("#copySyncDiagnosticsBtn")?.addEventListener("click", async () => {
      await copySyncDiagnostics();
    });

    return drawer;
  }

  async function copyTextToClipboard(text) {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }

  function setSyncHistoryStatus(message = "") {
    const node = document.getElementById("syncHistoryStatus");
    if (!node) return;
    node.textContent = message;
  }

  function buildSyncDiagnosticsReport() {
    const user = getSessionUser();
    const role = user ? getRoleById(user.roleId) : null;
    const summary = getSyncDashboardSummary();
    const statuses = summary.statuses;
    const history = readSyncHistory();
    const lines = [
      "OnPoint Express CRM diagnostics",
      `Generated: ${new Date().toLocaleString("en-AU")}`,
      `Page: ${window.location.href}`,
      `Online: ${navigator.onLine ? "Yes" : "No"}`,
      `Top bar health: ${summary.health.label}`,
      `User: ${user ? user.username : "No active user"}`,
      `Role: ${role?.name || "Unknown"}`,
      `Shared auth: ${summary.sharedAuthStatus}`,
      "",
      "Page sync states:"
    ];

    statuses.forEach((entry) => {
      const time = entry.at ? new Date(entry.at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }) : "n/a";
      lines.push(`- ${entry.label}: ${entry.message} [${entry.tone}] @ ${time}`);
    });

    lines.push("", "Recent sync history:");
    if (!history.length) {
      lines.push("- No recent sync events");
    } else {
      history.forEach((entry) => {
        const time = new Date(Number(entry.at || Date.now())).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
        lines.push(`- ${time} | ${entry.source} | ${entry.tone} | ${entry.message}`);
      });
    }

    return lines.join("\n");
  }

  async function copySyncDiagnostics() {
    try {
      const report = buildSyncDiagnosticsReport();
      const copied = await copyTextToClipboard(report);
      if (!copied) throw new Error("Clipboard copy was blocked.");
      setSyncHistoryStatus("Diagnostics copied. You can paste them into a message or email.");
    } catch (error) {
      setSyncHistoryStatus(`Could not copy diagnostics: ${error.message || error}`);
    }
  }

  function renderSyncHistoryDrawer() {
    const drawer = ensureSyncHistoryDrawer();
    if (!drawer) return;
    const list = drawer.querySelector("#syncHistoryList");
    if (!list) return;
    setSyncHistoryStatus("");
    const history = readSyncHistory();
    if (!history.length) {
      list.innerHTML = "<p class='muted'>No recent sync events yet.</p>";
      return;
    }
    list.innerHTML = history.map((entry) => {
      const time = new Date(Number(entry.at || Date.now())).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
      return `
        <article class="sync-history-item sync-history-item-${entry.tone || "neutral"}">
          <div class="sync-history-meta">
            <strong>${entry.source}</strong>
            <span>${time}</span>
          </div>
          <p>${entry.message}</p>
        </article>
      `;
    }).join("");
  }

  function toggleSyncHistoryDrawer() {
    const drawer = ensureSyncHistoryDrawer();
    if (!drawer) return;
    drawer.hidden = !drawer.hidden;
    document.getElementById("crmHealthChip")?.setAttribute("aria-expanded", drawer.hidden ? "false" : "true");
    if (!drawer.hidden) renderSyncHistoryDrawer();
  }

  function ensureSyncToast() {
    if (typeof document === "undefined") return null;
    let toast = document.getElementById("syncToast");
    if (toast) return toast;
    toast = document.createElement("aside");
    toast.id = "syncToast";
    toast.className = "sync-toast sync-toast-neutral";
    toast.hidden = true;
    document.body.appendChild(toast);
    return toast;
  }

  function showSyncToast(message, tone = "neutral", duration = 3200) {
    const toast = ensureSyncToast();
    if (!toast || !message) return;
    window.clearTimeout(syncToastTimerId);
    toast.textContent = message;
    toast.className = `sync-toast sync-toast-${tone}`;
    toast.hidden = false;
    syncToastTimerId = window.setTimeout(() => {
      toast.hidden = true;
    }, duration);
  }

  function ensureHealthChip() {
    if (typeof document === "undefined") return null;
    const actions = document.querySelector(".topbar-actions");
    if (!actions) return null;
    let chip = document.getElementById("crmHealthChip");
    if (!chip) {
      chip = document.createElement("button");
      chip.id = "crmHealthChip";
      chip.type = "button";
      chip.className = "health-chip health-chip-live";
      chip.textContent = "Live";
      chip.setAttribute("aria-expanded", "false");
      chip.addEventListener("click", toggleSyncHistoryDrawer);
      const userChip = document.getElementById("currentUserChip");
      if (userChip?.parentElement === actions) {
        userChip.insertAdjacentElement("afterend", chip);
      } else {
        actions.prepend(chip);
      }
    }
    return chip;
  }

  function getTopbarHealthState() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { label: "Offline", tone: "offline" };
    }

    const syncEntries = SYNC_HEALTH_STORAGE_KEYS.map(readSyncHealthStatus).filter(Boolean);
    const hasQueuedSync = syncEntries.some((entry) => isQueuedSyncEntry(entry));

    const sharedStatusText = String(sharedAuthStatus || "").toLowerCase();
    const hasSharedAuthQueue = sharedStatusText.includes("checking")
      || sharedStatusText.includes("sync failed")
      || sharedStatusText.includes("load failed");

    if (hasQueuedSync || hasSharedAuthQueue) {
      return { label: "Sync Queue", tone: "queue" };
    }

    return { label: "Live", tone: "live" };
  }

  function getSyncDashboardSummary() {
    const health = getTopbarHealthState();
    const statuses = SYNC_HEALTH_STORAGE_KEYS.map((key) => {
      const entry = readSyncHealthStatus(key);
      return {
        key,
        label: key.replace("transport_crm_", "").replaceAll("_", " "),
        message: entry?.message || "No status recorded",
        tone: entry?.tone || "neutral",
        at: entry?.at || null
      };
    });
    const queueCount = statuses.filter((entry) => isQueuedSyncEntry(entry)).length;
    const latest = readSyncHistory()[0] || null;
    return {
      health,
      queueCount,
      latest,
      sharedAuthStatus,
      statuses
    };
  }

  function renderTopbarHealthChip() {
    const chip = ensureHealthChip();
    if (!chip) return;
    const state = getTopbarHealthState();
    chip.textContent = state.label;
    chip.className = `health-chip health-chip-${state.tone}`;
    chip.title = "Open recent sync activity";
  }

  function installTopbarHealthChip() {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (window.__opxHealthChipInstalled) {
      renderTopbarHealthChip();
      renderSyncHistoryDrawer();
      return;
    }
    window.__opxHealthChipInstalled = true;
    renderTopbarHealthChip();
    renderSyncHistoryDrawer();
    window.addEventListener("storage", (event) => {
      if (!event.key) return;
      if (SYNC_HEALTH_STORAGE_KEYS.includes(event.key)) {
        renderTopbarHealthChip();
        return;
      }
      if (event.key === SYNC_HISTORY_KEY) {
        renderSyncHistoryDrawer();
      }
    });
    window.addEventListener("online", () => {
      renderTopbarHealthChip();
      renderSyncHistoryDrawer();
      showSyncToast("Back online. Syncing queued changes now.", "live");
    });
    window.addEventListener("offline", () => {
      renderTopbarHealthChip();
      renderSyncHistoryDrawer();
      showSyncToast("Offline mode: changes will save locally until the internet returns.", "offline", 4200);
    });
    window.addEventListener("opx:sync-health-change", (event) => {
      appendSyncHistoryEvent(event.detail);
      renderTopbarHealthChip();
      renderSyncHistoryDrawer();
    });
  }

  function getAuditEntries() {
    const current = read(STORAGE.audit, []);
    return Array.isArray(current) ? current : [];
  }

  function setAuditEntries(entries) {
    write(STORAGE.audit, entries.slice(0, 400));
  }

  function uid(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeUsername(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function isProtectedOwnerUsername(value) {
    return OWNER_ADMIN_USERNAMES.has(normalizeUsername(value));
  }

  function isProtectedOwnerUser(user) {
    return isProtectedOwnerUsername(user?.username);
  }

  function getActorSnapshot() {
    const session = read(STORAGE.session, null);
    const users = read(STORAGE.users, []);
    const actor = Array.isArray(users) ? users.find((user) => user?.id === session?.userId) : null;
    return {
      actorUserId: actor?.id || "",
      actorUsername: actor?.username || "System",
      actorRoleId: actor?.roleId || ""
    };
  }

  function recordAuditEvent(input) {
    const actor = input?.actor || getActorSnapshot();
    const entry = {
      id: uid("audit"),
      at: new Date().toISOString(),
      actorUserId: actor.actorUserId || "",
      actorUsername: actor.actorUsername || "System",
      actorRoleId: actor.actorRoleId || "",
      action: String(input?.action || "update"),
      area: String(input?.area || "control-panel"),
      targetType: String(input?.targetType || "record"),
      targetId: String(input?.targetId || ""),
      targetName: String(input?.targetName || ""),
      summary: String(input?.summary || "Record updated"),
      details: input?.details && typeof input.details === "object" ? input.details : {}
    };

    const entries = getAuditEntries();
    entries.unshift(entry);
    setAuditEntries(entries);
    return entry;
  }

  function allPermissions(value) {
    const out = {};
    PERMISSIONS.forEach((perm) => {
      out[perm.key] = value;
    });
    return out;
  }

  function getSupabaseClient() {
    return window.OPXSupabase?.isReady ? window.OPXSupabase.client : null;
  }

  function extractSupabaseErrorMessage(error) {
    return String(error?.message || error?.error_description || error || "").trim();
  }

  function isMissingSharedAuthTableError(error) {
    const message = extractSupabaseErrorMessage(error).toLowerCase();
    return message.includes("auth_roles")
      || message.includes("auth_users")
      || message.includes("schema cache")
      || message.includes("could not find the table");
  }

  function setLocalOnlySharedAuthStatus() {
    sharedAuthStatus = "Shared login tables are not set up in Supabase yet. Control Panel is using this browser's local roles and users.";
  }

  function toDbRole(role) {
    return {
      id: role.id,
      name: role.name || "Custom Role",
      system: Boolean(role.system),
      permissions: role.permissions || {}
    };
  }

  function fromDbRole(row) {
    return {
      id: String(row.id || ""),
      name: String(row.name || "Custom Role"),
      system: Boolean(row.system),
      permissions: row.permissions && typeof row.permissions === "object" ? row.permissions : {}
    };
  }

  function toDbUser(user) {
    return {
      id: user.id,
      username: user.username || "",
      password: user.password || "",
      role_id: user.roleId || SYSTEM_ROLE_IDS.admin,
      active: user.active !== false
    };
  }

  function fromDbUser(row) {
    return {
      id: String(row.id || ""),
      username: String(row.username || ""),
      password: String(row.password || ""),
      roleId: String(row.role_id || SYSTEM_ROLE_IDS.admin),
      active: row.active !== false
    };
  }

  function buildSystemRoleDefinitions() {
    const adminPerms = allPermissions(true);

    return [
      { id: SYSTEM_ROLE_IDS.admin, name: "Admin", system: true, permissions: adminPerms }
    ];
  }

  function buildStarterCustomRoleDefinitions() {
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
      "viewReports",
      "emailReports",
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
      "viewReports",
      "emailReports",
      "viewPayslips",
      "viewStats"
    ].forEach((key) => {
      viewerPerms[key] = true;
    });
    const teamBasicPerms = allPermissions(false);
    [
      "accessCRM",
      "viewTrucks",
      "viewRoster"
    ].forEach((key) => {
      teamBasicPerms[key] = true;
    });

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
      "viewReports",
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
      "viewReports",
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
      "viewReports",
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
      "viewReports",
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
      "viewReports",
      "viewTruckIncome",
      "editTruckIncome",
      "viewSpending",
      "editSpending"
    ].forEach((key) => {
      dataEntryPerms[key] = true;
    });

    return [
      { id: STARTER_CUSTOM_ROLE_IDS.manager, name: "Ops Manager", system: false, permissions: managerPerms },
      { id: STARTER_CUSTOM_ROLE_IDS.viewer, name: "GM", system: false, permissions: viewerPerms },
      { id: STARTER_CUSTOM_ROLE_IDS.teamBasic, name: "Team - Trucks & Roster", system: false, permissions: teamBasicPerms },
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
    const systemIds = new Set(systemRoles.filter((r) => r.system).map((r) => r.id));
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

      if (isProtectedOwnerUser(normalized)) {
        normalized.roleId = SYSTEM_ROLE_IDS.admin;
        normalized.active = true;
      }

      if (normalized.username === "admin" && normalized.password === "admin123") return;

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
    const currentRoles = read(STORAGE.roles, []);
    const nextRoles = normalizeRoles(currentRoles);
    if (JSON.stringify(nextRoles) !== JSON.stringify(currentRoles)) {
      write(STORAGE.roles, nextRoles);
    }
    return nextRoles;
  }

  function setRoles(roles) {
    return write(STORAGE.roles, normalizeRoles(roles));
  }

  function getUsers() {
    const roles = getRoles();
    const currentUsers = read(STORAGE.users, []);
    const nextUsers = normalizeUsers(currentUsers, roles);
    if (JSON.stringify(nextUsers) !== JSON.stringify(currentUsers)) {
      write(STORAGE.users, nextUsers);
    }
    return nextUsers;
  }

  function setUsers(users) {
    return write(STORAGE.users, normalizeUsers(users, getRoles()));
  }

  async function deleteMissingRemoteRows(client, table, ids) {
    if (!ids.length) {
      await client.from(table).delete().not("id", "is", null);
      return;
    }
    const inList = `(${ids.map((id) => `"${String(id).replaceAll('"', "")}"`).join(",")})`;
    await client.from(table).delete().not("id", "in", inList);
  }

  async function syncAuthToSupabase() {
    const client = getSupabaseClient();
    if (!client || authSyncBusy) return false;
    authSyncBusy = true;

    try {
      const roles = getRoles().map(toDbRole);
      const users = getUsers().map(toDbUser);

      const roleResult = await client.from(AUTH_TABLES.roles).upsert(roles, { onConflict: "id" });
      if (roleResult.error) {
        if (isMissingSharedAuthTableError(roleResult.error)) {
          setLocalOnlySharedAuthStatus();
          console.warn("Shared auth tables missing in Supabase; using local roles/users.");
          return false;
        }
        sharedAuthStatus = `Shared role sync failed: ${roleResult.error.message}`;
        console.warn("Shared role sync failed:", roleResult.error.message);
        return false;
      }

      const userResult = await client.from(AUTH_TABLES.users).upsert(users, { onConflict: "id" });
      if (userResult.error) {
        if (isMissingSharedAuthTableError(userResult.error)) {
          setLocalOnlySharedAuthStatus();
          console.warn("Shared auth tables missing in Supabase; using local roles/users.");
          return false;
        }
        sharedAuthStatus = `Shared user sync failed: ${userResult.error.message}`;
        console.warn("Shared user sync failed:", userResult.error.message);
        return false;
      }

      await deleteMissingRemoteRows(client, AUTH_TABLES.roles, roles.map((role) => role.id));
      await deleteMissingRemoteRows(client, AUTH_TABLES.users, users.map((user) => user.id));
      sharedAuthStatus = "Shared login roles/users synced.";
      return true;
    } catch (error) {
      sharedAuthStatus = `Shared auth sync failed: ${error.message || error}`;
      console.warn("Shared auth sync failed:", error.message || error);
      return false;
    } finally {
      authSyncBusy = false;
    }
  }

  function scheduleAuthSync() {
    const client = getSupabaseClient();
    if (!client) return;
    if (authSyncTimerId) window.clearTimeout(authSyncTimerId);
    authSyncTimerId = window.setTimeout(() => {
      authSyncTimerId = null;
      void syncAuthToSupabase();
    }, 300);
  }

  async function hydrateAuthFromSupabase() {
    const client = getSupabaseClient();
    if (!client) return false;

    try {
      const [roleResult, userResult] = await Promise.all([
        client.from(AUTH_TABLES.roles).select("*"),
        client.from(AUTH_TABLES.users).select("*")
      ]);

      if (roleResult.error || userResult.error) {
        const message = roleResult.error?.message || userResult.error?.message || "Unknown Supabase auth load error";
        if (isMissingSharedAuthTableError(roleResult.error || userResult.error || message)) {
          setLocalOnlySharedAuthStatus();
          console.warn("Shared auth tables missing in Supabase; using local roles/users.");
          return false;
        }
        sharedAuthStatus = `Shared login tables not ready: ${message}`;
        console.warn("Shared auth load failed:", message);
        return false;
      }

      const remoteRoles = Array.isArray(roleResult.data) ? roleResult.data.map(fromDbRole).filter((role) => role.id) : [];
      const remoteUsers = Array.isArray(userResult.data) ? userResult.data.map(fromDbUser).filter((user) => user.id && user.username && user.password) : [];

      if (remoteRoles.length || remoteUsers.length) {
        if (remoteRoles.length) setRoles(remoteRoles);
        if (remoteUsers.length) setUsers(remoteUsers);
        init();
        sharedAuthStatus = `Shared login loaded ${remoteRoles.length} role(s) and ${remoteUsers.length} user(s).`;
        return true;
      }

      if (getUsers().length) {
        await syncAuthToSupabase();
      }
      sharedAuthStatus = "Shared login tables are ready.";
      return true;
    } catch (error) {
      if (isMissingSharedAuthTableError(error)) {
        setLocalOnlySharedAuthStatus();
        console.warn("Shared auth tables missing in Supabase; using local roles/users.");
        return false;
      }
      sharedAuthStatus = `Shared auth load failed: ${error.message || error}`;
      console.warn("Shared auth load failed:", error.message || error);
      return false;
    }
  }

  function getSession() {
    const local = read(STORAGE.session, null);
    if (local?.userId) return local;

    // Fallback when localStorage is full/blocked: keep auth session in sessionStorage.
    try {
      const raw = sessionStorage.getItem(STORAGE.session);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function getSessionActivityAt(session) {
    const stamp = session?.lastActivityAt || session?.loginAt || null;
    const time = stamp ? new Date(stamp).getTime() : Number.NaN;
    return Number.isFinite(time) ? time : 0;
  }

  function isSessionExpired(session) {
    if (!session?.userId) return true;
    const lastActiveAt = getSessionActivityAt(session);
    if (!lastActiveAt) return true;
    return Date.now() - lastActiveAt >= IDLE_TIMEOUT_MS;
  }

  function isPublicAuthPage() {
    if (typeof window === "undefined") return false;
    const path = String(window.location.pathname || "").toLowerCase();
    return path.endsWith("/login.html") || path.endsWith("/logout.html");
  }

  function setSession(session) {
    return write(STORAGE.session, session);
  }

  function clearSession() {
    try {
      localStorage.removeItem(STORAGE.session);
    } catch {}
    try {
      sessionStorage.removeItem(STORAGE.session);
    } catch {}
    removeFallbackValue(STORAGE.session);
  }

  function getIdleRedirectPath() {
    return "./login.html?locked=1";
  }

  function clearIdleTimer() {
    if (idleTimerId) {
      clearTimeout(idleTimerId);
      idleTimerId = null;
    }
  }

  function scheduleIdleLock() {
    clearIdleTimer();
    if (typeof window === "undefined") return;

    const session = getSession();
    if (!session?.userId) return;

    const remaining = Math.max(0, IDLE_TIMEOUT_MS - (Date.now() - getSessionActivityAt(session)));
    idleTimerId = window.setTimeout(() => {
      const latest = getSession();
      if (!latest?.userId) return;
      if (!isSessionExpired(latest)) {
        scheduleIdleLock();
        return;
      }
      forceIdleLock();
    }, remaining || 1);
  }

  function touchSessionActivity(force = false) {
    const session = getSession();
    if (!session?.userId || isSessionExpired(session)) return false;

    const now = Date.now();
    if (!force && now - lastActivityTouch < ACTIVITY_TOUCH_MS) {
      scheduleIdleLock();
      return false;
    }

    lastActivityTouch = now;
    setSession({ ...session, lastActivityAt: new Date(now).toISOString() });
    scheduleIdleLock();
    return true;
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
    if (isSessionExpired(session)) {
      clearSession();
      clearIdleTimer();
      return null;
    }
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
    const name = normalizeUsername(username);
    const pass = String(password || "");
    const users = getUsers();
    const user = users.find((u) => normalizeUsername(u.username) === name && u.password === pass && u.active);
    if (!user) return { ok: false, message: "Invalid username or password." };
    const now = new Date().toISOString();
    const sessionSaved = setSession({ userId: user.id, loginAt: now, lastActivityAt: now });
    if (!sessionSaved) {
      return {
        ok: false,
        message: "Could not start session because browser storage is full. Please clear old site data and try again."
      };
    }
    lastActivityTouch = Date.now();
    scheduleIdleLock();
    recordAuditEvent({
      actor: { actorUserId: user.id, actorUsername: user.username, actorRoleId: user.roleId },
      action: "login",
      area: "auth",
      targetType: "session",
      targetId: user.id,
      targetName: user.username,
      summary: `${user.username} signed in`
    });
    return { ok: true, user };
  }

  function logout() {
    const actor = getActorSnapshot();
    if (actor.actorUsername && actor.actorUsername !== "System") {
      recordAuditEvent({
        actor,
        action: "logout",
        area: "auth",
        targetType: "session",
        targetId: actor.actorUserId,
        targetName: actor.actorUsername,
        summary: `${actor.actorUsername} signed out`
      });
    }
    clearSession();
    clearIdleTimer();
  }

  function forceIdleLock() {
    const actor = getActorSnapshot();
    if (actor.actorUsername && actor.actorUsername !== "System") {
      recordAuditEvent({
        actor,
        action: "lock",
        area: "auth",
        targetType: "session",
        targetId: actor.actorUserId,
        targetName: actor.actorUsername,
        summary: `${actor.actorUsername} was locked after 5 minutes idle`,
        details: { idleTimeoutMinutes: 5 }
      });
    }

    clearSession();
    clearIdleTimer();

    if (typeof window !== "undefined" && !isPublicAuthPage()) {
      window.location.href = getIdleRedirectPath();
    }
  }

  function triggerLogout(redirectPath = "./logout.html") {
    try {
      logout();
    } catch {
      try {
        localStorage.removeItem(STORAGE.session);
      } catch {
        // ignore
      }
    }

    if (typeof window !== "undefined" && redirectPath) {
      window.location.href = redirectPath;
    }
  }

  function installGlobalLogout() {
    if (typeof document === "undefined") return;
    if (window.__opxLogoutInstalled) return;
    window.__opxLogoutInstalled = true;

    document.addEventListener("click", (event) => {
      const target = event.target?.closest?.("#logoutBtn, [data-logout]");
      if (!target) return;
      event.preventDefault();
      triggerLogout(target.getAttribute("href") || "./logout.html");
    });
  }

  function disableAutofillWithin(root = document) {
    if (!root?.querySelectorAll) return;

    root.querySelectorAll("form").forEach((form) => {
      form.setAttribute("autocomplete", "off");
      form.setAttribute("data-form-type", "other");
    });

    root.querySelectorAll("input, textarea, select").forEach((field) => {
      if (field.type === "hidden") return;
      if (!field.getAttribute("autocomplete")) {
        field.setAttribute("autocomplete", field.type === "password" ? "new-password" : "off");
      }
      field.setAttribute("data-lpignore", "true");
      field.setAttribute("data-1p-ignore", "true");
      field.setAttribute("data-bwignore", "true");
      field.setAttribute("autocapitalize", "off");
      field.setAttribute("autocorrect", "off");
      field.setAttribute("spellcheck", "false");
    });
  }

  function installAutofillBlocker() {
    if (typeof document === "undefined") return;
    if (window.__opxAutofillBlockerInstalled) {
      disableAutofillWithin(document);
      return;
    }
    window.__opxAutofillBlockerInstalled = true;

    const apply = () => disableAutofillWithin(document);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", apply, { once: true });
    } else {
      apply();
    }

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node?.nodeType !== 1) return;
          disableAutofillWithin(node);
        });
      });
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function requireAuth(redirectPath) {
    init();
    const rawSession = getSession();
    const expired = rawSession?.userId && isSessionExpired(rawSession);
    if (expired) {
      clearSession();
      clearIdleTimer();
    }
    const user = expired ? null : getSessionUser();
    if (!user) {
      if (redirectPath) {
        window.location.href = expired ? getIdleRedirectPath() : redirectPath;
      }
      return null;
    }

    touchSessionActivity(true);

    return {
      user,
      can: (permission) => canUser(user, permission),
      permissions: getPermissionsForUser(user)
    };
  }

  function installIdleLock() {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (window.__opxIdleLockInstalled) {
      scheduleIdleLock();
      return;
    }
    window.__opxIdleLockInstalled = true;

    const onActivity = () => {
      touchSessionActivity(false);
    };

    ["pointerdown", "keydown", "touchstart", "scroll", "mousemove"].forEach((eventName) => {
      window.addEventListener(eventName, onActivity, { passive: true });
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        const session = getSession();
        if (session?.userId && isSessionExpired(session)) {
          forceIdleLock();
          return;
        }
        touchSessionActivity(true);
      }
    });

    window.addEventListener("focus", () => {
      const session = getSession();
      if (session?.userId && isSessionExpired(session)) {
        forceIdleLock();
        return;
      }
      touchSessionActivity(true);
    });

    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE.session) return;
      const session = getSession();
      if (!session?.userId) {
        clearIdleTimer();
        if (!isPublicAuthPage()) {
          window.location.href = "./login.html";
        }
        return;
      }
      if (isSessionExpired(session)) {
        forceIdleLock();
        return;
      }
      scheduleIdleLock();
    });

    scheduleIdleLock();
  }

  function createRole(input) {
    const name = String(input?.name || "").trim();
    if (!name) return { ok: false, message: "Role name is required." };

    const roles = getRoles();
    const payload = {
      id: uid("role"),
      name,
      system: false,
      permissions: { ...allPermissions(false), ...(input?.permissions || {}) }
    };
    roles.push(payload);
    if (!setRoles(roles)) {
      return { ok: false, message: "Could not save role because browser storage is full. Please clear old site data and try again." };
    }
    recordAuditEvent({
      action: "create",
      area: "roles",
      targetType: "role",
      targetId: payload.id,
      targetName: payload.name,
      summary: `Created role ${payload.name}`,
      details: { permissions: payload.permissions }
    });
    scheduleAuthSync();
    return { ok: true, role: payload };
  }

  function updateRole(roleId, input) {
    const roles = getRoles();
    const role = roles.find((r) => r.id === roleId);
    if (!role || IMMUTABLE_ROLE_IDS.has(role.id) || role.system) return { ok: false, message: "System roles cannot be edited." };

    const before = {
      name: role.name,
      permissions: { ...(role.permissions || {}) }
    };

    role.name = String(input?.name || "").trim() || role.name;
    role.permissions = { ...allPermissions(false), ...(input?.permissions || {}) };
    if (!setRoles(roles)) {
      return { ok: false, message: "Could not update role because browser storage is full. Please clear old site data and try again." };
    }
    recordAuditEvent({
      action: "update",
      area: "roles",
      targetType: "role",
      targetId: role.id,
      targetName: role.name,
      summary: `Updated role ${role.name}`,
      details: {
        before,
        after: {
          name: role.name,
          permissions: role.permissions
        }
      }
    });
    scheduleAuthSync();
    return { ok: true, role };
  }

  function deleteRole(roleId) {
    const roles = getRoles();
    const role = roles.find((r) => r.id === roleId);
    if (!role || IMMUTABLE_ROLE_IDS.has(role.id) || role.system) return { ok: false, message: "System role cannot be deleted." };

    const users = getUsers();
    const inUse = users.some((u) => u.roleId === roleId);
    if (inUse) return { ok: false, message: "Role is assigned to users. Reassign users first." };

    if (!setRoles(roles.filter((r) => r.id !== roleId))) {
      return { ok: false, message: "Could not delete role because browser storage is full. Please clear old site data and try again." };
    }
    recordAuditEvent({
      action: "delete",
      area: "roles",
      targetType: "role",
      targetId: role.id,
      targetName: role.name,
      summary: `Deleted role ${role.name}`
    });
    scheduleAuthSync();
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

    if (isProtectedOwnerUser(payload)) {
      payload.roleId = SYSTEM_ROLE_IDS.admin;
      payload.active = true;
    }

    users.push(payload);
    if (!setUsers(users)) {
      return { ok: false, message: "Could not save user because browser storage is full. Please clear old site data and try again." };
    }
    recordAuditEvent({
      action: "create",
      area: "users",
      targetType: "user",
      targetId: payload.id,
      targetName: payload.username,
      summary: `Created user ${payload.username}`,
      details: { roleId: payload.roleId, active: payload.active }
    });
    scheduleAuthSync();
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

    if (!setUsers([payload])) {
      return { ok: false, message: "Could not create first admin because browser storage is full. Please clear old site data and try again." };
    }
    recordAuditEvent({
      actor: { actorUserId: payload.id, actorUsername: payload.username, actorRoleId: payload.roleId },
      action: "bootstrap",
      area: "users",
      targetType: "user",
      targetId: payload.id,
      targetName: payload.username,
      summary: `Created first admin ${payload.username}`
    });
    scheduleAuthSync();
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

    if (!setUsers(payload)) {
      return { ok: false, message: "Could not create starter users because browser storage is full. Please clear old site data and try again." };
    }
    payload.forEach((entry) => {
      recordAuditEvent({
        actor: { actorUserId: entry.id, actorUsername: entry.username, actorRoleId: entry.roleId },
        action: "bootstrap",
        area: "users",
        targetType: "user",
        targetId: entry.id,
        targetName: entry.username,
        summary: `Created starter user ${entry.username}`,
        details: { roleId: entry.roleId }
      });
    });
    scheduleAuthSync();
    return { ok: true, users: payload };
  }

  function updateUser(userId, input) {
    const users = getUsers();
    const user = users.find((u) => u.id === userId);
    if (!user) return { ok: false, message: "User not found." };

    const before = {
      username: user.username,
      roleId: user.roleId,
      active: user.active
    };

    const username = String(input?.username || "").trim();
    if (!username) return { ok: false, message: "Username is required." };

    const duplicate = users.some((u) => u.id !== userId && u.username.toLowerCase() === username.toLowerCase());
    if (duplicate) return { ok: false, message: "Username already exists." };

    const protectedOwner = isProtectedOwnerUser(user);

    user.username = protectedOwner ? user.username : username;
    if (input?.password) user.password = String(input.password);
    user.roleId = protectedOwner ? SYSTEM_ROLE_IDS.admin : String(input?.roleId || user.roleId);
    user.active = protectedOwner ? true : Boolean(input?.active);

    if (!setUsers(users)) {
      return { ok: false, message: "Could not update user because browser storage is full. Please clear old site data and try again." };
    }
    recordAuditEvent({
      action: "update",
      area: "users",
      targetType: "user",
      targetId: user.id,
      targetName: user.username,
      summary: `Updated user ${user.username}`,
      details: {
        before,
        after: {
          username: user.username,
          roleId: user.roleId,
          active: user.active
        }
      }
    });
    scheduleAuthSync();
    return { ok: true, user };
  }

  function deleteUser(userId) {
    const users = getUsers();
    const user = users.find((u) => u.id === userId);
    if (!user) return { ok: false, message: "User not found." };
    if (isProtectedOwnerUser(user)) {
      return { ok: false, message: "Zakaria Omar is the protected owner admin and cannot be deleted." };
    }

    const remainingActiveAdmins = users
      .filter((u) => u.id !== userId && u.active)
      .some((u) => u.roleId === SYSTEM_ROLE_IDS.admin);

    if (user.roleId === SYSTEM_ROLE_IDS.admin && !remainingActiveAdmins) {
      return { ok: false, message: "At least one active admin user is required." };
    }

    if (!setUsers(users.filter((u) => u.id !== userId))) {
      return { ok: false, message: "Could not delete user because browser storage is full. Please clear old site data and try again." };
    }
    recordAuditEvent({
      action: "delete",
      area: "users",
      targetType: "user",
      targetId: user.id,
      targetName: user.username,
      summary: `Deleted user ${user.username}`,
      details: { roleId: user.roleId, active: user.active }
    });

    const session = getSession();
    if (session?.userId === userId) clearSession();
    scheduleAuthSync();
    return { ok: true };
  }

  window.OPXAuth = {
    init,
    login,
    logout,
    triggerLogout,
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
    hydrateAuthFromSupabase,
    syncAuthToSupabase,
    getSharedAuthStatus: () => sharedAuthStatus,
    getSyncDashboardSummary,
    getSyncHistory: readSyncHistory,
    renderTopbarHealthChip,
    getAuditEntries,
    recordAuditEvent,
    isProtectedOwnerUser,
    touchSessionActivity,
    createUser,
    updateUser,
    deleteUser,
    PERMISSIONS,
    STORAGE,
    SYSTEM_ROLE_IDS
  };

  init();
  recoverRolesFromUrl();
  installGlobalLogout();
  installAutofillBlocker();
  installIdleLock();
  installTopbarHealthChip();
  if (getSupabaseClient()) {
    void hydrateAuthFromSupabase();
  } else if (typeof window !== "undefined") {
    window.addEventListener("opx:supabase-ready", () => {
      void hydrateAuthFromSupabase();
    });
  }
})();
