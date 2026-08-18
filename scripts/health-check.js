const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
let baseUrl = process.env.HEALTHCHECK_URL ? new URL(process.env.HEALTHCHECK_URL) : null;
const requestTimeoutMs = 6000;
const pageScripts = [
  ["index.js", "index.html"],
  ["drivers.js", "drivers.html"],
  ["trucks.js", "trucks.html"],
  ["roster.js", "roster.html"],
  ["finance.js", "finance.html"],
  ["log.js", "log.html"],
  ["receipts.js", "receipts.html"],
  ["reports.js", "reports.html"],
  ["login.js", "login.html"],
  ["roster-confirm.js", "roster-confirm.html"],
  ["control-panel.js", "control-panel.html"]
];
const failures = [];
const ignoredDirectories = new Set([".git", ".cache", "node_modules"]);
const routeChecks = [
  ...pageScripts.map(([, pageName]) => ({ path: `/${pageName}`, expected: [200] })),
  { path: "/api/auth-session", expected: [405] },
  { path: "/api/send-payslip-email", expected: [401] },
  { path: "/api/send-weekly-report-email", expected: [401] },
  { path: "/api/weekly-report-cron?health=1", expected: [200] },
  { path: "/api/whatsapp-receipts-webhook", expected: [401] },
  { path: "/api/roster-ack?health=1", expected: [200] },
  { path: "/api/whatsapp-receipts-media", expected: [200] }
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function filesRecursively(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];
    return entry.isDirectory() ? filesRecursively(target) : [target];
  });
}

for (const file of filesRecursively(root).filter((file) => file.endsWith(".js"))) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) failures.push(`${path.relative(root, file)} has invalid JavaScript syntax.\n${result.stderr.trim()}`);
}

for (const [scriptName, pageName] of pageScripts) {
  const script = read(scriptName);
  const page = read(pageName);
  const pageIds = new Set([...page.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const referencedIds = new Set(
    [...script.matchAll(/(?:getElementById|byId)\(\s*"([^"]+)"/g)].map((match) => match[1])
  );
  const missing = [...referencedIds].filter((id) => !pageIds.has(id));
  if (missing.length) failures.push(`${scriptName} references missing ${pageName} elements: ${missing.join(", ")}`);
}

for (const pageName of fs.readdirSync(root).filter((file) => file.endsWith(".html"))) {
  const page = read(pageName);
  for (const match of page.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const reference = match[1];
    if (!reference.startsWith("./")) continue;
    const target = reference.slice(2).split(/[?#]/)[0];
    if (!target || target.startsWith("api/")) continue;
    if (!fs.existsSync(path.resolve(root, path.dirname(pageName), target))) {
      failures.push(`${pageName} references missing local file: ${target}`);
    }
  }
}

if (/^\s*const supabase\b/m.test(read("roster.js"))) {
  failures.push("roster.js redeclares the global Supabase binding.");
}

if (/ensureReferencedTrucks|Auto-added from roster\/finance records/.test(read("trucks.js"))) {
  failures.push("trucks.js still recreates deleted vehicles from historical records.");
}

for (const required of ["api/_auth-server.js", "api/auth-session.js"]) {
  if (!fs.existsSync(path.join(root, required))) failures.push(`${required} is missing.`);
}

function request(urlPath) {
  const target = new URL(urlPath, baseUrl);
  const client = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(target, { method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode || 0,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.setTimeout(requestTimeoutMs, () => req.destroy(new Error("Request timed out.")));
    req.on("error", reject);
    req.end();
  });
}

async function ensureServer() {
  if (baseUrl) {
    return { server: null, started: false };
  }

  const { createLocalServer } = require(path.join(root, "local-server.js"));
  const server = createLocalServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  baseUrl = new URL(`http://127.0.0.1:${address.port}`);
  return { server, started: true };
}

async function main() {
  if (failures.length) {
    throw new Error(failures.join("\n"));
  }

  const { server, started } = await ensureServer();
  try {
    for (const check of routeChecks) {
      const result = await request(check.path);
      if (!check.expected.includes(result.status)) {
        const detail = result.body.trim().slice(0, 180).replace(/\s+/g, " ");
        failures.push(`${check.path} returned ${result.status}, expected ${check.expected.join("/")}. ${detail}`);
      }
    }
  } finally {
    if (server && started) await new Promise((resolve) => server.close(resolve));
  }

  if (failures.length) throw new Error(failures.join("\n"));
  console.log(`Health check passed: ${pageScripts.length} pages, all JavaScript files, and ${routeChecks.length} routes are wired correctly.`);
}

main().catch((error) => {
  console.error(`Health check failed:\n${error?.message || error}`);
  process.exit(1);
});
