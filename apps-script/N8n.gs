/**
 * N8n.gs
 * Thin wrappers around the n8n REST API + webhook proxy.
 * The n8n base URL and API key are set by the installer.
 */

function _n8nBase() {
  var c = getConfig();
  return String(c.n8nUrl || "").replace(/\/+$/, "");
}

function _n8nHeaders() {
  var c = getConfig();
  return {
    "X-N8N-API-KEY": c.n8nApiKey || "",
    "Accept":        "application/json",
    "Content-Type":  "application/json"
  };
}

function getN8nExecutions(workflowId, limit) {
  if (!workflowId) return JSON.stringify({ data: [] });
  var url = _n8nBase() + "/api/v1/executions?workflowId=" + encodeURIComponent(workflowId)
          + "&limit=" + (limit || 10);
  var resp = UrlFetchApp.fetch(url, { method: "get", headers: _n8nHeaders(), muteHttpExceptions: true });
  return resp.getContentText();
}

function getN8nWorkflowStates(workflowIds) {
  var states = {};
  if (!Array.isArray(workflowIds)) workflowIds = [];
  workflowIds.forEach(function(id){
    var sid = String(id || "").trim();
    if (!sid) return;
    try {
      var resp = UrlFetchApp.fetch(_n8nBase() + "/api/v1/workflows/" + sid,
        { method: "get", headers: _n8nHeaders(), muteHttpExceptions: true });
      if (resp.getResponseCode() === 200) {
        var data = JSON.parse(resp.getContentText());
        states[sid] = { active: !!data.active, name: data.name || "" };
      } else {
        states[sid] = { active: false, error: "HTTP " + resp.getResponseCode() };
      }
    } catch(e) {
      states[sid] = { active: false, error: String(e) };
    }
  });
  return JSON.stringify({ states: states });
}

function getN8nExecutionStats(workflowId) {
  if (!workflowId) return JSON.stringify({ today: 0, week: 0, month: 0 });
  var now = Date.now();
  var c24 = now - 24*60*60*1000;
  var c7  = now - 7 *24*60*60*1000;
  var c30 = now - 30*24*60*60*1000;
  var today = 0, week = 0, month = 0;
  var cursor = null, pages = 0, MAX_PAGES = 10;
  while (pages < MAX_PAGES) {
    var url = _n8nBase() + "/api/v1/executions?workflowId=" + encodeURIComponent(workflowId) + "&limit=250";
    if (cursor) url += "&cursor=" + encodeURIComponent(cursor);
    var resp = UrlFetchApp.fetch(url, { method: "get", headers: _n8nHeaders(), muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) break;
    var body = JSON.parse(resp.getContentText());
    var execs = body.data || [];
    if (!execs.length) break;
    var stop = false;
    for (var i = 0; i < execs.length; i++) {
      var t = execs[i].startedAt ? new Date(execs[i].startedAt).getTime() : 0;
      if (!t) continue;
      if (t < c30) { stop = true; break; }
      month++;
      if (t >= c7)  week++;
      if (t >= c24) today++;
    }
    if (stop) break;
    cursor = body.nextCursor || null;
    if (!cursor) break;
    pages++;
  }
  return JSON.stringify({ today: today, week: week, month: month });
}

/**
 * Proxy a browser-side call to an n8n webhook (avoids CORS).
 */
function callN8nWebhook(path, payload) {
  try {
    var url = _n8nBase() + "/webhook/" + String(path || "").replace(/^\/+/, "");
    var resp = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload || {}),
      muteHttpExceptions: true
    });
    return { ok: true, status: resp.getResponseCode(), body: resp.getContentText() };
  } catch(e) {
    return { ok: false, error: e.toString() };
  }
}

function updateTriageSettings(settings) {
  appConfigSet("triage_settings", settings || {});
  return { ok: true };
}
