import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

// Table types for Kysely, kept in step with src/db/migrations by hand.
// `date` and `time` columns are read as strings ('2026-11-12', '09:00:00'); see client.ts.

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;
type DateString = ColumnType<string, string, string>;

export type HouseholdStatus = 'pending' | 'active' | 'inactive' | 'deactivated';
export type ChatKind = 'dm' | 'group';
export type IdType = 'pn' | 'lid';
export type PlantStatus = 'active' | 'archived';
export type TaskType = 'water' | 'fertilize' | 'mist' | 'repot' | 'rotate' | 'prune';
export type CareAction = 'done' | 'skipped';
export type MessageDirection = 'in' | 'out';
export type MessageKind = 'trigger' | 'reply' | 'digest' | 'system';
export type MessageStatus =
  'received' | 'processing' | 'done' | 'failed' | 'skipped_stale' | 'pending' | 'sent';
export type ReminderRunStatus = 'sent' | 'nothing_due' | 'missed_window' | 'paused';

export interface HouseholdsTable {
  id: Generated<string>;
  status: ColumnType<HouseholdStatus, HouseholdStatus | undefined, HouseholdStatus>;
  timezone: ColumnType<string, string | undefined, string>;
  reminder_time: ColumnType<string, string | undefined, string>;
  language: ColumnType<string, string | undefined, string>;
  daily_llm_cap: ColumnType<number, number | undefined, number>;
  reminders_paused_at: NullableTimestamp;
  activated_at: NullableTimestamp;
  created_at: Timestamp;
}

export interface ChatsTable {
  id: Generated<string>;
  household_id: string;
  channel: string;
  external_id: string;
  kind: ChatKind;
  created_at: Timestamp;
}

export interface PeopleTable {
  id: Generated<string>;
  display_name: string;
  is_admin: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Timestamp;
}

export interface IdentitiesTable {
  channel: string;
  external_id: string;
  id_type: IdType;
  person_id: string;
}

export interface MembershipsTable {
  household_id: string;
  person_id: string;
  joined_at: Timestamp;
}

export interface ActivationCodesTable {
  code_hash: string;
  created_by: string | null;
  household_id: string | null;
  expires_at: ColumnType<Date, Date | string, Date | string>;
  used_at: NullableTimestamp;
  created_at: Timestamp;
}

export interface PlantsTable {
  id: Generated<string>;
  household_id: string;
  name: string;
  species: string | null;
  room: string | null;
  status: ColumnType<PlantStatus, PlantStatus | undefined, PlantStatus>;
  archived_reason: string | null;
  archived_at: NullableTimestamp;
  created_at: Timestamp;
}

export interface CareSchedulesTable {
  id: Generated<string>;
  plant_id: string;
  task_type: TaskType;
  interval_days: number;
  next_due: DateString;
  active: ColumnType<boolean, boolean | undefined, boolean>;
  updated_at: Timestamp;
}

export interface CareEventsTable {
  id: Generated<string>;
  plant_id: string;
  person_id: string | null;
  task_type: TaskType;
  action: CareAction;
  occurred_on: DateString;
  recheck_in_days: number | null;
  source_message_id: string | null;
  created_at: Timestamp;
}

export interface PlantNotesTable {
  id: Generated<string>;
  household_id: string;
  plant_id: string | null;
  body: string;
  created_by: string | null;
  source_message_id: string | null;
  created_at: Timestamp;
  resolved_at: NullableTimestamp;
}

export interface MessagesTable {
  id: Generated<string>;
  chat_id: string;
  external_id: string | null;
  direction: MessageDirection;
  kind: MessageKind;
  sender_person_id: string | null;
  body: string | null;
  payload: unknown;
  quoted_message_id: string | null;
  reply_to_id: string | null;
  status: MessageStatus;
  attempts: ColumnType<number, number | undefined, number>;
  started_at: NullableTimestamp;
  created_at: Timestamp;
}

export interface ToolCallsTable {
  message_id: string;
  call_index: number;
  tool: string;
  args: unknown;
  result: unknown;
  created_at: Timestamp;
}

export interface ReminderRunsTable {
  household_id: string;
  local_date: DateString;
  status: ReminderRunStatus;
  message_id: string | null;
  created_at: Timestamp;
}

export interface LlmUsageTable {
  household_id: string;
  day: DateString;
  requests: ColumnType<number, number | undefined, number>;
  input_tokens: ColumnType<number, number | undefined, number>;
  output_tokens: ColumnType<number, number | undefined, number>;
}

export interface WaAuthStateTable {
  key: string;
  value_encrypted: Buffer;
  updated_at: Timestamp;
}

export interface CryptoKeysTable {
  name: string;
  wrapped_dek: Buffer;
  kms_key: string;
  created_at: Timestamp;
}

export interface Database {
  households: HouseholdsTable;
  chats: ChatsTable;
  people: PeopleTable;
  identities: IdentitiesTable;
  memberships: MembershipsTable;
  activation_codes: ActivationCodesTable;
  plants: PlantsTable;
  care_schedules: CareSchedulesTable;
  care_events: CareEventsTable;
  plant_notes: PlantNotesTable;
  messages: MessagesTable;
  tool_calls: ToolCallsTable;
  reminder_runs: ReminderRunsTable;
  llm_usage: LlmUsageTable;
  wa_auth_state: WaAuthStateTable;
  crypto_keys: CryptoKeysTable;
}

export type Household = Selectable<HouseholdsTable>;
export type NewHousehold = Insertable<HouseholdsTable>;
export type HouseholdUpdate = Updateable<HouseholdsTable>;
export type Plant = Selectable<PlantsTable>;
export type NewPlant = Insertable<PlantsTable>;
export type PlantUpdate = Updateable<PlantsTable>;
export type CareSchedule = Selectable<CareSchedulesTable>;
export type CareEvent = Selectable<CareEventsTable>;
export type PlantNote = Selectable<PlantNotesTable>;
export type Message = Selectable<MessagesTable>;
export type NewMessage = Insertable<MessagesTable>;
