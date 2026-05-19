function readBooleanEnv(name, defaultValue = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return Boolean(defaultValue);
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return Boolean(defaultValue);
}

function getFeatureFlags() {
  return {
    projectAiChatEnabled: readBooleanEnv("FEATURE_PROJECT_AI_CHAT_ENABLED", true)
  };
}

module.exports = {
  getFeatureFlags,
  readBooleanEnv
};
