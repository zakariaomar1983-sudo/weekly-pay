const { requireStaff } = require("./_auth-server");
const { getSupabaseServiceClient } = require("./_supabase-server");

const TABLE = "driver_reports";
const REPORT_FIELDS = "id,driver_user_id,driver_name,report_date,truck_number,shift_start,shift_finish,job_client,delivery_count,fuel_used,vehicle_condition,issues,notes,status,submitted_at,updated_at";

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body !== "string") return {};
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function isReviewer(session) {
  return session?.permissions?.accessCRM === true || session?.permissions?.accessControlPanel === true;
}

function melbourneDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function nonNegativeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function cleanReport(input, session, existing = null) {
  const reviewer = isReviewer(session);
  const ownerId = reviewer
    ? String(input?.driver_user_id || existing?.driver_user_id || session.sub || "").trim()
    : String(existing?.driver_user_id || session.sub || "").trim();
  const reportDate = String(input?.report_date || existing?.report_date || "").trim();
  const status = input?.status === "Submitted" ? "Submitted" : "Draft";
  if (!ownerId) throw new Error("A report owner is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw new Error("A valid report date is required.");
  if (!reviewer && reportDate !== melbourneDateKey()) throw new Error("Drivers can only create or update today's report.");
  if (existing && !reviewer && existing.status === "Submitted") throw new Error("Submitted reports are locked. Ask the office to make a correction.");

  const truckNumber = String(input?.truck_number || "").trim().slice(0, 40);
  if (!truckNumber) throw new Error("Truck number is required.");
  const now = new Date().toISOString();
  return {
    id: String(input?.id || existing?.id || "").trim(),
    driver_user_id: ownerId,
    driver_name: String(input?.driver_name || existing?.driver_name || session.username || "").trim().slice(0, 120),
    report_date: reportDate,
    truck_number: truckNumber,
    shift_start: input?.shift_start || null,
    shift_finish: input?.shift_finish || null,
    job_client: String(input?.job_client || "").trim().slice(0, 200),
    delivery_count: nonNegativeNumber(input?.delivery_count),
    fuel_used: nonNegativeNumber(input?.fuel_used),
    vehicle_condition: String(input?.vehicle_condition || "Good").trim().slice(0, 80),
    issues: String(input?.issues || "").trim().slice(0, 5000),
    notes: String(input?.notes || "").trim().slice(0, 5000),
    status,
    submitted_at: status === "Submitted" ? (existing?.submitted_at || now) : (existing?.submitted_at || null),
    updated_at: now
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const session = requireStaff(req, res, "accessDriverReports");
  if (!session) return;
  const client = getSupabaseServiceClient();
  if (!client) return res.status(503).json({ error: "Secure report storage is not configured." });

  try {
    if (req.method === "GET") {
      let query = client.from(TABLE).select(REPORT_FIELDS).order("report_date", { ascending: false });
      if (!isReviewer(session)) query = query.eq("driver_user_id", session.sub);
      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({ reports: data || [] });
    }

    const body = parseBody(req);
    if (req.method === "DELETE") {
      const id = String(body.id || "").trim();
      if (!id) return res.status(400).json({ error: "Report ID is required." });
      const { data: rows, error: lookupError } = await client.from(TABLE).select(REPORT_FIELDS).eq("id", id).limit(1);
      if (lookupError) throw lookupError;
      const existing = rows?.[0];
      if (!existing) return res.status(404).json({ error: "Report not found." });
      if (!isReviewer(session) && (existing.driver_user_id !== session.sub || existing.status === "Submitted")) {
        return res.status(403).json({ error: "You cannot delete this report." });
      }
      const { error } = await client.from(TABLE).delete().eq("id", id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    const input = body.report && typeof body.report === "object" ? body.report : {};
    const id = String(input.id || "").trim();
    let existing = null;
    if (id) {
      const { data: rows, error } = await client.from(TABLE).select(REPORT_FIELDS).eq("id", id).limit(1);
      if (error) throw error;
      existing = rows?.[0] || null;
      if (existing && !isReviewer(session) && existing.driver_user_id !== session.sub) {
        return res.status(403).json({ error: "You cannot update another driver's report." });
      }
    }

    const report = cleanReport(input, session, existing);
    if (!report.id) return res.status(400).json({ error: "Report ID is required." });
    const duplicateQuery = client
      .from(TABLE)
      .select("id")
      .eq("driver_user_id", report.driver_user_id)
      .eq("report_date", report.report_date)
      .neq("id", report.id)
      .limit(1);
    const { data: duplicates, error: duplicateError } = await duplicateQuery;
    if (duplicateError) throw duplicateError;
    if (duplicates?.length) return res.status(409).json({ error: "A report already exists for this driver and date." });

    const { data, error } = await client.from(TABLE).upsert(report, { onConflict: "id" }).select(REPORT_FIELDS).single();
    if (error) throw error;
    return res.status(200).json({ report: data });
  } catch (error) {
    return res.status(500).json({ error: String(error?.message || error || "Unable to process driver report.") });
  }
};
