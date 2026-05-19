/**
 * Code.gs — top-level entry points.
 *
 * Email Triage Agent — open-source email automation built on Google Apps
 * Script + Supabase + n8n.  Connects to Gmail or Outlook, learns your voice
 * from your Sent folder, and runs Claude-driven triage + drafting on
 * inbound mail.
 *
 * Architecture: see docs/ARCHITECTURE.md
 * Configuration: see docs/CONFIGURATION.md
 */

function doGet() {
  return HtmlService
    .createHtmlOutputFromFile("Index")
    .setTitle("Email Triage Agent")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Health check called by the installer after deploy to verify everything
 * is wired correctly.  Returns a structured report.
 */
function healthCheck() {
  var report = { ok: true, version: CODE_VERSION, checks: {} };
  var c = getConfig();

  report.checks.anthropic = !!c.anthropicKey ? "ok" : "missing ANTHROPIC_API_KEY";
  report.checks.supabase  = (!!c.supabaseUrl && !!c.supabaseKey) ? "ok" : "missing Supabase config";
  report.checks.n8n       = !!c.n8nUrl ? "ok" : "missing N8N_URL (optional)";
  report.checks.provider  = (c.emailProvider === "outlook" || c.emailProvider === "gmail")
                             ? c.emailProvider
                             : "unknown provider: " + c.emailProvider;

  try {
    var ping = supaPing();
    report.checks.supabase_reachable = ping.ok ? "ok" : ("error: " + ping.error);
  } catch(e) {
    report.checks.supabase_reachable = "error: " + e.toString();
  }

  try {
    var p = loadPersona();
    report.checks.persona = p.learned_from_sent_folder ? "learned" : "generic default";
  } catch(e) {
    report.checks.persona = "error: " + e.toString();
    report.ok = false;
  }

  Object.keys(report.checks).forEach(function(k){
    if (String(report.checks[k]).indexOf("error") === 0 || String(report.checks[k]).indexOf("missing") === 0) {
      report.ok = false;
    }
  });

  return report;
}
