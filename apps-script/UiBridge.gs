/**
 * UiBridge.gs
 * Thin functions the dashboard UI calls via google.script.run.
 * Keeps the heavy logic in domain files and the UI surface small.
 */

function listInboxForUi(filter) {
  filter = filter || "open";
  var q = { order: "received_at.desc", limit: 200 };
  if (filter === "open") {
    q.eq = { resolved: false, dismissed: false };
  } else if (filter === "action") {
    q.in = { category: ["ACTION_REQUIRED_DRAFT","ACTION_REQUIRED_KEITH"] };
  } else if (filter === "opportunity") {
    q.in = { category: ["NEW_OPPORTUNITY","QUOTE_FOLLOW_UP","CUSTOMER_QUOTE_RESPONSE"] };
  } else if (filter === "vendor") {
    q.in = { category: ["VENDOR_RFQ_RESPONSE"] };
  }
  return supaSelect("triage_emails", q) || [];
}
