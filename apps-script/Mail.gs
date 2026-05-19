/**
 * Mail.gs
 * Provider-agnostic email send.  Routes to Gmail or Outlook based on
 * config.emailProvider.  Both providers handle text + HTML.
 */

function sendEmail(to, subject, body, opts) {
  opts = opts || {};
  var c = getConfig();
  if (c.emailProvider === "outlook") return _sendOutlook(to, subject, body, opts);
  return _sendGmail(to, subject, body, opts);
}

function _sendGmail(to, subject, body, opts) {
  try {
    var options = {
      name: opts.fromName || "",
      cc:   opts.cc || "",
      bcc:  opts.bcc || ""
    };
    if (opts.html) options.htmlBody = opts.html;
    GmailApp.sendEmail(to, subject || "(no subject)", body || "", options);
    return { ok: true, provider: "gmail" };
  } catch(e) {
    return { ok: false, error: e.toString(), provider: "gmail" };
  }
}

function _sendOutlook(to, subject, body, opts) {
  try {
    var token = getM365Token();
    if (!token) return { ok: false, error: "M365 not authorized" };
    var msg = {
      message: {
        subject: subject || "(no subject)",
        body: { contentType: opts.html ? "HTML" : "Text", content: opts.html || body || "" },
        toRecipients: [{ emailAddress: { address: to } }]
      }
    };
    if (opts.cc)  msg.message.ccRecipients  = [{ emailAddress: { address: opts.cc  } }];
    if (opts.bcc) msg.message.bccRecipients = [{ emailAddress: { address: opts.bcc } }];

    var resp = UrlFetchApp.fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "post",
      contentType: "application/json",
      headers: { "Authorization": "Bearer " + token },
      payload: JSON.stringify(msg),
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code === 202 || code === 200) return { ok: true, provider: "outlook" };
    return { ok: false, error: "Graph HTTP " + code + ": " + resp.getContentText().substring(0, 300), provider: "outlook" };
  } catch(e) {
    return { ok: false, error: e.toString(), provider: "outlook" };
  }
}

/**
 * M365 OAuth2 helpers — only used when emailProvider = "outlook".
 * Requires OAuth2 library (linked in appsscript.json).
 */
function getM365Token() {
  var svc = getM365Service();
  return svc.hasAccess() ? svc.getAccessToken() : null;
}

function getM365Service() {
  var c = getConfig();
  return OAuth2.createService("microsoft")
    .setAuthorizationBaseUrl("https://login.microsoftonline.com/common/oauth2/v2.0/authorize")
    .setTokenUrl("https://login.microsoftonline.com/common/oauth2/v2.0/token")
    .setClientId(c.m365ClientId)
    .setClientSecret(c.m365ClientSecret)
    .setCallbackFunction("authCallback")
    .setPropertyStore(PropertiesService.getUserProperties())
    .setScope("https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read offline_access")
    .setParam("response_type", "code");
}

function authCallback(request) {
  var svc = getM365Service();
  var ok = svc.handleCallback(request);
  return HtmlService.createHtmlOutput(ok ? "Outlook authorized. You can close this tab." : "Authorization failed.");
}

function getAuthUrl() {
  return getM365Service().getAuthorizationUrl();
}
