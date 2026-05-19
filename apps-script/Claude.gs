/**
 * Claude.gs
 * Single point of contact with the Anthropic API.
 * All callers go through claudeCall() so the model, version, and error
 * handling stay consistent in one place.
 */

var CLAUDE_MODEL = "claude-sonnet-4-6";
var CLAUDE_API_VERSION = "2023-06-01";

function claudeCall(opts) {
  opts = opts || {};
  var c = getConfig();
  if (!c.anthropicKey) {
    return { ok: false, error: "ANTHROPIC_API_KEY not set" };
  }
  var body = {
    model:      opts.model      || CLAUDE_MODEL,
    max_tokens: opts.maxTokens  || 600,
    messages:   opts.messages   || [{ role: "user", content: opts.prompt || "" }]
  };
  if (opts.system) body.system = opts.system;

  try {
    var resp = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post",
      contentType: "application/json",
      headers: {
        "x-api-key":         c.anthropicKey,
        "anthropic-version": CLAUDE_API_VERSION
      },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    var text = resp.getContentText();
    if (code !== 200) {
      Logger.log("Claude " + code + ": " + text.substring(0, 300));
      return { ok: false, error: "Claude HTTP " + code, raw: text };
    }
    var data = JSON.parse(text);
    if (!data.content || !data.content[0]) {
      return { ok: false, error: "Empty Claude response", raw: text };
    }
    return { ok: true, text: data.content[0].text, raw: data };
  } catch(e) {
    return { ok: false, error: e.toString() };
  }
}

/**
 * Convenience: JSON-only call.  Strips ```json fences, parses, returns object.
 */
function claudeJson(opts) {
  var r = claudeCall(opts);
  if (!r.ok) return r;
  var t = String(r.text || "").replace(/```json|```/g, "").trim();
  try { return { ok: true, data: JSON.parse(t) }; }
  catch(e) { return { ok: false, error: "JSON parse: " + e.toString(), raw: r.text }; }
}
