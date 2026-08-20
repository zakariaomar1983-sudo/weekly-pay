const crypto = require("crypto");
const { getSupabaseServerClient } = require("./_supabase-server");

const STAFF_TOKEN_TTL_SECONDS = 6 * 60;
const ROSTER_CONFIRM_TOKEN_TTL_SECONDS = 21 * 24 * 60 * 60;

function getSigningSecret(env = process.env) {
  return String(
    env.OPX_SESSION_SECRET
      || env.SUPABASE_JWT_SECRET
      || env.SUPABASE_SERVICE_ROLE_KEY
      || ""
  ).trim();
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decode(value) {
  return JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signPayload(payload, ttlSeconds, env = process.env) {
  const secret = getSigningSecret(env);
  if (!secret) throw new Error("Server session signing is not configured.");
  const now = Math.floor(Date.now() / 1000);
  const body = encode({
    ...payload,
    iat: now,
    exp: now + Math.max(60, Number(ttlSeconds) || STAFF_TOKEN_TTL_SECONDS)
  });
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifySignedToken(token, expectedType, env = process.env) {
  const secret = getSigningSecret(env);
  if (!secret) return null;
  const [body, signature, extra] = String(token || "").split(".");
  if (!body || !signature || extra) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = decode(body);
    const now = Math.floor(Date.now() / 1000);
    if (!payload || payload.type !== expectedType || !payload.exp || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

function normalizePermissions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, enabled]) => [String(key), Boolean(enabled)]));
}

function normalizeStaffRolePermissions(roleId, value) {
  const permissions = normalizePermissions(value);
  const legacyCrmStaffRoles = new Set([
    "role_manager",
    "role_viewer",
    "role_team_basic",
    "role_dispatcher",
    "role_finance",
    "role_fleet_manager",
    "role_payroll",
    "role_compliance",
    "role_data_entry"
  ]);

  // Older shared roles were created before CRM AI existed. Keep drivers out,
  // but migrate known non-driver CRM staff when they sign in.
  if (legacyCrmStaffRoles.has(String(roleId || ""))) permissions.accessAI = true;
  return permissions;
}

async function authenticateCredentials(username, password) {
  const client = getSupabaseServerClient();
  if (!client || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Secure shared authentication is not configured.");
  }

  const normalizedUsername = String(username || "").trim().toLowerCase();
  const suppliedPassword = String(password || "");
  if (!normalizedUsername || !suppliedPassword) return null;

  const { data: users, error: usersError } = await client
    .from("auth_users")
    .select("id,username,password,role_id,active")
    .eq("active", true);
  if (usersError) throw usersError;

  const user = (Array.isArray(users) ? users : []).find(
    (item) => String(item?.username || "").trim().toLowerCase() === normalizedUsername
  );
  if (!user || !safeEqual(suppliedPassword, user.password)) return null;

  const { data: roles, error: rolesError } = await client
    .from("auth_roles")
    .select("id,name,permissions")
    .eq("id", user.role_id)
    .limit(1);
  if (rolesError) throw rolesError;
  const role = Array.isArray(roles) && roles.length ? roles[0] : null;

  return {
    id: String(user.id || ""),
    username: String(user.username || ""),
    roleId: String(user.role_id || ""),
    permissions: normalizeStaffRolePermissions(user.role_id, role?.permissions)
  };
}

function issueStaffToken(user, env = process.env) {
  return signPayload({
    type: "staff",
    sub: String(user?.id || user?.sub || ""),
    username: String(user?.username || ""),
    roleId: String(user?.roleId || ""),
    permissions: normalizeStaffRolePermissions(user?.roleId, user?.permissions)
  }, STAFF_TOKEN_TTL_SECONDS, env);
}

function getBearerToken(req) {
  const header = String(req?.headers?.authorization || "").trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function requireStaff(req, res, permissions = []) {
  const session = verifySignedToken(getBearerToken(req), "staff");
  if (!session) {
    res.status(401).json({ error: "A current staff session is required." });
    return null;
  }

  const required = Array.isArray(permissions) ? permissions.filter(Boolean) : [permissions].filter(Boolean);
  if (required.length && !required.some((permission) => session.permissions?.[permission] === true)) {
    res.status(403).json({ error: "This staff account does not have permission for that action." });
    return null;
  }
  return session;
}

function issueRosterConfirmationToken(driverName, weekKey, env = process.env) {
  return signPayload({
    type: "roster-confirm",
    driverName: String(driverName || "").trim(),
    weekKey: String(weekKey || "").trim()
  }, ROSTER_CONFIRM_TOKEN_TTL_SECONDS, env);
}

function verifyRosterConfirmationToken(token, driverName, weekKey, env = process.env) {
  const payload = verifySignedToken(token, "roster-confirm", env);
  if (!payload) return null;
  if (!safeEqual(String(payload.driverName || "").trim().toLowerCase(), String(driverName || "").trim().toLowerCase())) return null;
  if (!safeEqual(String(payload.weekKey || "").trim(), String(weekKey || "").trim())) return null;
  return payload;
}

module.exports = {
  authenticateCredentials,
  getBearerToken,
  issueRosterConfirmationToken,
  issueStaffToken,
  requireStaff,
  verifyRosterConfirmationToken,
  verifySignedToken
};
