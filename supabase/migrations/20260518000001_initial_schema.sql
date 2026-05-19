-- Email Triage Agent — initial schema
-- Postgres 15+ (Supabase). Run via `supabase db push` from the installer.

set client_min_messages = warning;

-- ============================================================================
-- Persona (voice profile)
-- ============================================================================
create table if not exists persona (
  id              bigserial primary key,
  version         int not null default 1,
  owner_name      text,
  owner_title     text,
  company_name    text,
  company_industry text,
  voice_rules         jsonb not null default '[]'::jsonb,
  signature_phrases   jsonb not null default '[]'::jsonb,
  taboo_phrases       jsonb not null default '[]'::jsonb,
  signoffs            jsonb not null default '{}'::jsonb,
  greeting_style          text default 'first_name_comma',
  sentence_length_target  text default 'short',
  formality_default       text default 'semi_formal',
  learned_from_sent_folder bool default false,
  learned_at      timestamptz,
  sample_count    int default 0,
  updated_at      timestamptz default now()
);

-- ============================================================================
-- Triage emails (heart of email-core)
-- ============================================================================
create table if not exists triage_emails (
  id                  text primary key,
  message_id          text,
  thread_id           text,
  conversation_id     text,
  from_name           text,
  from_email          text,
  to_email            text,
  subject             text,
  email_body          text,
  received_at         timestamptz,
  category            text,
  priority            text,
  is_real_person      bool,
  spam_confidence     numeric,
  requires_decision   bool,
  sensitivity_flag    bool,
  flag_reason         text,
  summary             text,
  recommended_action  text,
  draft_reply         text,
  routing_label       text,
  follow_up_step      text,
  potential_org       text,
  potential_contact   text,
  related_deal_hint   text,
  no_action_reason    text,
  linked_deal_id      text,
  resolved            bool default false,
  dismissed           bool default false,
  resolved_at         timestamptz,
  parsed_data         jsonb,
  raw_payload         jsonb,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index if not exists idx_triage_received     on triage_emails (received_at desc);
create index if not exists idx_triage_thread       on triage_emails (thread_id);
create index if not exists idx_triage_conversation on triage_emails (conversation_id);
create index if not exists idx_triage_unresolved
  on triage_emails (received_at desc)
  where resolved = false and dismissed = false;
create index if not exists idx_triage_category
  on triage_emails (category, received_at desc);

-- ============================================================================
-- Spam rules (loaded into the triage prompt at runtime)
-- ============================================================================
create table if not exists spam_rules (
  id          bigserial primary key,
  rule_type   text not null check (rule_type in ('domain', 'keyword', 'sender')),
  pattern     text not null,
  reason      text,
  created_at  timestamptz default now()
);
create unique index if not exists idx_spam_pattern on spam_rules (rule_type, pattern);

-- ============================================================================
-- Known contacts (whitelist - never SPAM/COLD_OUTREACH)
-- ============================================================================
create table if not exists contacts (
  id            bigserial primary key,
  email         text unique not null,
  name          text,
  org           text,
  is_internal   bool default false,
  notes         text,
  last_seen_at  timestamptz,
  created_at    timestamptz default now()
);
create index if not exists idx_contacts_org on contacts (org);

-- ============================================================================
-- Triage learning (corrections feed the prompt)
-- ============================================================================
create table if not exists triage_learning (
  id                   bigserial primary key,
  email_id             text references triage_emails(id) on delete set null,
  from_email           text,
  subject              text,
  original_category    text,
  corrected_category   text,
  notes                text,
  created_at           timestamptz default now()
);
create index if not exists idx_learning_from on triage_learning (from_email);

-- ============================================================================
-- Nudge state (auto-nudge customers/vendors)
-- ============================================================================
create table if not exists nudge_state (
  id              bigserial primary key,
  target_type     text not null check (target_type in ('customer', 'vendor', 'deal')),
  target_id       text not null,
  target_email    text,
  target_name     text,
  related_subject text,
  last_nudged_at  timestamptz,
  next_nudge_at   timestamptz,
  nudge_count     int default 0,
  cadence_days    int default 14,
  paused          bool default false,
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_nudge_next on nudge_state (next_nudge_at) where paused = false;
create unique index if not exists idx_nudge_target on nudge_state (target_type, target_id);

-- ============================================================================
-- App config (feature flags + dynamic settings)
-- ============================================================================
create table if not exists app_config (
  key         text primary key,
  value       jsonb,
  updated_at  timestamptz default now()
);

-- ============================================================================
-- CRM module (optional; tables created but only used when crm module enabled)
-- ============================================================================
create table if not exists stages (
  id        bigserial primary key,
  type      text not null,
  position  int not null,
  name      text not null
);
create unique index if not exists idx_stages_type_pos on stages (type, position);

create table if not exists tasks (
  id                text primary key,
  type              text default 'opportunity',
  title             text,
  org               text,
  contact           text,
  contact_email     text,
  stage             text,
  diagonal          text,
  resolution        text,
  touch             text,
  notes             text,
  active            bool default true,
  crm               jsonb,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  last_activity_at  timestamptz
);
create index if not exists idx_tasks_stage on tasks (stage);
create index if not exists idx_tasks_active on tasks (active, last_activity_at desc);

create table if not exists archived_tasks (like tasks including all);
create table if not exists deleted_tasks  (like tasks including all);

-- ============================================================================
-- Audit log (debugging + soft recovery)
-- ============================================================================
create table if not exists audit_log (
  id          bigserial primary key,
  table_name  text not null,
  row_id      text,
  action      text not null,
  diff        jsonb,
  user_email  text,
  created_at  timestamptz default now()
);
create index if not exists idx_audit_table_time on audit_log (table_name, created_at desc);

-- ============================================================================
-- updated_at trigger
-- ============================================================================
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare
  t text;
begin
  foreach t in array array['triage_emails','tasks','persona','nudge_state','app_config']
  loop
    execute format('drop trigger if exists trg_%I_updated on %I', t, t);
    execute format('create trigger trg_%I_updated before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end$$;

-- ============================================================================
-- Row-Level Security
-- Each user runs their own Supabase project, so RLS is defense-in-depth.
-- Service role (used by Apps Script) bypasses RLS automatically.
-- Anon role is denied by default (no policies created).
-- ============================================================================
alter table persona          enable row level security;
alter table triage_emails    enable row level security;
alter table spam_rules       enable row level security;
alter table contacts         enable row level security;
alter table triage_learning  enable row level security;
alter table nudge_state      enable row level security;
alter table app_config       enable row level security;
alter table stages           enable row level security;
alter table tasks            enable row level security;
alter table archived_tasks   enable row level security;
alter table deleted_tasks    enable row level security;
alter table audit_log        enable row level security;
