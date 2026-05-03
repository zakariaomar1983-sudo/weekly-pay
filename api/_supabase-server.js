const { createClient } = require("@supabase/supabase-js");

const FALLBACK_SUPABASE_URL = "https://cphshcvrbdtsaftuwaya.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwaHNoY3ZyYmR0c2FmdHV3YXlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NjUzMDAsImV4cCI6MjA5MTU0MTMwMH0.kmmByItNnTjTrJXyUGccWLNLdrZ8U_lHOTYLrBxA-gQ";

function getSupabaseServerConfig(env = process.env) {
  const url = String(
    env.SUPABASE_URL
      || env.NEXT_PUBLIC_SUPABASE_URL
      || FALLBACK_SUPABASE_URL
      || ""
  ).trim();
  const key = String(
    env.SUPABASE_SERVICE_ROLE_KEY
      || env.SUPABASE_ANON_KEY
      || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      || FALLBACK_SUPABASE_ANON_KEY
      || ""
  ).trim();

  return {
    url,
    key,
    configured: Boolean(url && key)
  };
}

function getSupabaseServerClient(env = process.env) {
  const config = getSupabaseServerConfig(env);
  if (!config.configured) return null;
  return createClient(config.url, config.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

module.exports = {
  getSupabaseServerClient,
  getSupabaseServerConfig
};
