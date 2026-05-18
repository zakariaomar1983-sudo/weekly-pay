const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const querystring = require("querystring");
const { URL } = require("url");

const root = path.resolve(process.cwd());
const apiRoot = path.join(root, "api");
const port = 4173;
const host = "0.0.0.0";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function getLanUrls(listenPort = port) {
  const nets = os.networkInterfaces();
  const urls = [];

  Object.values(nets).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (entry.family !== "IPv4" || entry.internal) return;
      urls.push(`http://${entry.address}:${listenPort}`);
    });
  });

  return urls;
}

function isPathInside(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function containsUnsafePathCharacters(value) {
  return value.includes("\0") || value.includes("\\");
}

function getApiFile(urlPathname) {
  const relativePath = urlPathname.replace(/^\/api\/?/, "").replace(/^\/+/, "");
  if (!relativePath || containsUnsafePathCharacters(relativePath)) return "";

  const full = path.resolve(apiRoot, `${relativePath}.js`);
  return isPathInside(apiRoot, full) ? full : "";
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!chunks.length) {
        resolve(undefined);
        return;
      }

      const raw = Buffer.concat(chunks).toString("utf8");
      const contentType = String(req.headers["content-type"] || "").toLowerCase();

      if (contentType.includes("application/json")) {
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(raw);
        }
        return;
      }

      if (contentType.includes("application/x-www-form-urlencoded")) {
        resolve(querystring.parse(raw));
        return;
      }

      resolve(raw);
    });

    req.on("error", reject);
  });
}

function searchParamsToQuery(searchParams) {
  const query = {};

  searchParams.forEach((value, key) => {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      query[key] = Array.isArray(query[key]) ? [...query[key], value] : [query[key], value];
      return;
    }
    query[key] = value;
  });

  return query;
}

function createLocalResponse(res) {
  let ended = false;

  const localRes = {
    statusCode: 200,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(payload) {
      if (ended) return this;
      ended = true;
      const body = JSON.stringify(payload);
      res.writeHead(this.statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        ...this.headers
      });
      res.end(body);
      return this;
    },
    send(payload) {
      if (ended) return this;
      ended = true;
      const isBuffer = Buffer.isBuffer(payload);
      const body = payload == null ? "" : (isBuffer ? payload : String(payload));
      const defaultType = isBuffer ? "application/octet-stream" : "text/plain; charset=utf-8";
      res.writeHead(this.statusCode, {
        "Content-Type": this.headers["Content-Type"] || defaultType,
        ...this.headers
      });
      res.end(body);
      return this;
    },
    ended() {
      return ended;
    }
  };

  return localRes;
}

async function handleApiRequest(req, res, pathname, searchParams) {
  const apiFile = getApiFile(pathname);
  if (!apiFile || !fs.existsSync(apiFile) || !fs.statSync(apiFile).isFile()) {
    send(res, 404, JSON.stringify({ error: "API route not found." }), "application/json; charset=utf-8");
    return;
  }

  let handler;
  try {
    delete require.cache[require.resolve(apiFile)];
    handler = require(apiFile);
  } catch (error) {
    send(
      res,
      500,
      JSON.stringify({ error: `Could not load API handler: ${error?.message || error}` }),
      "application/json; charset=utf-8"
    );
    return;
  }

  if (typeof handler !== "function") {
    send(res, 500, JSON.stringify({ error: "API handler must export a function." }), "application/json; charset=utf-8");
    return;
  }

  const localReq = {
    method: req.method,
    headers: req.headers,
    query: searchParamsToQuery(searchParams),
    body: ["POST", "PUT", "PATCH"].includes(req.method || "") ? await parseRequestBody(req) : undefined,
    url: req.url
  };
  const localRes = createLocalResponse(res);

  try {
    await handler(localReq, localRes);
    if (!localRes.ended()) {
      localRes.send("");
    }
  } catch (error) {
    if (!localRes.ended()) {
      localRes.status(500).json({ error: String(error?.message || error || "Unhandled API error.") });
    }
  }
}

function getStaticFilePath(urlPath) {
  const relativePath = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  if (!relativePath || containsUnsafePathCharacters(relativePath)) return "";

  const full = path.resolve(root, relativePath);
  return isPathInside(root, full) ? full : "";
}

function createLocalServer() {
  return http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    let urlPath;

    try {
      urlPath = decodeURIComponent(parsedUrl.pathname);
    } catch {
      send(res, 400, "Bad Request");
      return;
    }

    if (urlPath.startsWith("/api/")) {
      await handleApiRequest(req, res, urlPath, parsedUrl.searchParams);
      return;
    }

    const full = getStaticFilePath(urlPath);

    if (!full) {
      send(res, 403, "Forbidden");
      return;
    }

    fs.stat(full, (err, st) => {
      if (err || !st.isFile()) {
        send(res, 404, "Not Found");
        return;
      }
      const ext = path.extname(full).toLowerCase();
      const type = mime[ext] || "application/octet-stream";
      const stream = fs.createReadStream(full);

      stream.on("error", () => {
        if (!res.headersSent) {
          send(res, 500, "Could not read file.");
          return;
        }
        res.destroy();
      });

      res.writeHead(200, { "Content-Type": type });
      stream.pipe(res);
    });
  });
}

function startLocalServer({ silent = false } = {}) {
  const server = createLocalServer();
  server.listen(port, host, () => {
    if (silent) return;
    console.log(`Static + API server running at http://localhost:${port}`);
    getLanUrls(port).forEach((url) => {
      console.log(`LAN access: ${url}`);
    });
  });
  return server;
}

if (require.main === module) {
  startLocalServer();
}

module.exports = {
  createLocalServer,
  startLocalServer,
  port,
  host
};
