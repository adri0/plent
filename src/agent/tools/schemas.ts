import { z } from 'zod';

import type { TaskType } from '../../db/schema.ts';
import { isIsoDate, type IsoDate } from '../../domain/dates.ts';
import { DomainError } from '../../domain/errors.ts';
import { TASK_TYPES } from '../../domain/plants.ts';

// Input pieces the tools share. Schemas stay loose on ranges and formats: the tools check
// those themselves and answer with an error that says what to fix, so the model can retry.

export const taskType = z
  .enum(['water', 'fertilize', 'mist', 'repot', 'rotate', 'prune'] satisfies TaskType[])
  .describe(`one of ${TASK_TYPES.join(', ')}`);

export const plantRef = z.string().describe('a plant ref from the context, e.g. p1');
export const noteRef = z.string().describe('a note ref from the context, e.g. n1');
export const isoDate = z.string().describe('a date as YYYY-MM-DD');
export const days = z.number().describe('whole days, 1 to 366');

export function checkDate(value: string, field: string): IsoDate {
  if (!isIsoDate(value)) throw new DomainError('invalid_input', `${field} must be YYYY-MM-DD`);
  return value;
}
