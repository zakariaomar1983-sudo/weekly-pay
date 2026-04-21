const { getSupabaseServerClient, getSupabaseServerConfig } = require("./_supabase-server");
const { getWeeklyReportEmailConfig, normalizeRecipientList, sendWeeklyReportEmail } = require("./_weekly-report-email");
const {
  buildReportAttachmentHtml,
  buildSnapshot,
  collectDriverReportRows,
  collectFinanceReportRows,
  collectTruckReportRows,
  formatDateTime,
  getSydneyScheduleState,
  normalizeSupabaseData
} = require("./_weekly-report-utils");

const APP_LOGS_TABLE = "app_logs";
const REPORT_REFERENCE_PREFIX = "weekly-report:";
const SERVER_RECIPIENT_ENV_KEYS = ["REPORTS_AUTO_EMAIL_TO", "REPORTS_RECIPIENTS"];
const TABLES = {
  income: "truck_income",
  expense: "truck_expense",
  pay: "payslips",
  roster: "roster",
  drivers: "drivers",
  trucks: "trucks"
};

module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const requestState = getRequestState(req);
  const client = getSupabaseServerClient();
  const status = await buildServerStatus(client);

  const wantsExecution = req.method === "POST"
    || req.query?.run === "1"
    || requestState.isCronLike;

  if (!wantsExecution) {
    return res.status(200).json(status);
  }

  if (!requestState.authorized) {
    return res.status(401).json({
      error: "Unauthorized cron request.",
      configured: status.configured
    });
  }

  if (!status.configured) {
    return res.status(500).json({
      error: "Server-side weekly report delivery is not configured yet.",
      ...status
    });
  }

  const forceRun = req.method === "POST" || req.query?.run === "1";
  if (!forceRun && !status.schedule.shouldSendNow) {
    return res.status(200).json({
      ok: true,
      skipped: true,
      reason: "Outside Thursday 8:00 AM Sydney delivery window.",
      ...status
    });
  }

  if (status.lastSent?.reference === `${REPORT_REFERENCE_PREFIX}${status.schedule.financeWeekKey}`) {
    return res.status(200).json({
      ok: true,
      skipped: true,
      reason: "Weekly report already sent for this finance week.",
      ...status
    });
  }

  try {
    const reportData = await loadReportData(client);
    const snapshot = buildSnapshot(
      reportData,
      status.schedule.financeWeekKey,
      status.schedule.rosterWeekKey,
      "server",
      new Date()
    );
    const financeRows = collectFinanceReportRows(reportData, snapshot.financeWeekKey);
    const driverRows = collectDriverReportRows(reportData, snapshot.rosterWeekKey);
    const truckRows = collectTruckReportRows(reportData, snapshot.financeWeekKey);
    const attachmentHtml = buildReportAttachmentHtml(snapshot, financeRows, driverRows, truckRows);

    const sendResult = await sendWeeklyReportEmail({
      to: status.recipients,
      subject: `OnPoint Express Weekly Report - ${snapshot.financeWeekLabel}`,
      text: `Server-side weekly report prepared ${formatDateTime(snapshot.preparedAt)}. Finance week: ${snapshot.financeWeekLabel}. Profit: ${snapshot.profit.toFixed(2)}. Completed shifts: ${snapshot.completedShifts}.`,
      attachmentHtml,
      attachmentFilename: `weekly-report-${snapshot.financeWeekKey}.html`
    });

    await insertReportLog(client, {
      status: "Sent",
      reference: `${REPORT_REFERENCE_PREFIX}${snapshot.financeWeekKey}`,
      description: `Server cron emailed weekly report to ${status.recipients.length} recipient(s) for finance week ${snapshot.financeWeekLabel}. Email ID: ${sendResult.id || "n/a"}.`,
      logDate: snapshot.financeWeekKey
    });

    return res.status(200).json({
      ok: true,
      sent: true,
      reportId: sendResult.id || null,
      financeWeekKey: snapshot.financeWeekKey,
      rosterWeekKey: snapshot.rosterWeekKey,
      recipientsCount: status.recipients.length,
      lastSentAt: snapshot.preparedAt
    });
  } catch (error) {
    await insertReportLog(client, {
      status: "Error",
      reference: `${REPORT_REFERENCE_PREFIX}${status.schedule.financeWeekKey}`,
      description: `Server cron failed to email weekly report: ${String(error?.message || error || "Unknown error")}`,
      logDate: status.schedule.financeWeekKey
    });
    return res.status(500).json({
      error: String(error?.message || error || "Could not run the server-side weekly report."),
      ...status
    });
  }
};

