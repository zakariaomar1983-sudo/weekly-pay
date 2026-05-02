const WHATSAPP_GRAPH_VERSION = "v22.0";
const MAX_MEDIA_BYTES = 4 * 1024 * 1024;

function readMediaConfig(env = process.env) {
  const accessToken = String(env.WHATSAPP_ACCESS_TOKEN || "").trim();
  return {
    accessToken,
    accessTokenConfigured: Boolean(accessToken)
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = String(body?.error?.message || body?.error || body?.message || `HTTP ${response.status}`);
    throw new Error(detail);
  }
  return body;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const config = readMediaConfig(process.env);
  const mediaId = String(req.query?.mediaId || "").trim();
  if (!mediaId) {
    return res.status(200).json({
      configured: config.accessTokenConfigured,
      usage: "Provide ?mediaId=<whatsapp-media-id> to load media."
    });
  }

  if (!config.accessTokenConfigured) {
    return res.status(500).json({ error: "WhatsApp access token is not configured." });
  }

  try {
    const metaUrl = `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(mediaId)}`;
    const meta = await fetchJson(metaUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.accessToken}`
      }
    });

    const mediaUrl = String(meta?.url || "").trim();
    const mimeType = String(meta?.mime_type || "").trim() || "application/octet-stream";
    if (!mediaUrl) {
      return res.status(404).json({ error: "Media URL was not returned by WhatsApp." });
    }

    const mediaResponse = await fetch(mediaUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.accessToken}`
      }
    });

    if (!mediaResponse.ok) {
      const detail = await mediaResponse.text().catch(() => "");
      return res.status(mediaResponse.status).json({
        error: `Media download failed.${detail ? ` ${detail.slice(0, 200)}` : ""}`
      });
    }

    const lengthHeader = Number(mediaResponse.headers.get("content-length") || 0);
    if (lengthHeader && lengthHeader > MAX_MEDIA_BYTES) {
      return res.status(413).json({ error: "Media file is too large for inline receipt review." });
    }

    const arrayBuffer = await mediaResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > MAX_MEDIA_BYTES) {
      return res.status(413).json({ error: "Media file is too large for inline receipt review." });
    }

    res.setHeader("Content-Type", mediaResponse.headers.get("content-type") || mimeType);
    res.setHeader("Cache-Control", "private, max-age=60");
    return res.status(200).send(buffer);
  } catch (error) {
    const message = String(error?.message || error || "Unable to load WhatsApp media.");
    if (/Invalid application ID/i.test(message) || /Error validating access token/i.test(message) || /Invalid OAuth/i.test(message)) {
      return res.status(401).json({
        error: "WhatsApp access token is invalid for this Meta app. Update WHATSAPP_ACCESS_TOKEN in Vercel Production and redeploy."
      });
    }
    return res.status(500).json({
      error: message
    });
  }
};
