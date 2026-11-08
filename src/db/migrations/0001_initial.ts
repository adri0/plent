import { sql, type Kysely } from 'kysely';

// The full MVP schema from the design doc. gen_random_uuid() is built into Postgres 13+,
// so the design's `create extension pgcrypto` is left out (Cloud SQL's IAM user may not
// be allowed to create extensions).

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    -- Households and people
    create table households (
      id                  uuid primary key default gen_random_uuid(),
      status              text not null default 'pending'
                          check (status in ('pending','active','inactive','deactivated')),
      timezone            text not null default 'UTC',
      reminder_time       time not null default '09:00',
      language            text not null default 'en',
      daily_llm_cap       int  not null default 200,
      reminders_paused_at timestamptz,
      activated_at        timestamptz,
      created_at          timestamptz not null default now()
    );

    create table chats (
      id           uuid primary key default gen_random_uuid(),
      household_id uuid not null references households on delete cascade,
      channel      text not null,
      external_id  text not null,
      kind         text not null check (kind in ('dm','group')),
      created_at   timestamptz not null default now(),
      unique (channel, external_id)
    );

    create table people (
      id           uuid primary key default gen_random_uuid(),
      display_name text not null,
      is_admin     boolean not null default false,
      created_at   timestamptz not null default now()
    );

    create table identities (
      channel     text not null,
      external_id text not null,
      id_type     text not null check (id_type in ('pn','lid')),
      person_id   uuid not null references people on delete cascade,
      primary key (channel, external_id)
    );

    create table memberships (
      household_id uuid not null references households on delete cascade,
      person_id    uuid not null references people on delete cascade,
      joined_at    timestamptz not null default now(),
      primary key (household_id, person_id)
    );

    create table activation_codes (
      code_hash    text primary key,
      created_by   uuid references people on delete set null,
      household_id uuid references households on delete set null,
      expires_at   timestamptz not null,
      used_at      timestamptz,
      created_at   timestamptz not null default now()
    );

    -- Plants and care
    create table plants (
      id              uuid primary key default gen_random_uuid(),
      household_id    uuid not null references households on delete cascade,
      name            text not null,
      species         text,
      room            text,
      status          text not null default 'active' check (status in ('active','archived')),
      archived_reason text,
      archived_at     timestamptz,
      created_at      timestamptz not null default now()
    );

    create table care_schedules (
      id            uuid primary key default gen_random_uuid(),
      plant_id      uuid not null references plants on delete cascade,
      task_type     text not null
                    check (task_type in ('water','fertilize','mist','repot','rotate','prune')),
      interval_days int  not null check (interval_days > 0),
      next_due      date not null,
      active        boolean not null default true,
      updated_at    timestamptz not null default now(),
      unique (plant_id, task_type)
    );

    create table care_events (
      id                uuid primary key default gen_random_uuid(),
      plant_id          uuid not null references plants on delete cascade,
      person_id         uuid references people on delete set null,
      task_type         text not null,
      action            text not null check (action in ('done','skipped')),
      occurred_on       date not null,
      recheck_in_days   int,
      source_message_id uuid,
      created_at        timestamptz not null default now()
    );

    create table plant_notes (
      id                uuid primary key default gen_random_uuid(),
      household_id      uuid not null references households on delete cascade,
      plant_id          uuid references plants on delete cascade,
      body              text not null,
      created_by        uuid references people on delete set null,
      source_message_id uuid,
      created_at        timestamptz not null default now(),
      resolved_at       timestamptz
    );

    -- Messages, queue and idempotency
    create table messages (
      id                uuid primary key default gen_random_uuid(),
      chat_id           uuid not null references chats on delete cascade,
      external_id       text,
      direction         text not null check (direction in ('in','out')),
      kind              text not null check (kind in ('trigger','reply','digest','system')),
      sender_person_id  uuid references people on delete set null,
      body              text,
      payload           jsonb,
      quoted_message_id uuid references messages on delete set null,
      reply_to_id       uuid references messages on delete set null,
      status            text not null check (status in
                        ('received','processing','done','failed','skipped_stale','pending','sent')),
      attempts          int not null default 0,
      started_at        timestamptz,
      created_at        timestamptz not null default now(),
      unique (chat_id, external_id)
    );
    create index messages_open on messages (created_at)
      where status in ('received','processing','pending');

    create table tool_calls (
      message_id uuid not null references messages on delete cascade,
      call_index int  not null,
      tool       text not null,
      args       jsonb not null,
      result     jsonb,
      created_at timestamptz not null default now(),
      primary key (message_id, call_index)
    );

    -- Reminders and usage
    create table reminder_runs (
      household_id uuid not null references households on delete cascade,
      local_date   date not null,
      status       text not null check (status in ('sent','nothing_due','missed_window','paused')),
      message_id   uuid references messages on delete set null,
      created_at   timestamptz not null default now(),
      primary key (household_id, local_date)
    );

    create table llm_usage (
      household_id  uuid not null references households on delete cascade,
      day           date not null,
      requests      int not null default 0,
      input_tokens  int not null default 0,
      output_tokens int not null default 0,
      primary key (household_id, day)
    );

    -- WhatsApp session (encrypted, see the design's Security section)
    create table wa_auth_state (
      key             text primary key,
      value_encrypted bytea not null,
      updated_at      timestamptz not null default now()
    );

    create table crypto_keys (
      name        text primary key,
      wrapped_dek bytea not null,
      kms_key     text not null,
      created_at  timestamptz not null default now()
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop table crypto_keys, wa_auth_state, llm_usage, reminder_runs, tool_calls, messages,
      plant_notes, care_events, care_schedules, plants, activation_codes, memberships,
      identities, people, chats, households;
  `.execute(db);
}
