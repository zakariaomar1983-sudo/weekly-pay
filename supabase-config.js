(function loadSupabaseConfig() {
  // Option 1: hardcode values here for single-build deployment.
  const hardcoded = {
    url: "",
    anonKey: ""
  };

  // Option 2: persist per-device values (set once, then reused).
  const storedUrl = localStorage.getItem("OPX_SUPABASE_URL") || "";
  const storedAnon = localStorage.getItem("OPX_SUPABASE_ANON_KEY") || "";

  // Option 3: one-time bootstrap via URL query params.
  // Example: ?sbUrl=https://xyz.supabase.co&sbAnon=eyJ...
  const params = new URLSearchParams(window.location.search);
  const paramUrl = params.get("sbUrl") || "";
  const paramAnon = params.get("sbAnon") || "";

  if (paramUrl && paramAnon) {
    localStorage.setItem("OPX_SUPABASE_URL", paramUrl);
    localStorage.setItem("OPX_SUPABASE_ANON_KEY", paramAnon);
  }

  const url = (hardcoded.url || paramUrl || storedUrl).trim();
  const anonKey = (hardcoded.anonKey || paramAnon || storedAnon).trim();

  window.OPX_SUPABASE = { url, anonKey };
})();
