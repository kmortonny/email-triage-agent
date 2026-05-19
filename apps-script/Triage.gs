/**
 * Triage.gs
 * Email-triage core.  Consumes the raw email payload (from n8n workflow),
 * classifies + drafts via Claude, persists to Supabase `triage_emails`.
 */

var TRIAGE_CATEGORIES = [
  "ACTION_REQUIRED_DRAFT", "ACTION_REQUIRED_KEITH", "VENDOR_RFQ_RESPONSE",
  "CUSTOMER_QUOTE_RESPONSE", "NEW_OPPORTUNITY", "QUOTE_FOLLOW_UP",
  "FYI_NO_ACTION", "LOW_VALUE_ROUTINE", "NO_ACTION", "SPAM",
  "COLD_OUTREACH", "AMBIGUOUS"
];

/**
 * Look up a triage record by id.
 */
function getTriageEmail(id) {
  if (!id) return null;
  var rows = supaSelect("triage_emails", { eq: { id: String(id) }, limit: 1 });
  return rows && rows[0] ? rows[0] : null;
}

/**
 * Upsert a triage record (from n8n workflow).
 */
function saveTriageEmail(record) {
  if (!record || !record.id) return { ok: false, error: "Missing id" };
  return supaUpsert("triage_emails", [record], "id");
}

/**
 * Parse a triage email for structured data based on category.
 */
function parseTriageEmail(emailBody, subject, fromName, fromEmail, category) {
  var persona = loadPersona();
  var companyContext = persona.company_name
    ? "for " + persona.company_name + (persona.company_industry ? " (" + persona.company_industry + ")" : "")
    : "for the operator of this triage agent";

  var prompts = {
    "NEW_OPPORTUNITY":
      "Extract from this inbound sales inquiry email " + companyContext + ".\n" +
      "Return ONLY JSON: { \"contactName\":\"\", \"contactEmail\":\"\", \"organization\":\"\", \"application\":\"\", " +
      "\"product\":\"\", \"quantityAnnual\":\"\", \"deadline\":\"\", \"missingFields\":[] }. " +
      "missingFields lists which of: application, product, quantityAnnual, deadline are NOT found.",
    "VENDOR_RFQ_RESPONSE":
      "Extract pricing/BOM from this vendor response email " + companyContext + ".\n" +
      "Return ONLY JSON: { \"vendor\":\"\", \"lineItems\":[{\"partno\":\"\",\"description\":\"\",\"unitCost\":0,\"qty\":1,\"leadTime\":\"\"}], " +
      "\"notes\":\"\", \"validUntil\":\"\" }.",
    "CUSTOMER_QUOTE_RESPONSE":
      "Summarize this customer response to a quote " + companyContext + ".\n" +
      "Return ONLY JSON: { \"responseType\":\"interested|negotiating|rejected|requesting_info|approved\", " +
      "\"keyPoints\":\"\", \"questionsAsked\":\"\", \"nextAction\":\"\" }."
  };

  var prompt = (prompts[category] || prompts["NEW_OPPORTUNITY"])
    + "\n\nEmail subject: " + (subject || "")
    + "\nFrom: " + (fromName || "") + " <" + (fromEmail || "") + ">"
    + "\n\nEmail body:\n" + String(emailBody || "").substring(0, 3000)
    + "\n\nReturn only JSON, no markdown.";

  var r = claudeJson({ prompt: prompt, maxTokens: 1000 });
  return r.ok ? { ok: true, data: r.data } : r;
}

/**
 * Generate a draft reply for a specific triage email.
 * Voice rules come from persona at runtime (not hardcoded).
 */
function generateDraftForEmail(emailId) {
  if (!emailId) return { ok: false, error: "No email id" };
  var e = getTriageEmail(emailId);
  if (!e) return { ok: false, error: "Email record not found" };

  var persona = loadPersona();
  var system = personaContext(persona, persona.formality_default || "semi_formal");

  var prompt =
    "Draft a reply email.\n\n" +
    "Email being replied to:\n" +
    "From: " + (e.from_name || "") + " <" + (e.from_email || "") + ">\n" +
    "Subject: " + (e.subject || "") + "\n" +
    "Category: " + (e.category || "") + "\n" +
    "Body:\n" + String(e.email_body || "").substring(0, 4000) + "\n\n" +
    "Reply guidance by category:\n" +
    "- NEW_OPPORTUNITY: ask 1-2 specific clarifying questions (size, quantity, application, timeline, budget).\n" +
    "- CUSTOMER_QUOTE_RESPONSE: acknowledge briefly, ask the next question.\n" +
    "- VENDOR_RFQ_RESPONSE: confirm receipt, ask any missing pricing detail.\n" +
    "- ACTION_REQUIRED_*: respond to the substantive ask directly.\n" +
    "- LOW_VALUE_ROUTINE: short acknowledgement, propose next step.";

  var r = claudeCall({ system: system, prompt: prompt, maxTokens: 500 });
  if (!r.ok) return r;

  var draft = String(r.text || "").trim();
  supaUpdate("triage_emails", { id: emailId }, { draft_reply: draft });
  return { ok: true, draft: draft };
}

