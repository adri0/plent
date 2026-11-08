import type { Scenario } from '../harness.ts';
import { ADVERSARIAL_SCENARIOS } from './adversarial.ts';
import { FLOW_SCENARIOS } from './flows.ts';

export const SCENARIOS: Scenario[] = [...FLOW_SCENARIOS, ...ADVERSARIAL_SCENARIOS];
