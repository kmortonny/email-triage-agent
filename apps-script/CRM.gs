/**
 * CRM.gs (optional module)
 * Pipeline / deals / archive / stages.  Off by default — enable via
 * app_config.modules.crm = true.  All functions here check the flag first
 * and noop if the module is disabled, so they are safe to leave in place
 * even on email-only installs.
 */

function _crmEnabled() {
  var m = appConfigGet("modules") || {};
  return !!m.crm;
}

function loadStages() {
  if (!_crmEnabled()) return [];
  var rows = supaSelect("stages", { order: "type.asc,position.asc" });
  if (!rows || !rows.length) return [];
  var byType = {};
  rows.forEach(function(r){
    if (!byType[r.type]) byType[r.type] = [];
    byType[r.type].push(r.name);
  });
  return Object.keys(byType).map(function(t){ return { type: t, stages: byType[t] }; });
}

function saveStages(jsonOrArray) {
  if (!_crmEnabled()) return { ok: false, error: "CRM module disabled" };
  try {
    var data = (typeof jsonOrArray === "string") ? JSON.parse(jsonOrArray) : jsonOrArray;
    supaDelete("stages", {});
    var rows = [];
    data.forEach(function(s){
      (s.stages || []).forEach(function(name, idx){
        rows.push({ type: s.type, position: idx + 1, name: name });
      });
    });
    if (rows.length) supaInsert("stages", rows);
    return { ok: true };
  } catch(e) { return { ok: false, error: e.toString() }; }
}

function listTasks(opts) {
  if (!_crmEnabled()) return [];
  opts = opts || {};
  var q = { order: "last_activity_at.desc.nullslast", limit: opts.limit || 500 };
  if (opts.activeOnly) q.eq = { active: true };
  return supaSelect("tasks", q) || [];
}

function upsertTask(task) {
  if (!_crmEnabled()) return { ok: false, error: "CRM module disabled" };
  if (!task || !task.id) return { ok: false, error: "Task id required" };
  task.last_activity_at = new Date().toISOString();
  return supaUpsert("tasks", [task], "id");
}

function archiveTask(id) {
  if (!_crmEnabled()) return { ok: false, error: "CRM module disabled" };
  var rows = supaSelect("tasks", { eq: { id: id }, limit: 1 });
  if (!rows || !rows[0]) return { ok: false, error: "Task not found" };
  supaInsert("archived_tasks", [rows[0]]);
  supaDelete("tasks", { id: id });
  return { ok: true };
}

function deleteTask(id) {
  if (!_crmEnabled()) return { ok: false, error: "CRM module disabled" };
  var rows = supaSelect("tasks", { eq: { id: id }, limit: 1 });
  if (!rows || !rows[0]) return { ok: false, error: "Task not found" };
  supaInsert("deleted_tasks", [rows[0]]);
  supaDelete("tasks", { id: id });
  return { ok: true };
}

function markOldDealsInactive() {
  if (!_crmEnabled()) return { ok: false, error: "CRM module disabled" };
  var cutoff = new Date(Date.now() - 365*86400000).toISOString();
  var rows = supaSelect("tasks", { lt: { last_activity_at: cutoff }, eq: { active: true }, limit: 5000 });
  var ids = (rows || []).map(function(r){ return r.id; });
  if (!ids.length) return { ok: true, marked: 0 };
  ids.forEach(function(id){ supaUpdate("tasks", { id: id }, { active: false }); });
  return { ok: true, marked: ids.length };
}
