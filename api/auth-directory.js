const { hashPassword, requireStaff } = require("./_auth-server");
const { getSupabaseServerClient } = require("./_supabase-server");

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(String(req.body || "{}")); } catch { return {}; }
}

function publicUser(row) {
  return {
    id: String(row.id || ""),
    username: String(row.username || ""),
    role_id: String(row.role_id || ""),
    active: row.active !== false,
    password_configured: Boolean(row.password)
  };
}

async function loadDirectory(client) {
  const [{ data: roles, error: rolesError }, { data: users, error: usersError }] = await Promise.all([
    client.from("auth_roles").select("id,name,system,permissions").order("name"),
    client.from("auth_users").select("id,username,role_id,active,password").order("username")
  ]);
  if (rolesError) throw rolesError;
  if (usersError) throw usersError;
  return { roles: roles || [], users: (users || []).map(publicUser) };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const staff = requireStaff(req, res, "accessControlPanel");
  if (!staff) return;
  const client = getSupabaseServerClient();
  if (!client || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: "Secure staff administration is not configured." });
  }

  try {
    if (req.method === "GET") return res.status(200).json(await loadDirectory(client));
    if (req.method !== "PUT") {
      res.setHeader("Allow", "GET, PUT");
      return res.status(405).json({ error: "Method not allowed." });
    }

    const body = parseBody(req);
    const roles = Array.isArray(body.roles) ? body.roles : [];
    const users = Array.isArray(body.users) ? body.users : [];
    if (!roles.length || !users.length) return res.status(400).json({ error: "At least one role and user are required." });

    const roleIds = new Set(roles.map((role) => String(role.id || "")).filter(Boolean));
    const normalizedRoles = roles.map((role) => ({
      id: String(role.id || ""),
      name: String(role.name || "Custom Role").trim(),
      system: Boolean(role.system),
      permissions: role.permissions && typeof role.permissions === "object" ? role.permissions : {}
    }));
    if (normalizedRoles.some((role) => !role.id || !role.name)) return res.status(400).json({ error: "Every role needs an ID and name." });

    const { data: existingUsers, error: existingError } = await client
      .from("auth_users").select("id,password,username,role_id,active");
    if (existingError) throw existingError;
    const existingById = new Map((existingUsers || []).map((user) => [String(user.id), user]));
    const normalizedUsers = users.map((user) => {
      const id = String(user.id || "");
      const password = String(user.password || "");
      const existing = existingById.get(id);
      return {
        id,
        username: String(user.username || "").trim(),
        password: password ? hashPassword(password) : String(existing?.password || ""),
        role_id: String(user.role_id || user.roleId || ""),
        active: user.active !== false
      };
    });
    if (normalizedUsers.some((user) => !user.id || !user.username || !user.password || !roleIds.has(user.role_id))) {
      return res.status(400).json({ error: "Every user needs a username, valid role and password." });
    }
    if (!normalizedUsers.some((user) => user.active && user.role_id === "role_admin")) {
      return res.status(400).json({ error: "At least one active admin user is required." });
    }
    const owner = normalizedUsers.find((user) => user.username.toLowerCase().replace(/\s+/g, " ") === "zakaria omar");
    if (!owner || !owner.active || owner.role_id !== "role_admin") {
      return res.status(400).json({ error: "Zakaria Omar must remain an active administrator." });
    }

    const { error: roleError } = await client.from("auth_roles").upsert(normalizedRoles, { onConflict: "id" });
    if (roleError) throw roleError;
    const { error: userError } = await client.from("auth_users").upsert(normalizedUsers, { onConflict: "id" });
    if (userError) throw userError;

    const keptRoleIds = normalizedRoles.map((role) => role.id);
    const keptUserIds = normalizedUsers.map((user) => user.id);
    const staleUsers = (existingUsers || []).filter((user) => !keptUserIds.includes(String(user.id))).map((user) => user.id);
    if (staleUsers.length) {
      const { error } = await client.from("auth_users").delete().in("id", staleUsers);
      if (error) throw error;
    }
    const { data: existingRoles, error: existingRolesError } = await client.from("auth_roles").select("id");
    if (existingRolesError) throw existingRolesError;
    const staleRoles = (existingRoles || []).filter((role) => !keptRoleIds.includes(String(role.id)) && role.id !== "role_admin").map((role) => role.id);
    if (staleRoles.length) {
      const { error } = await client.from("auth_roles").delete().in("id", staleRoles);
      if (error) throw error;
    }

    return res.status(200).json({ ok: true, ...(await loadDirectory(client)) });
  } catch (error) {
    return res.status(500).json({ error: String(error?.message || error || "Staff administration failed.") });
  }
};
