async function loadDriversModule() {
  const candidates = [
    "./drivers.js?module=20260507b",
    "./drivers.js"
  ];

  let lastError = null;
  for (const candidate of candidates) {
    try {
      await import(candidate);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Drivers module failed to load.");
}

function showDriversBootError(error) {
  const status = document.getElementById("driversDataStatus");
  const body = document.getElementById("driversTableBody");
  const detail = error?.message ? String(error.message) : "Unknown module error";
  const message = `Driver Data could not start. ${detail}`;

  if (status) {
    status.textContent = message;
    status.className = "data-status error-text full";
  }
  if (body && !body.innerHTML.trim()) {
    body.innerHTML = `<tr><td colspan="6" class="error-text">${message}</td></tr>`;
  }
  console.error("Drivers bootstrap failed:", error);
}

void loadDriversModule().catch(showDriversBootError);