/**
 * Strip sender identity from an email body so it can be forwarded safely.
 * Used when forwarding a vendor quote / partner email and you do not want
 * to expose the original sender or your relationship with them.
 */
function sanitizeEmailForForward(body, fromName, fromEmail) {
  var prompt =
    "Rewrite this email body so it can be forwarded without exposing the original sender.\n\n" +
    "STRIP:\n" +
    "- Sender name, company name, email address, phone, signature block, branding/disclaimers\n" +
    "- Quoted/forwarded chain (anything after \"On ... wrote:\" or \"From: ... Sent: ...\" or \"-----Original Message-----\")\n" +
    "- Greetings containing the sender or recipient name\n" +
    "\nKEEP:\n" +
    "- Substantive content: specs, prices, lead times, model numbers, dates\n" +
    "- Questions and requests for information\n" +
    "- Technical details and answers\n" +
    "\nReturn the sanitized body as plain text only. No markdown, no JSON, no commentary.\n\n" +
    "Original sender (for context): " + (fromName || "") + " <" + (fromEmail || "") + ">\n\n" +
    "Original body:\n" + String(body || "").substring(0, 6000);

  var r = claudeCall({ prompt: prompt, maxTokens: 1500 });
  return r.ok ? { ok: true, sanitized: r.text } : r;
}

/**
 * Re-extract related_deal_hint on unactioned triage emails.
 * Only runs when CRM module enabled (deal hints have no meaning without deals).
 * Caps at MAX_PER_RUN per invocation to stay under Apps Script timeout.
 */
function refreshDealHintsOnUnactioned() {
  var modules = appConfigGet("modules") || {};
  if (!modules.crm) return { ok: false, error: "CRM module disabled" };

  var MAX_PER_RUN = 100;
  var emails = supaSelect("triage_emails", {
    eq: { resolved: false, dismissed: false },
    order: "received_at.desc",
    limit: MAX_PER_RUN
  });
  if (!emails || !emails.length) return { ok: true, processed: 0, updated: 0 };

  var processed = 0, updated = 0, skippedSame = 0, errors = 0;
  for (var i = 0; i < emails.length; i++) {
    var e = emails[i];
    if (e.linked_deal_id) continue;
    if (e.category === "SPAM" || e.category === "NO_ACTION") continue;
    processed++;

    var subject = String(e.subject || "");
    var body = String(e.email_body || "");
    var firstTwoLines = body.split(/\r?\n/).slice(0, 2).join("\n");

    var prompt =
      "Extract the strongest deal/project match-string from this email's subject and first 2 lines of body. " +
      "Look for: project/venue/property names, customer org names, product or model references, location plus project type, " +
      "quote/PO/RFQ numbers. Return ONLY the match-string with no other text, no quotes. " +
      "If nothing identifying, return an empty string.\n\n" +
      "Subject: " + subject + "\n\nBody (first 2 lines):\n" + firstTwoLines;

    var r = claudeCall({ prompt: prompt, maxTokens: 80 });
    if (!r.ok) { errors++; continue; }

    var newHint = String(r.text || "").trim().replace(/^["']|["']$/g, "").substring(0, 200);
    var existing = String(e.related_deal_hint || "");
    if (newHint === existing) { skippedSame++; continue; }

    try {
      supaUpdate("triage_emails", { id: e.id }, { related_deal_hint: newHint });
      updated++;
    } catch(err) { errors++; }
  }
  return { ok: true, processed: processed, updated: updated, skippedSame: skippedSame, errors: errors };
}

/**
 * Mark a triage email resolved / dismissed.
 */
function markTriageEmailResolved(id, resolved) {
  return supaUpdate("triage_emails", { id: id }, {
    resolved: !!resolved,
    dismissed: false,
    resolved_at: resolved ? new Date().toISOString() : null
  });
}

function markTriageEmailDismissed(id) {
  return supaUpdate("triage_emails", { id: id }, {
    dismissed: true,
    resolved: false,
    resolved_at: new Date().toISOString()
  });
}
