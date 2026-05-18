const { getLaunchDarklyHealth } = require("./_launchdarkly-server");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const health = await getLaunchDarklyHealth({ timeoutMs: 3000 });
  return res.status(200).json({
    ok: true,
    health: true,
    launchDarkly: health
  });
};
