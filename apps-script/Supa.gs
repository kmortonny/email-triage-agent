/**
 * Supa.gs
 * Thin Supabase REST client for Apps Script.
 * Uses the service-role key (server side, never exposed to the browser).
 *
 * PostgREST conventions:
 *   GET    /rest/v1/<table>?<filter>=<op>.<value>&select=*&order=col.desc
 *   POST   /rest/v1/<table>                 body = single object or array
 *   PATCH  /rest/v1/<table>?id=eq.<id>      body = partial object
 *   DELETE /rest/v1/<table>?id=eq.<id>
 *
 * Upserts use `Prefer: resolution=merge-duplicates` and the `on_conflict` qs.
 */

function _supaHeaders() {
  var c = getConfig();
  if (!c.supabaseUrl || !c.supabaseKey) {
    throw new Error("Supabase not configured. Run the installer or call setConfig().");
  }
  return {
    "apikey":        c.supabaseKey,
    "Authorization": "Bearer " + c.supabaseKey,
    "Content-Type":  "application/json",
    "Prefer":        "return=representation"
  };
}

function _supaUrl(path) {
  return getConfig().supabaseUrl.replace(/\/+$/, "") + "/rest/v1" + path;
}

function _supaFetch(url, opts) {
  opts = opts || {};
  opts.muteHttpExceptions = true;
  opts.headers = Object.assign({}, _supaHeaders(), opts.headers || {});
  var resp = UrlFetchApp.fetch(url, opts);
  var code = resp.getResponseCode();
  var text = resp.getContentText();
  if (code >= 200 && code < 300) {
    try { return text ? JSON.parse(text) : null; }
    catch(e) { return text; }
  }
  throw new Error("Supabase " + code + ": " + text.substring(0, 500));
}

/**
 * Build a PostgREST query string from a filter object.
 *   { eq: { col: val }, in: { col: [a,b] }, gt: { col: val }, ... }
 *   Plus: select, order, limit, offset.
 */
function _supaQs(opts) {
  opts = opts || {};
  var parts = [];
  ["eq","neq","gt","gte","lt","lte","like","ilike","is"].forEach(function(op){
    if (opts[op]) {
      Object.keys(opts[op]).forEach(function(col){
        parts.push(encodeURIComponent(col) + "=" + op + "." + encodeURIComponent(opts[op][col]));
      });
    }
  });
  if (opts["in"]) {
    Object.keys(opts["in"]).forEach(function(col){
      var arr = opts["in"][col];
      parts.push(encodeURIComponent(col) + "=in.(" + arr.map(encodeURIComponent).join(",") + ")");
    });
  }
  if (opts.select) parts.push("select=" + encodeURIComponent(opts.select));
  if (opts.order)  parts.push("order="  + encodeURIComponent(opts.order));
  if (opts.limit)  parts.push("limit="  + encodeURIComponent(opts.limit));
  if (opts.offset) parts.push("offset=" + encodeURIComponent(opts.offset));
  return parts.length ? ("?" + parts.join("&")) : "";
}

function supaSelect(table, opts) {
  return _supaFetch(_supaUrl("/" + table + _supaQs(opts)), { method: "get" });
}

function supaInsert(table, rows) {
  if (!Array.isArray(rows)) rows = [rows];
  return _supaFetch(_supaUrl("/" + table), {
    method: "post",
    payload: JSON.stringify(rows)
  });
}

function supaUpdate(table, filter, patch) {
  return _supaFetch(_supaUrl("/" + table + _supaQs({ eq: filter })), {
    method: "patch",
    payload: JSON.stringify(patch)
  });
}

function supaUpsert(table, rows, conflictCol) {
  if (!Array.isArray(rows)) rows = [rows];
  var url = _supaUrl("/" + table + "?on_conflict=" + encodeURIComponent(conflictCol || "id"));
  return _supaFetch(url, {
    method: "post",
    headers: { "Prefer": "resolution=merge-duplicates,return=representation" },
    payload: JSON.stringify(rows)
  });
}

function supaDelete(table, filter) {
  return _supaFetch(_supaUrl("/" + table + _supaQs({ eq: filter })), { method: "delete" });
}

/**
 * Sanity check called by the installer to verify connectivity.
 */
function supaPing() {
  try {
    var rows = supaSelect("app_config", { limit: 1 });
    return { ok: true, rows: (rows||[]).length };
  } catch(e) {
    return { ok: false, error: e.toString() };
  }
}