function getRequestState(req) {
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  const authHeader = String(req.headers.authorization || "");
  const userAgent = String(req.headers["user-agent"] || "").toLowerCase();
  const hasBearerSecret = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isCronUserAgent = userAgent.includes("vercel-cron");

  return {
    protected: Boolean(cronSecret),
    authorized: cronSecret ? hasBearerSecret : isCronUserAgent,
    isCronLike: isCronUserAgent || hasBearerSecret
  };
}

async function buildServerStatus(client) {
  const supabaseConfig = getSupabaseServerConfig();
  const emailConfig = getWeeklyReportEmailConfig();
  const recipients = getServerRecipients();
  const schedule = getSydneyScheduleState(new Date());
  const lastSent = await readLastSentReportLog(client);

  return {
    configured: Boolean(supabaseConfig.configured && emailConfig.configured && recipients.length),
    supabaseConfigured: supabaseConfig.configured,
    emailConfigured: emailConfig.configured,
    recipientsConfigured: Boolean(recipients.length),
    recipients,
    recipientsCount: recipients.length,
    serverDeliveryActive: Boolean(supabaseConfig.configured && emailConfig.configured && recipients.length),
    cronSchedule: "Hourly check, sends once on Thursday after 8:00 AM Australia/Sydney.",
    schedule,
    lastSent
  };
}

function getServerRecipients() {
  const raw = SERVER_RECIPIENT_ENV_KEYS
    .map((key) => process.env[key])
    .find((value) => String(value || "").trim());
  return normalizeRecipientList(raw || "");
}

async function readLastSentReportLog(client) {
  if (!client) return null;
  try {
    const { data, error } = await client
      .from(APP_LOGS_TABLE)
      .select("reference,status,description,created_at,log_date")
      .eq("log_type", "Reports")
      .like("reference", `${REPORT_REFERENCE_PREFIX}%`)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return null;
    return {
      reference: row.reference || "",
      status: row.status || "",
      description: row.description || "",
      createdAt: row.created_at || "",
      logDate: row.log_date || ""
    };
  } catch {
    return null;
  }
}

async function loadReportData(client) {
  if (!client) {
    throw new Error("Supabase is not configured for server-side reports.");
  }

  const [incomeResult, expenseResult, payResult, rosterResult, driversResult, trucksResult] = await Promise.all([
    client.from(TABLES.income).select("*"),
    client.from(TABLES.expense).select("*"),
    client.from(TABLES.pay).select("*"),
    client.from(TABLES.roster).select("*"),
    client.from(TABLES.drivers).select("*"),
    client.from(TABLES.trucks).select("*")
  ]);

  const failures = [incomeResult, expenseResult, payResult, rosterResult, driversResult, trucksResult]
    .map((result) => result.error)
    .filter(Boolean);
  if (failures.length) {
    throw new Error(failures[0].message || "Could not read shared CRM data from Supabase.");
  }

  return normalizeSupabaseData({
    income: incomeResult.data || [],
    expense: expenseResult.data || [],
    pay: payResult.data || [],
    roster: rosterResult.data || [],
    drivers: driversResult.data || [],
    trucks: trucksResult.data || []
  });
}

async function insertReportLog(client, { status, reference, description, logDate }) {
  if (!client) return;
  try {
    await client.from(APP_LOGS_TABLE).insert({
      log_date: logDate || null,
      log_type: "Reports",
      driver: "",
      truck_number: "",
      reference: reference || "",
      status: status || "Open",
      description: description || ""
    });
  } catch {
    // best-effort audit trail
  }
}
