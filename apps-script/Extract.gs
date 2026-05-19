/**
 * Extract.gs
 * Structured-data extraction helpers.
 * BOM extraction from vendor emails, deal extraction from inbound mail,
 * meeting-notes parsing for action items + deal references.
 */

function extractBOMFromText(text) {
  var prompt =
    "Extract part numbers, costs/prices, and lead times from this text.\n" +
    "Return ONLY a valid JSON object: {\"items\":[{\"partno\":\"...\",\"desc\":\"...\",\"cost\":\"...\",\"leadTime\":\"...\"}]}.\n" +
    "If no items found return {\"items\":[]}.\n\nText: " + String(text || "").substring(0, 4000);
  var r = claudeJson({ prompt: prompt, maxTokens: 600 });
  return r.ok ? { ok: true, data: r.data } : r;
}

function extractDealFromEmail(body, dealName) {
  var prompt =
    "Extract deal information from this email body for a deal called \"" + (dealName || "") + "\".\n\n" +
    "Email body:\n" + String(body || "").substring(0, 3000) + "\n\n" +
    "Return ONLY JSON with these fields:\n" +
    "- org: company/customer name\n" +
    "- contact: contact person name\n" +
    "- contactEmail: contact email address\n" +
    "- product: product or item being discussed\n" +
    "- specifications: key technical specs as a single string (max 200 chars)\n" +
    "- quantity: quantity mentioned, or empty\n" +
    "- timeline: timeline/deadline mentioned, or empty\n" +
    "- notes: everything else relevant (max 500 chars)\n" +
    "- subject: original email subject if visible";
  var r = claudeJson({ prompt: prompt, maxTokens: 600 });
  return r.ok ? { ok: true, data: r.data } : r;
}

function parseMeetingNotes(body) {
  var prompt =
    "Parse these meeting notes and extract structured data.\n\n" +
    "Meeting notes:\n" + String(body || "").substring(0, 4000) + "\n\n" +
    "Return ONLY JSON with:\n" +
    "- deals: array of objects, each with:\n" +
    "    - dealHint: name or partial name of existing deal discussed\n" +
    "    - org: company/customer name\n" +
    "    - notes: summary of what was discussed for this deal (max 300 chars)\n" +
    "    - actionItems: array of action item strings\n" +
    "    - newDeal: if a new opportunity was discovered, the deal name (otherwise null)\n" +
    "- summary: one sentence summary of the meeting";
  var r = claudeJson({ prompt: prompt, maxTokens: 1000 });
  return r.ok ? { ok: true, data: r.data } : r;
}
