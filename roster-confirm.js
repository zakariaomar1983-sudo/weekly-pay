(function rosterConfirmationPage() {
  const LEGACY_DRIVER_NAME_ALIASES = new Map([
    ["Khalid Aden", "Suhen Omar"]
  ]);
  const ACK_STATUS_LABELS = {
    pending: "Pending",
    sent: "Sent",
    viewed: "Viewed",
    confirmed: "Confirmed"
  };

  const state = {
    driverName: "",
    weekKey: "",
    acknowledgement: null
  };

  function canonicalDriverName(value) {
    const trimmed = String(value || "").trim();
    return LEGACY_DRIVER_NAME_ALIASES.get(trimmed) || trimmed;
  }

  function validWeekKey(value) {
    const trimmed = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
  }

  function formatWeekKey(value) {
    if (!validWeekKey(value)) return "Unknown";
    const [year, month, day] = String(value).split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-AU", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  }

  function setFeedback(message, tone = "muted") {
    const node = document.getElementById("confirmFeedback");
    if (!node) return;
    node.textContent = message;
    node.className = `data-status ${tone}`.trim();
  }

  function renderAcknowledgement(entry) {
    const status = String(entry?.status || "pending").trim().toLowerCase();
    const statusLabel = ACK_STATUS_LABELS[status] || ACK_STATUS_LABELS.pending;
    document.getElementById("confirmStatusText").textContent = statusLabel;
    document.getElementById("confirmWeekText").textContent = formatWeekKey(state.weekKey);
    document.getElementById("confirmTitle").textContent = `${state.driverName || "Driver"} roster confirmation`;
    document.getElementById("confirmMeta").textContent = `This link updates the Onpoint Express CRM roster acknowledgement for the week starting ${formatWeekKey(state.weekKey)}.`;

    const button = document.getElementById("confirmRosterBtn");
    if (!button) return;
    button.disabled = status === "confirmed";
    button.textContent = status === "confirmed" ? "Week Already Confirmed" : "Confirm Week View";
  }

  async function updateAcknowledgement(status, mode, source) {
    const response = await fetch("./api/roster-ack", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        driverName: state.driverName,
        weekKey: state.weekKey,
        status,
        mode,
        source
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (payload?.configured === false) {
      throw new Error("Shared roster confirmations are not configured yet. Please contact dispatch.");
    }
    if (!response.ok) {
      throw new Error(payload?.error || "Unable to update roster confirmation.");
    }
    state.acknowledgement = payload?.item || null;
    renderAcknowledgement(state.acknowledgement);
    return payload?.item || null;
  }

  async function refreshAcknowledgement() {
    const params = new URLSearchParams({
      weekKey: state.weekKey,
      driverName: state.driverName
    });
    const response = await fetch(`./api/roster-ack?${params.toString()}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || "Unable to load roster confirmation.");
    }
    if (payload?.configured === false) {
      state.acknowledgement = {
        driverName: state.driverName,
        weekKey: state.weekKey,
        status: "pending",
        updatedAt: ""
      };
      renderAcknowledgement(state.acknowledgement);
      setFeedback("Shared confirmation storage is not configured yet. Dispatch can still track confirmation manually.", "warning-text");
      return { configured: false };
    }
    const item = Array.isArray(payload?.items) ? payload.items[0] : null;
    state.acknowledgement = item || {
      driverName: state.driverName,
      weekKey: state.weekKey,
      status: "pending",
      updatedAt: ""
    };
    renderAcknowledgement(state.acknowledgement);
    return { configured: true };
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    state.driverName = canonicalDriverName(params.get("driver"));
    state.weekKey = validWeekKey(params.get("week"));

    if (!state.driverName || !state.weekKey) {
      document.getElementById("confirmTitle").textContent = "Invalid roster confirmation link";
      document.getElementById("confirmMeta").textContent = "This confirmation link is missing the driver or week details.";
      document.getElementById("confirmStatusText").textContent = "Unavailable";
      document.getElementById("confirmWeekText").textContent = "Unavailable";
      document.getElementById("confirmRosterBtn").disabled = true;
      setFeedback("Ask dispatch to resend your roster message with a fresh confirmation link.", "error-text");
      return;
    }

    try {
      await updateAcknowledgement("viewed", "atLeast", "phone-link");
      setFeedback("Roster opened. Please tap Confirm Week View once you have received it.", "live-text");
    } catch (error) {
      console.warn("Roster acknowledgement view update failed:", error?.message || error);
      try {
        const refresh = await refreshAcknowledgement();
        if (refresh?.configured === false) return;
        setFeedback("Roster loaded. We could not mark it as viewed automatically, but you can still confirm it below.", "warning-text");
      } catch (refreshError) {
        setFeedback(String(refreshError?.message || refreshError || "Unable to load this roster confirmation link."), "error-text");
      }
    }
  }

  document.getElementById("confirmRosterBtn")?.addEventListener("click", async () => {
    try {
      await updateAcknowledgement("confirmed", "atLeast", "phone-link");
      setFeedback("Thanks. Your weekly roster has been confirmed in Onpoint Express.", "live-text");
    } catch (error) {
      const message = String(error?.message || error || "Unable to confirm this roster right now.");
      setFeedback(message, /not configured/i.test(message) ? "warning-text" : "error-text");
    }
  });

  document.getElementById("refreshConfirmBtn")?.addEventListener("click", async () => {
    try {
      const refresh = await refreshAcknowledgement();
      if (refresh?.configured === false) return;
      setFeedback("Latest confirmation status loaded.", "muted");
    } catch (error) {
      setFeedback(String(error?.message || error || "Unable to refresh the confirmation status."), "error-text");
    }
  });

  void init();
})();
