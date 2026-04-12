(function setupSupabase() {
  const cfg = window.OPX_SUPABASE || {};
  const url = String(cfg.url || "").trim();
  const anonKey = String(cfg.anonKey || "").trim();

  const out = {
    isReady: false,
    client: null
  };

  if (!url || !anonKey || !window.supabase?.createClient) {
    window.OPXSupabase = out;
    return;
  }

  try {
    out.client = window.supabase.createClient(url, anonKey);
    out.isReady = true;
  } catch (error) {
    console.error("Supabase client setup failed:", error);
  }

  window.OPXSupabase = out;
})();

