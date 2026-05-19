-- Seed defaults — runs after initial schema.
-- Safe to re-run (idempotent).

-- Default pipeline stages (used by optional CRM module)
insert into stages (type, position, name) values
  ('opportunity', 1, 'Lead'),
  ('opportunity', 2, 'New Opp'),
  ('opportunity', 3, 'Vendor RFQ'),
  ('opportunity', 4, 'Quoted'),
  ('opportunity', 5, 'Proto / Demo'),
  ('opportunity', 6, 'Production'),
  ('opportunity', 7, 'Projects'),
  ('project', 1, 'Planning'),
  ('project', 2, 'In Progress'),
  ('project', 3, 'Review'),
  ('project', 4, 'Complete')
on conflict (type, position) do update set name = excluded.name;

-- Default app_config feature flags
insert into app_config (key, value) values
  ('modules', '{"email_core": true, "crm": false, "audio_notes": true, "meeting_notes": true}'::jsonb),
  ('triage_settings', '{"self_forward_audio_route": true, "default_nudge_cadence_days": 14}'::jsonb)
on conflict (key) do nothing;

-- Default persona row (generic professional)
insert into persona (id, version, voice_rules, taboo_phrases, signoffs, greeting_style, sentence_length_target, formality_default, learned_from_sent_folder)
values (
  1,
  1,
  '[
    "Direct and concise. Default reply length is 2-4 sentences. Write more only when genuinely needed.",
    "Use the recipient first name as greeting on its own line, followed by a comma.",
    "Avoid corporate filler: never open with I hope this email finds you well or similar.",
    "Avoid hedging phrases like Please do not hesitate to or I would like to take this opportunity.",
    "Plain text only by default. No bullet points or bold unless the content genuinely needs structure.",
    "Ask one focused question per message when a question is needed.",
    "Polite but not effusive."
  ]'::jsonb,
  '[
    "I hope this email finds you well",
    "Please do not hesitate to",
    "At your earliest convenience",
    "I would like to take this opportunity"
  ]'::jsonb,
  '{
    "casual":      "Thanks,\n{{OWNER_FIRST_NAME}}",
    "semi_formal": "Thanks,\n{{OWNER_NAME}}",
    "formal":      "Best regards,\n{{OWNER_NAME}}\n{{OWNER_TITLE}}\n{{COMPANY_NAME}}"
  }'::jsonb,
  'first_name_comma',
  'short',
  'semi_formal',
  false
)
on conflict (id) do nothing;
