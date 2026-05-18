let launchDarkly = null;

try {
  // Lazy-load compatibility: keep API endpoints functional if dependency is not installed yet.
  // eslint-disable-next-line global-require
  launchDarkly = require("@launchdarkly/node-server-sdk");
} catch {
  launchDarkly = null;
}

const DEFAULT_INIT_TIMEOUT_MS = 3000;

function getLaunchDarklyConfig(env = process.env) {
  const sdkKey = String(env.LAUNCHDARKLY_SDK_KEY || "").trim();
  return {
    sdkKey,
    configured: Boolean(sdkKey),
    dependencyInstalled: Boolean(launchDarkly)
  };
}

function ensureClientStore() {
  const globalStore = globalThis;
  if (!globalStore.__opxLaunchDarkly) {
    globalStore.__opxLaunchDarkly = {
      client: null,
      initPromise: null,
      initError: ""
    };
  }
  return globalStore.__opxLaunchDarkly;
}

async function initLaunchDarklyClient(options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_INIT_TIMEOUT_MS);
  const config = getLaunchDarklyConfig(process.env);
  const store = ensureClientStore();

  if (!config.dependencyInstalled) {
    return {
      client: null,
      configured: false,
      initialized: false,
      error: "LaunchDarkly dependency is not installed (@launchdarkly/node-server-sdk)."
    };
  }

  if (!config.configured) {
    return {
      client: null,
      configured: false,
      initialized: false,
      error: "Missing LAUNCHDARKLY_SDK_KEY."
    };
  }

  if (store.client) {
    return {
      client: store.client,
      configured: true,
      initialized: true,
      error: ""
    };
  }

  if (!store.initPromise) {
    store.initPromise = (async () => {
      const client = launchDarkly.init(config.sdkKey);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`LaunchDarkly init timeout after ${timeoutMs}ms.`)), timeoutMs);
      });
      await Promise.race([client.waitForInitialization(), timeoutPromise]);
      store.client = client;
      store.initError = "";
      return client;
    })();
  }

  try {
    const client = await store.initPromise;
    return {
      client,
      configured: true,
      initialized: true,
      error: ""
    };
  } catch (error) {
    store.initError = String(error?.message || error || "LaunchDarkly initialization failed.");
    store.initPromise = null;
    return {
      client: null,
      configured: true,
      initialized: false,
      error: store.initError
    };
  }
}

async function getLaunchDarklyHealth(options = {}) {
  const base = getLaunchDarklyConfig(process.env);
  const init = await initLaunchDarklyClient(options);

  return {
    ok: Boolean(base.dependencyInstalled && init.initialized),
    dependencyInstalled: base.dependencyInstalled,
    configured: base.configured,
    initialized: init.initialized,
    error: init.error || ""
  };
}

module.exports = {
  getLaunchDarklyConfig,
  initLaunchDarklyClient,
  getLaunchDarklyHealth
};
