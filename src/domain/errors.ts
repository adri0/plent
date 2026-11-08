// A rule the caller broke (unknown plant, note cap reached…). The agent's tools return these
// to the model as results, so messages are short and say what to do instead.
export type DomainErrorCode =
  'not_found' | 'invalid_input' | 'note_cap_reached' | 'plant_archived' | 'schedule_missing';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
