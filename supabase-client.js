import { createClient } from '@supabase/supabase-js'

(async function setupSupabase() {
  const cfg = window.OPX_SUPABASE || {};
  const url = String(cfg.url || "").trim();
  const anonKey = String(cfg.anonKey || "").trim();

  const out = {
    isReady: false,
    client: null,
    error: ""
  };

  function publish(state) {
    window.OPXSupabase = state;
  }

  function emitReady() {
    window.dispatchEvent(new CustomEvent("opx:supabase-ready"));
  }

  function emitError(message) {
    window.dispatchEvent(new CustomEvent("opx:supabase-error", { detail: { message } }));
  }

  if (!url || !anonKey) {
    out.error = "Supabase URL/key missing.";
    publish(out);
    emitError(out.error);
    return;
  }

  try {
    out.client = createClient(url, anonKey);
    out.isReady = true;
    publish(out);
    emitReady();
  } catch (error) {
    out.error = `Supabase client setup failed: ${error.message || "Unknown error"}`;
    publish(out);
    emitError(out.error);
    console.error(out.error);
  }
})();
