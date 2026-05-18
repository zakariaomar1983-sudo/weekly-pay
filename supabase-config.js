(function loadSupabaseConfig() {
  // Option 1: hardcode values here for single-build deployment.
  const hardcoded = {
    url: "https://cphshcvrbdtsaftuwaya.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwaHNoY3ZyYmR0c2FmdHV3YXlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NjUzMDAsImV4cCI6MjA5MTU0MTMwMH0.kmmByItNnTjTrJXyUGccWLNLdrZ8U_lHOTYLrBxA-gQ"
  };

  function readStoredValue(key) {
    try {
      return window.localStorage?.getItem(key) || "";
    } catch {
      return "";
    }
  }

  function writeStoredValue(key, value) {
    try {
      window.localStorage?.setItem(key, value);
    } catch {
      // Storage may be unavailable in restricted/private browser contexts.
    }
  }

  // Option 2: persist per-device values (set once, then reused).
  const storedUrl = readStoredValue("OPX_SUPABASE_URL");
  const storedAnon = readStoredValue("OPX_SUPABASE_ANON_KEY");

  // Option 3: one-time bootstrap via URL query params.
  // Example: ?sbUrl=https://xyz.supabase.co&sbAnon=eyJ...
  const params = new URLSearchParams(window.location.search);
  const paramUrl = (params.get("sbUrl") || "").trim();
  const paramAnon = (params.get("sbAnon") || "").trim();

  const paramConfig = paramUrl && paramAnon ? { url: paramUrl, anonKey: paramAnon } : null;
  const storedConfig = storedUrl && storedAnon ? {
    url: storedUrl.trim(),
    anonKey: storedAnon.trim()
  } : null;
  const fallbackConfig = {
    url: String(hardcoded.url || "").trim(),
    anonKey: String(hardcoded.anonKey || "").trim()
  };

  if (paramConfig) {
    writeStoredValue("OPX_SUPABASE_URL", paramConfig.url);
    writeStoredValue("OPX_SUPABASE_ANON_KEY", paramConfig.anonKey);
  }

  // Prefer complete explicit browser/runtime configuration over the baked-in
  // default, and avoid mixing a URL from one source with a key from another.
  const config = paramConfig || storedConfig || fallbackConfig;

  window.OPX_SUPABASE = { url: config.url, anonKey: config.anonKey };
})();
