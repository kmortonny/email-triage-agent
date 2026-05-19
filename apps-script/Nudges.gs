/**
 * Nudges.gs
 * Auto-nudge follow-ups for customers (quote pending) and vendors (RFQ pending).
 * Intake-request drafts for new opportunities missing baseline info.
 * Customer-response intent classification.
 */

function generateNudgeEmail(type, opts) {
  opts = opts || {};
  var isVendor = (type === "vendor");
  var persona = loadPersona();
  var system = personaContext(persona, "casual");

  var prompt = isVendor
    ? ("Write a brief RFQ follow-up email to a vendor.\n\n" +
       "Context:\n" +
       "- Deal/Project: " + (opts.dealTitle || "") + "\n" +
       "- Vendor: " + (opts.org || "") + "\n" +
       "- Contact: " + (opts.contact || "") + "\n" +
       "- Stage: " + (opts.stage || "") + "\n" +
       "- Notes: " + (opts.notes || "") + "\n\n" +
       "Ask plainly what the status is on the RFQ.")
    : ("Write a brief quote follow-up email to a customer.\n\n" +
       "Context:\n" +
       "- Deal/Project: " + (opts.dealTitle || "") + "\n" +
       "- Customer: " + (opts.org || "") + "\n" +
       "- Contact: " + (opts.contact || "") + "\n" +
       "- Stage: " + (opts.stage || "") + "\n" +
       "- Quote Date: " + (opts.quoteDate || "") + "\n" +
       "- Notes: " + (opts.notes || "") + "\n\n" +
       "Politely ask if they had a chance to review the quote.");

  var r = claudeCall({ system: system, prompt: prompt, maxTokens: 350 });
  if (!r.ok) return r;
  return { ok: true, body: String(r.text || "").trim() };
}

function generateIntakeEmail(contactName, org, missingFields, tone) {
  var fieldDescriptions = {
    "application":      "what the product will be used for / the application",
    "product":          "what product or item is needed",
    "quantityAnnual":   "the approximate annual quantity needed",
    "deadline":         "the timeline or required-by date",
    "budget":           "the budget range",
    "specifications":   "the technical specifications required"
  };
  var fields = (missingFields && missingFields.length)
    ? missingFields
    : ["application", "product", "quantityAnnual", "deadline"];
  var needed = fields.map(function(f){ return fieldDescriptions[f] || f; }).join(", ");

  var firstName = (contactName || "").split(" ")[0] || "";
  var persona = loadPersona();
  var system = personaContext(persona, tone || "casual");

  var prompt =
    "Write a short email to a potential new customer requesting baseline information needed to scope their inquiry.\n" +
    "Contact first name: " + (firstName || "there") + "\n" +
    "Organization: " + (org || "") + "\n" +
    "Information needed: " + needed;

  var r = claudeCall({ system: system, prompt: prompt, maxTokens: 300 });
  if (!r.ok) return r;
  return { ok: true, body: String(r.text || "").trim() };
}

/**
 * Classify a customer reply to a quote into a coarse intent + nudge timing.
 */
function parseCustomerResponse(emailBody, subject) {
  var prompt =
    "Analyze this customer email response to a quote and determine their intent.\n\n" +
    "Subject: " + (subject || "") + "\nBody: " + (emailBody || "") + "\n\n" +
    "Return ONLY a JSON object with:\n" +
    "- intent: one of \"moving_forward\", \"needs_more_time\", \"call_me\", \"new_requirement\", \"no_signal\"\n" +
    "- nudgeDays: suggested days until follow-up (number as string, e.g. \"7\", \"14\", \"30\") or empty string\n" +
    "- nudgeDate: specific date mentioned in ISO format (YYYY-MM-DD) or empty string\n" +
    "- notes: one sentence explaining the intent";
  var r = claudeJson({ prompt: prompt, maxTokens: 300 });
  return r.ok ? { ok: true, data: r.data } : r;
}

/**
 * Persist / list nudge state.
 */
function listDueNudges() {
  var now = new Date().toISOString();
  return supaSelect("nudge_state", {
    eq: { paused: false },
    lte: { next_nudge_at: now },
    order: "next_nudge_at.asc",
    limit: 100
  });
}

function recordNudgeSent(targetType, targetId, cadenceDays) {
  var now = new Date();
  var next = new Date(now.getTime() + (cadenceDays || 14) * 86400000);
  return supaUpsert("nudge_state", [{
    target_type: targetType,
    target_id:   targetId,
    last_nudged_at: now.toISOString(),
    next_nudge_at:  next.toISOString(),
    nudge_count: 1,
    cadence_days: cadenceDays || 14
  }], "target_type,target_id");
}
