/**
 * Voice.gs
 * Learn-My-Voice: extract a persona from the user's Sent folder.
 * Supports Gmail (native via GmailApp) and Outlook / M365 (via Graph API).
 *
 * Flow:
 *   1. Pull last N sent messages from the user's mailbox.
 *   2. Strip quoted replies + signatures, keep only the user's own prose.
 *   3. Send the corpus to Claude with a structured extraction prompt.
 *   4. Save the returned voice profile to Supabase `persona` table.
 *
 * Called from the dashboard "Learn My Voice" button.
 */

var VOICE_SAMPLE_COUNT = 200;
var VOICE_MAX_BODY_CHARS = 1500;

function extractVoiceFromSent() {
  var c = getConfig();
  try {
    var samples = (c.emailProvider === "outlook")
      ? _pullSentOutlook(VOICE_SAMPLE_COUNT)
      : _pullSentGmail(VOICE_SAMPLE_COUNT);

    if (!samples || !samples.length) {
      return { ok: false, error: "No sent messages found. Send a few emails first, then try again." };
    }

    var cleaned = samples.map(_stripQuotesAndSignature).filter(function(s){ return s && s.length > 30; });
    if (cleaned.length < 5) {
      return { ok: false, error: "Not enough usable samples after cleaning (need at least 5)." };
    }

    var corpus = cleaned.slice(0, VOICE_SAMPLE_COUNT).map(function(s, i){
      return "--- Sample " + (i+1) + " ---\n" + s.substring(0, VOICE_MAX_BODY_CHARS);
    }).join("\n\n");

    var prompt =
      "Analyze the writing voice across these email samples. They are all written by the SAME person. " +
      "Extract the voice profile that lets another AI write new emails indistinguishable from this writer.\n\n" +
      "Return ONLY a JSON object with this exact shape:\n" +
      "{\n" +
      '  "voice_rules": [array of 5-10 short rules in imperative form, e.g. "Open with first name and comma on its own line"],\n' +
      '  "signature_phrases": [array of 0-8 distinctive phrases this writer uses repeatedly],\n' +
      '  "taboo_phrases": [array of 3-8 phrases this writer never uses, inferred from absence + style],\n' +
      '  "greeting_style": "first_name_comma" | "first_name_only" | "hi_first_name" | "dear_first_name" | "no_greeting",\n' +
      '  "signoffs": { "casual": "...", "semi_formal": "...", "formal": "..." },\n' +
      '  "sentence_length_target": "very_short" | "short" | "medium" | "long",\n' +
      '  "formality_default": "very_casual" | "casual" | "semi_formal" | "formal",\n' +
      '  "notes": "one or two sentences summarizing distinctive patterns"\n' +
      "}\n\n" +
      "Be specific.  Examples in voice_rules should reflect actual patterns visible in the samples, not generic advice.\n\n" +
      "Samples:\n" + corpus;

    var resp = claudeJson({ prompt: prompt, maxTokens: 1500 });
    if (!resp.ok) return resp;

    var profile = resp.data;
    var existing = loadPersona();
    var merged = Object.assign({}, existing, {
      voice_rules:             profile.voice_rules           || existing.voice_rules,
      signature_phrases:       profile.signature_phrases     || [],
      taboo_phrases:           profile.taboo_phrases         || existing.taboo_phrases,
      greeting_style:          profile.greeting_style        || existing.greeting_style,
      signoffs:                profile.signoffs              || existing.signoffs,
      sentence_length_target:  profile.sentence_length_target || existing.sentence_length_target,
      formality_default:       profile.formality_default     || existing.formality_default,
      learned_from_sent_folder: true,
      learned_at:              new Date().toISOString(),
      sample_count:            cleaned.length
    });
    savePersona(merged);

    return { ok: true, sampleCount: cleaned.length, profile: merged, notes: profile.notes || "" };
  } catch(e) {
    return { ok: false, error: e.toString() };
  }
}

function _pullSentGmail(n) {
  var threads = GmailApp.search("in:sent", 0, Math.min(n, 500));
  var bodies = [];
  for (var i = 0; i < threads.length && bodies.length < n; i++) {
    var msgs = threads[i].getMessages();
    for (var j = 0; j < msgs.length && bodies.length < n; j++) {
      var m = msgs[j];
      if (m.isInTrash() || m.isDraft()) continue;
      var from = String(m.getFrom() || "").toLowerCase();
      var owner = String(Session.getActiveUser().getEmail() || "").toLowerCase();
      if (owner && from.indexOf(owner) === -1) continue;
      bodies.push(m.getPlainBody());
    }
  }
  return bodies;
}

function _pullSentOutlook(n) {
  var token = getM365Token();
  if (!token) throw new Error("M365 not authorized. Authorize Outlook in Settings first.");
  var url = "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages" +
            "?$top=" + Math.min(n, 100) +
            "&$select=subject,body,bodyPreview,sentDateTime";
  var bodies = [];
  while (url && bodies.length < n) {
    var resp = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { "Authorization": "Bearer " + token },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      throw new Error("Graph " + resp.getResponseCode() + ": " + resp.getContentText().substring(0, 300));
    }
    var data = JSON.parse(resp.getContentText());
    (data.value || []).forEach(function(m){
      if (bodies.length < n) {
        var b = (m.body && m.body.content) ? m.body.content : (m.bodyPreview || "");
        b = b.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (b) bodies.push(b);
      }
    });
    url = data["@odata.nextLink"] || null;
  }
  return bodies;
}

/**
 * Strip quoted reply chains and signature blocks.  Heuristic, not perfect,
 * but good enough — Claude tolerates noise in the corpus.
 */
function _stripQuotesAndSignature(body) {
  if (!body) return "";
  var lines = String(body).split(/\r?\n/);
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var L = lines[i];
    if (/^On .+ wrote:\s*$/.test(L)) break;
    if (/^From:\s.+/i.test(L) && /Sent:\s/i.test(lines[i+1] || "")) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(L)) break;
    if (/^>/.test(L.trim())) continue;
    out.push(L);
  }
  var joined = out.join("\n").trim();
  joined = joined.replace(/(\n--\s*\n[\s\S]*$)/m, "");
  joined = joined.replace(/(\nSent from my (iPhone|iPad|Android)[\s\S]*$)/i, "");
  return joined.trim();
}
