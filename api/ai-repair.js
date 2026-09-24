const { requireStaff } = require("./_auth-server");
const { getSupabaseServiceClient } = require("./_supabase-server");

const RETIRED_TRUCK = "853";
const INACTIVE_DRIVER = "suhen omar";
const actions = new Set(["retire-853", "deactivate-suhen"]);

function todayInMelbourne() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function loadRows(client, table, columns, filter) {
  const rows = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    let query = client.from(table).select(columns).order("id").range(offset, offset + 499);
    if (filter) query = filter(query);
    const { data, error } = await query;
    if (error) throw new Error(`Could not check ${table}: ${error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < 500) return rows;
  }
  throw new Error(`Too many ${table} records to check safely. No repair was applied.`);
}

async function diagnose(client) {
  const today = todayInMelbourne();
  const [trucks, drivers, shifts] = await Promise.all([
    loadRows(client, "trucks", "id,truck_number,status"),
    loadRows(client, "drivers", "id,name,status"),
    loadRows(client, "roster", "id,driver_name,truck_number,shift_date,status", (query) => query.gte("shift_date", today))
  ]);
  const issues = [];
  const add = (code, severity, message, action = "") => issues.push({ code, severity, message, action });

  if (trucks.some((truck) => String(truck.truck_number || "").trim() === RETIRED_TRUCK && String(truck.status || "").toLowerCase() !== "retired")) {
    add("retired-truck-active", "warning", "Truck 853 is still active in the shared fleet record.", "retire-853");
  }
  if (drivers.some((driver) => String(driver.name || "").trim().toLowerCase() === INACTIVE_DRIVER && String(driver.status || "").toLowerCase() !== "inactive")) {
    add("former-driver-active", "warning", "Suhen Omar is still active in shared Drivers data.", "deactivate-suhen");
  }

  const retired = new Set(trucks.filter((truck) => String(truck.status || "").toLowerCase() === "retired").map((truck) => String(truck.truck_number || "").trim()));
  retired.add(RETIRED_TRUCK);
  const inactive = new Set(drivers.filter((driver) => String(driver.status || "").toLowerCase() === "inactive").map((driver) => String(driver.name || "").trim().toLowerCase()));
  inactive.add(INACTIVE_DRIVER);
  const assigned = new Map();
  for (const shift of shifts) {
    const date = String(shift.shift_date || "").slice(0, 10);
    const name = String(shift.driver_name || "").trim();
    const truck = String(shift.truck_number || "").trim();
    const status = String(shift.status || "").trim().toLowerCase();
    if (!date || !name) continue;
    if (status === "completed" && date > today) add("future-completed", "review", `${name} has a Completed shift dated ${date}. Check whether it was marked early.`);
    if (status === "leave" || status === "off" || status === "away") continue;
    if (inactive.has(name.toLowerCase())) add("inactive-driver-shift", "review", `${name} has a shift on ${date}. Review who will cover it.`);
    if (!truck) continue;
    if (retired.has(truck)) add("retired-truck-shift", "review", `Truck ${truck} is assigned to ${name} on ${date}. Review the assignment.`);
    const key = `${date}:${truck}`;
    const previous = assigned.get(key);
    if (previous && previous !== name) add("truck-conflict", "review", `Truck ${truck} is assigned to both ${previous} and ${name} on ${date}.`);
    else assigned.set(key, name);
  }
  return { checkedAt: new Date().toISOString(), today, checked: { trucks: trucks.length, drivers: drivers.length, upcomingShifts: shifts.length }, issues: issues.slice(0, 100), truncated: issues.length > 100 };
}

async function applyRepair(client, action) {
  if (action === "retire-853") {
    const rows = await loadRows(client, "trucks", "id,truck_number,status", (query) => query.eq("truck_number", RETIRED_TRUCK));
    const active = rows.filter((row) => String(row.status || "").toLowerCase() !== "retired");
    for (const row of active) {
      const { data, error } = await client.from("trucks").update({ status: "Retired" }).eq("id", row.id).select("id,status");
      if (error || !data?.some((item) => item.id === row.id && item.status === "Retired")) throw new Error(error?.message || "Truck status was not updated.");
    }
    return `Marked ${active.length} truck 853 record(s) Retired. Saved roster shifts were kept.`;
  }
  const rows = await loadRows(client, "drivers", "id,name,status", (query) => query.ilike("name", "Suhen Omar"));
  const active = rows.filter((row) => String(row.name || "").trim().toLowerCase() === INACTIVE_DRIVER && String(row.status || "").toLowerCase() !== "inactive");
  for (const row of active) {
    const { data, error } = await client.from("drivers").update({ status: "Inactive" }).eq("id", row.id).select("id,status");
    if (error || !data?.some((item) => item.id === row.id && item.status === "Inactive")) throw new Error(error?.message || "Driver status was not updated.");
  }
  return `Marked ${active.length} Suhen Omar record(s) Inactive. Saved roster shifts were kept.`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const staff = requireStaff(req, res, "accessControlPanel");
  if (!staff) return;
  const client = getSupabaseServiceClient();
  if (!client) return res.status(503).json({ error: "Shared database repair requires the server service key." });
  try {
    let repaired = "";
    if (req.method === "POST") {
      const action = typeof req.body === "object" ? String(req.body?.action || "") : "";
      if (!actions.has(action)) return res.status(400).json({ error: "Unsupported repair action." });
      const permission = action === "retire-853" ? "editTrucks" : "editDrivers";
      if (staff.permissions?.[permission] !== true) return res.status(403).json({ error: "This staff account cannot edit those records." });
      repaired = await applyRepair(client, action);
    }
    return res.status(200).json({ ...await diagnose(client), repaired });
  } catch (error) {
    console.error("AI system check failed:", error);
    return res.status(500).json({ error: String(error?.message || "System check failed.") });
  }
};
