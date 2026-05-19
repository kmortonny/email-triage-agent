/**
 * Config.gs
 * Centralized config loader.  All credentials live in Apps Script Properties
 * (set during install by installer/install.ps1 calling clasp + a one-shot
 * setConfig() function).  Feature flags and runtime settings live in the
 * Supabase `app_config` table.
 *
 * Nothing identifying or environment-specific should ever live in source.
 */

var CODE_VERSION = "v0.1.0";

function _props() { return PropertiesService.getScriptProperties(); }

function getConfig() {
  var p = _props();
  return {
    supabaseUrl:       p.getProperty("SUPABASE_URL")       || "",
    supabaseKey:       p.getProperty("SUPABASE_SERVICE_KEY") || "",
    anthropicKey:      p.getProperty("ANTHROPIC_API_KEY")  || "",
    n8nUrl:            p.getProperty("N8N_URL")            || "",
    n8nApiKey:         p.getProperty("N8N_API_KEY")        || "",
    emailProvider:     p.getProperty("EMAIL_PROVIDER")     || "gmail",
    ownerEmail:        p.getProperty("OWNER_EMAIL")        || Session.getActiveUser().getEmail(),
    m365ClientId:      p.getProperty("M365_CLIENT_ID")     || "",
    m365ClientSecret:  p.getProperty("M365_CLIENT_SECRET") || ""
  };
}

/**
 * One-shot configuration helper called by the installer.  Accepts a JSON
 * object of key/value pairs and stores them in Script Properties.
 * Existing keys are overwritten only when a non-empty value is supplied.
 */
function setConfig(json) {
  try {
    var data = (typeof json === "string") ? JSON.parse(json) : (json || {});
    var p = _props();
    Object.keys(data).forEach(function(k){
      var v = data[k];
      if (v === null || v === undefined || v === "") return;
      p.setProperty(k, String(v));
    });
    return { ok: true };
  } catch(e) {
    return { ok: false, error: e.toString() };
  }
}

/**
 * Returns a sanitized snapshot for the dashboard UI (no secrets).
 */
function getInitData() {
  var c = getConfig();
  var modules = appConfigGet("modules") || {};
  return {
    codeVersion:   CODE_VERSION,
    ownerEmail:    c.ownerEmail,
    emailProvider: c.emailProvider,
    supabaseUrl:   c.supabaseUrl,
    n8nUrl:        c.n8nUrl,
    hasAnthropic:  !!c.anthropicKey,
    hasSupabase:   !!c.supabaseUrl && !!c.supabaseKey,
    modules:       modules
  };
}

/**
 * Read a feature flag / setting from Supabase app_config.
 */
function appConfigGet(key) {
  try {
    var res = supaSelect("app_config", { eq: { key: key }, limit: 1 });
    if (res && res.length) return res[0].value;
  } catch(e) { Logger.log("appConfigGet error: " + e); }
  return null;
}

function appConfigSet(key, value) {
  return supaUpsert("app_config", [{ key: key, value: value }], "key");
}

function getCodeVersion() { return CODE_VERSION; }
