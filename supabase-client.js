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

  async function ensureSupabaseSdk() {
    if (window.supabase?.createClient) return true;

    const fallbacks = [
      "./node_modules/@supabase/supabase-js/dist/umd/supabase.js",
      "/node_modules/@supabase/supabase-js/dist/umd/supabase.js",
      "https://unpkg.com/@supabase/supabase-js@2",
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
    ];

    for (const src of fallbacks) {
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = src;
          script.async = true;
          script.onload = resolve;
          script.onerror = () => reject(new Error(`Failed to load ${src}`));
          document.head.appendChild(script);
        });

        if (window.supabase?.createClient) return true;
      } catch (error) {
        console.warn("Supabase SDK fallback failed:", error.message);
      }
    }

    return false;
  }

  if (!url || !anonKey) {
    out.error = "Supabase URL/key missing.";
    publish(out);
    emitError(out.error);
    return;
  }

  const hasSdk = await ensureSupabaseSdk();
  if (!hasSdk) {
    out.error = "Supabase SDK failed to load.";
    publish(out);
    emitError(out.error);
    return;
  }

  try {
    out.client = window.supabase.createClient(url, anonKey);
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
