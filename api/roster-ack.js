const { getSupabaseServerClient, getSupabaseServerConfig } = require("./_supabase-server");

const ACK_LOG_TYPE = "Roster Ack";
const STATUS_ORDER = ["pending", "sent", "viewed", "confirmed"];
const LEGACY_DRIVER_NAME_ALIASES = new Map([
  ["Khalid Aden", "Suhen Omar"]
]);

function canonicalDriverName(value) {
  const trimmed = String(value || "").trim();
  return LEGACY_DRIVER_NAME_ALIASES.get(trimmed) || trimmed;
}

function normalizeWeekKey(value) {
  const trimmed = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

function normalizeStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return STATUS_ORDER.includes(status) ? status : "";
}

function statusOrder(value) {
  const index = STATUS_ORDER.indexOf(normalizeStatus(value));
  return index === -1 ? 0 : index;
}

function acknowledgementReference(driverName, weekKey) {
  return `roster-ack:${weekKey}:${canonicalDriverName(driverName)}`;
}

function parseBody(req) {
  if (!req?.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function descriptionFor(driverName, weekKey, status, source, mode) {
  const via = String(source || "crm").trim() || "crm";
  const applyMode = mode === "atLeast" ? "atLeast" : "set";
  return `Weekly roster acknowledgement for ${driverName} (${weekKey}) via ${via}. Mode ${applyMode}. Status ${status}.`;
}

function normalizeOutput(row) {
  if (!row) return null;
  return {
    id: row.id,
    driverName: canonicalDriverName(row.driver || ""),
    weekKey: normalizeWeekKey(row.log_date),
    status: normalizeStatus(row.status) || "pending",
    updatedAt: row.updated_at || row.created_at || "",
    source: String(row.description || "").trim()
  };
}

async function latestAcknowledgementRow(client, reference) {
  const { data, error } = await client
    .from("app_logs")
    .select("id, log_date, driver, status, reference, description, updated_at, created_at")
    .eq("log_type", ACK_LOG_TYPE)
    .eq("reference", reference)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}

module.exports = async function handler(req, res) {
  const config = getSupabaseServerConfig(process.env);
  const client = getSupabaseServerClient(process.env);

  if (req.method === "GET") {
    if (req.query?.health === "1") {
      return res.status(200).json({
        ok: true,
        health: true,
        configured: Boolean(config.configured && client)
      });
    }

    if (!config.configured || !client) {
      return res.status(200).json({
        configured: false,
        items: []
      });
    }

    const weekKey = normalizeWeekKey(req.query?.weekKey);
    const driverName = canonicalDriverName(req.query?.driverName || "");
    try {
      let query = client
        .from("app_logs")
        .select("id, log_date, driver, status, reference, description, updated_at, created_at")
        .eq("log_type", ACK_LOG_TYPE)
        .order("updated_at", { ascending: false });
      if (weekKey) query = query.eq("log_date", weekKey);
      if (driverName) query = query.eq("driver", driverName);

      const { data, error } = await query;
      if (error) throw error;

      const latestByReference = new Map();
      (Array.isArray(data) ? data : []).forEach((row) => {
        if (!row?.reference || latestByReference.has(row.reference)) return;
        latestByReference.set(row.reference, row);
      });

      return res.status(200).json({
        configured: true,
        items: Array.from(latestByReference.values()).map(normalizeOutput).filter(Boolean)
      });
    } catch (error) {
      return res.status(200).json({
        configured: false,
        items: [],
        error: String(error?.message || error || "Unable to load roster acknowledgements.")
      });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!config.configured || !client) {
    return res.status(500).json({ error: "Shared roster acknowledgement storage is not configured." });
  }

  const body = parseBody(req);
  const driverName = canonicalDriverName(body.driverName);
  const weekKey = normalizeWeekKey(body.weekKey);
  const status = normalizeStatus(body.status);
  const mode = String(body.mode || "set").trim() === "atLeast" ? "atLeast" : "set";
  const source = String(body.source || "crm").trim() || "crm";

  if (!driverName || !weekKey || !status) {
    return res.status(400).json({ error: "Missing driver name, week key, or acknowledgement status." });
  }

  const reference = acknowledgementReference(driverName, weekKey);

  try {
    const existing = await latestAcknowledgementRow(client, reference);
    const existingStatus = normalizeStatus(existing?.status) || "pending";
    const nextStatus = mode === "atLeast" && statusOrder(existingStatus) > statusOrder(status)
      ? existingStatus
      : status;
    const payload = {
      log_date: weekKey,
      log_type: ACK_LOG_TYPE,
      driver: driverName,
      truck_number: "",
      reference,
      status: nextStatus,
      description: descriptionFor(driverName, weekKey, nextStatus, source, mode),
      updated_at: new Date().toISOString()
    };

    let result;
    if (existing?.id) {
      const { data, error } = await client
        .from("app_logs")
        .update(payload)
        .eq("id", existing.id)
        .select("id, log_date, driver, status, reference, description, updated_at, created_at")
        .limit(1);
      if (error) throw error;
      result = Array.isArray(data) && data.length ? data[0] : null;
    } else {
      const { data, error } = await client
        .from("app_logs")
        .insert(payload)
        .select("id, log_date, driver, status, reference, description, updated_at, created_at")
        .limit(1);
      if (error) throw error;
      result = Array.isArray(data) && data.length ? data[0] : null;
    }

    return res.status(200).json({
      ok: true,
      item: normalizeOutput(result || {
        ...payload,
        id: existing?.id || "",
        created_at: payload.updated_at
      })
    });
  } catch (error) {
    return res.status(500).json({
      error: String(error?.message || error || "Unable to save roster acknowledgement.")
    });
  }
};
