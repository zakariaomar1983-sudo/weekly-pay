const fs = require("fs");
const http = require("http");
const { URL, URLSearchParams } = require("url");

const clientPath = process.argv[2];
const redirectUri = "http://127.0.0.1:45678/oauth2callback";
if (!clientPath) {
  console.error("Usage: node scripts/google-oauth-refresh-token.js <downloaded-client-json>");
  process.exit(1);
}

let credentials;
try {
  const parsed = JSON.parse(fs.readFileSync(clientPath, "utf8"));
  credentials = parsed.installed || parsed.web || parsed;
} catch (error) {
  console.error(`Could not read OAuth client JSON: ${error.message}`);
  process.exit(1);
}

const state = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authorizationUrl.search = new URLSearchParams({
  client_id: credentials.client_id,
  redirect_uri: redirectUri,
  response_type: "code",
  access_type: "offline",
  prompt: "consent",
  scope: "https://www.googleapis.com/auth/gmail.readonly",
  state
}).toString();

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, redirectUri);
  if (url.pathname !== "/oauth2callback") return response.end("Waiting for Google authorization...");
  if (url.searchParams.get("state") !== state) return finish(response, "Authorization state did not match.", 400);
  if (url.searchParams.get("error")) return finish(response, `Google authorization failed: ${url.searchParams.get("error")}`, 400);
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: url.searchParams.get("code"), client_id: credentials.client_id, client_secret: credentials.client_secret, redirect_uri: redirectUri, grant_type: "authorization_code" })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.refresh_token) throw new Error(tokens.error_description || "No refresh token was returned.");
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
    finish(response, "Authorization complete. You can close this window.");
  } catch (error) {
    finish(response, error.message, 502);
  }
});

server.listen(45678, "127.0.0.1", () => {
  console.log("Open this URL in your browser and sign in as admin@onpointgroupes.com:");
  console.log(authorizationUrl.toString());
  console.log("Waiting for the authorization callback...");
});

function finish(response, message, status = 200) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(message);
  setTimeout(() => server.close(), 250);
}
