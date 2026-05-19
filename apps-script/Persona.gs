/**
 * Persona.gs
 * Voice profile management.  The persona drives every Claude prompt that
 * writes in the user's voice (drafts, nudges, intake emails).
 *
 * Bootstrap: the persona row is seeded by 20260518000002_seed_defaults.sql
 * with a generic professional default.  The user can later run
 * extractVoiceFromSent() to replace it with one learned from their own
 * Sent folder.
 */

function loadPersona() {
  try {
    var rows = supaSelect("persona", { order: "id.asc", limit: 1 });
    return (rows && rows[0]) || _genericPersona();
  } catch(e) {
    Logger.log("loadPersona error: " + e);
    return _genericPersona();
  }
}

function savePersona(persona) {
  persona.id = 1;
  persona.updated_at = new Date().toISOString();
  return supaUpsert("persona", [persona], "id");
}

function _genericPersona() {
  return {
    id: 1,
    owner_name: "",
    owner_title: "",
    company_name: "",
    company_industry: "",
    voice_rules: [
      "Direct and concise. Default reply length is 2-4 sentences.",
      "First-name greeting on its own line followed by a comma, or skip greeting entirely.",
      "Avoid corporate filler.",
      "Plain text only."
    ],
    signature_phrases: [],
    taboo_phrases: [
      "I hope this email finds you well",
      "Please do not hesitate to",
      "At your earliest convenience"
    ],
    signoffs: {
      casual:      "Thanks,",
      semi_formal: "Thanks,",
      formal:      "Best regards,"
    },
    greeting_style: "first_name_comma",
    sentence_length_target: "short",
    formality_default: "semi_formal",
    learned_from_sent_folder: false
  };
}

/**
 * Build the system-prompt context block injected into every voice-driven
 * Claude call.  Pure formatter — no Claude call here.
 */
function personaContext(persona, tone) {
  persona = persona || loadPersona();
  tone = tone || persona.formality_default || "semi_formal";

  var firstName = String(persona.owner_name || "").split(" ")[0] || "";
  var signoff = (persona.signoffs && persona.signoffs[tone]) || "Thanks,";
  signoff = signoff
    .replace(/\{\{OWNER_FIRST_NAME\}\}/g, firstName)
    .replace(/\{\{OWNER_NAME\}\}/g, persona.owner_name || "")
    .replace(/\{\{OWNER_TITLE\}\}/g, persona.owner_title || "")
    .replace(/\{\{COMPANY_NAME\}\}/g, persona.company_name || "");

  var lines = [];
  lines.push("You are drafting an email on behalf of:");
  if (persona.owner_name)       lines.push("- Name: " + persona.owner_name);
  if (persona.owner_title)      lines.push("- Title: " + persona.owner_title);
  if (persona.company_name)     lines.push("- Company: " + persona.company_name);
  if (persona.company_industry) lines.push("- What the company does: " + persona.company_industry);
  lines.push("");
  lines.push("VOICE RULES (mandatory):");
  (persona.voice_rules || []).forEach(function(r){ lines.push("- " + r); });
  if ((persona.taboo_phrases || []).length) {
    lines.push("");
    lines.push("NEVER use these phrases:");
    persona.taboo_phrases.forEach(function(p){ lines.push("- " + p); });
  }
  if ((persona.signature_phrases || []).length) {
    lines.push("");
    lines.push("PHRASES THIS WRITER USES NATURALLY (use when they fit, do not force):");
    persona.signature_phrases.forEach(function(p){ lines.push("- " + p); });
  }
  lines.push("");
  lines.push("Tone for this email: " + tone);
  lines.push("Sign off exactly with:\n" + signoff);
  lines.push("");
  lines.push("Return ONLY the email body. No subject. No markdown. No commentary.");
  return lines.join("\n");
}
