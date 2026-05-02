const http = require("http");
const https = require("https");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const baseUrl = new URL(process.env.HEALTHCHECK_URL || "http://localhost:4173");
const requestTimeoutMs = 6000;
const startupTimeoutMs = 15000;

const checks = [
  { path: "/index.html", expected: [200] },
  { path: "/login.html", expected: [200] },
  { path: "/drivers.html", expected: [200] },
  { path: "/trucks.html", expected: [200] },
  { path: "/roster.html", expected: [200] },
  { path: "/roster-confirm.html", expected: [200] },
  { path: "/finance.html", expected: [200] },
  { path: "/receipts.html", expected: [200] },
  { path: "/reports.html", expected: [200] },
  { path: "/log.html", expected: [200] },
  { path: "/control-panel.html", expected: [200] },
  { path: "/api/send-payslip-email", expected: [200] },
  { path: "/api/send-weekly-report-email", expected: [200] },
  { path: "/api/weekly-report-cron?health=1", expected: [200] },
  { path: "/api/whatsapp-receipts-webhook", expected: [200] },
  { path: "/api/roster-ack?health=1", expected: [200] },
  { path: "/api/whatsapp-receipts-media", expected: [200] }
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function request(urlPath) {
  const target = new URL(urlPath, baseUrl);
  const client = target.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(target, { method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode || 0,
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
    });

    req.setTimeout(requestTimeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${requestTimeoutMs}ms`));
    });

    req.on("error", reject);
    req.end();
  });
}

async function isServerReady() {
  try {
    const result = await request("/index.html");
    return result.status === 200;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await isServerReady()) {
    return { server: null, started: false };
  }

  const { startLocalServer } = require(path.join(projectRoot, "local-server.js"));
  const server = startLocalServer({ silent: true });
  let startupError = null;
  const onError = (error) => {
    startupError = error;
  };
  server.on("error", onError);

  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    if (startupError) {
      throw new Error(`Could not start local server: ${startupError.message || startupError}`);
    }
    if (await isServerReady()) {
      server.off("error", onError);
      return { server, started: true };
    }
    await sleep(250);
  }

  server.off("error", onError);
  await new Promise((resolve) => server.close(() => resolve()));
  throw new Error(`Timed out waiting for local server startup (${startupTimeoutMs}ms).`);
}

function printResult(pathValue, ok, status, expected, detail = "") {
  const tag = ok ? "OK" : "FAIL";
  const expectedText = Array.isArray(expected) ? expected.join("/") : String(expected);
  const suffix = detail ? ` | ${detail}` : "";
  console.log(`[${tag}] ${pathValue} -> ${status} (expected ${expectedText})${suffix}`);
}

async function runChecks() {
  const failures = [];

  for (const check of checks) {
    try {
      const result = await request(check.path);
      const ok = check.expected.includes(result.status);
      if (!ok) {
        const detail = String(result.body || "").trim().slice(0, 180).replace(/\s+/g, " ");
        failures.push({ ...check, status: result.status, detail });
        printResult(check.path, false, result.status, check.expected, detail);
        continue;
      }
      printResult(check.path, true, result.status, check.expected);
    } catch (error) {
      const detail = String(error?.message || error || "Request failed");
      failures.push({ ...check, status: "ERR", detail });
      printResult(check.path, false, "ERR", check.expected, detail);
    }
  }

  return failures;
}

async function main() {
  let server = null;
  let started = false;

  try {
    const state = await ensureServer();
    server = state.server;
    started = state.started;

    console.log(`Health check base URL: ${baseUrl.href}`);
    console.log(started ? "Started local server for checks." : "Using existing local server.");

    const failures = await runChecks();
    if (failures.length) {
      console.error(`Health check failed: ${failures.length} route(s) did not pass.`);
      process.exitCode = 1;
      return;
    }

    console.log("Health check passed: all routes are healthy.");
  } finally {
    if (server && started) {
      await new Promise((resolve) => {
        server.close(() => resolve());
      });
    }
  }
}

main().catch((error) => {
  console.error(`Health check error: ${error?.message || error}`);
  process.exit(1);
});
