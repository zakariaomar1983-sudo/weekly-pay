const {
  authenticateCredentials,
  issueStaffToken,
  requireStaff
} = require("./_auth-server");

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body !== "string") return {};
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const body = parseBody(req);
    let user;
    if (body.username || body.password) {
      user = await authenticateCredentials(body.username, body.password);
      if (!user) return res.status(401).json({ error: "Invalid username or password." });
    } else {
      user = requireStaff(req, res);
      if (!user) return;
    }

    const token = issueStaffToken(user);
    return res.status(200).json({
      ok: true,
      token,
      expiresIn: 360
    });
  } catch (error) {
    return res.status(500).json({
      error: String(error?.message || error || "Unable to create a secure staff session.")
    });
  }
};
