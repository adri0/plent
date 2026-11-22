import { generateText, isStepCount, type LanguageModel } from 'ai';

import type { Db } from '../db/client.ts';
import type { Household } from '../db/schema.ts';
import type { Person } from '../domain/households.ts';
import type { Message } from '../domain/messages.ts';
import { recordUsage } from '../domain/usage.ts';
import type { Logger } from '../ops/logger.ts';
import { buildContext } from './context.ts';
import { toWhatsApp } from './postprocess.ts';
import { SYSTEM_PROMPT } from './prompt.ts';
import { createTools, type ToolEffect } from './tools/index.ts';

// One agent call per trigger: build the context, let the model call tools for up to five
// steps, post-process its reply. Model errors are retried twice with backoff by the SDK;
// after that the caller gets a fixed fallback and marks the trigger failed.

export const MAX_STEPS = 5;
export const MAX_RETRIES = 2;
export const FALLBACK_REPLY =
  "Sorry, I couldn't work that out just now. Could you try again in a bit?";
// When the model ends with tool calls and no text: say what happened rather than nothing.
export const EMPTY_REPLY = 'Done.';

export interface AgentInput {
  household: Household;
  sender: Person;
  message: Message; // the stored trigger, with its text and what it quotes
  now: Temporal.Instant;
}

export interface AgentResult {
  status: 'ok' | 'failed';
  reply: string;
  effects: ToolEffect[];
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
}

export interface AgentDeps {
  db: Db;
  model: LanguageModel;
  logger: Logger;
  maxRetries?: number;
}

export interface Agent {
  handle(input: AgentInput): Promise<AgentResult>;
}

export function createAgent(deps: AgentDeps): Agent {
  return { handle: (input) => handle(deps, input) };
}

async function handle(deps: AgentDeps, input: AgentInput): Promise<AgentResult> {
  const { db, model, logger } = deps;
  const log = logger.child({ householdId: input.household.id, messageId: input.message.id });
  const context = await buildContext(db, input);
  const toolContext = {
    db,
    householdId: input.household.id,
    personId: input.sender.id,
    messageId: input.message.id,
    today: context.today,
    refs: context.refs,
    effects: [] as ToolEffect[],
    nextCallIndex: 0,
  };

  try {
    const result = await generateText({
      model,
      instructions: SYSTEM_PROMPT,
      prompt: context.prompt,
      tools: createTools(toolContext),
      stopWhen: isStepCount(MAX_STEPS),
      // The last step must answer in words, so the loop never ends on a bare tool call.
      prepareStep: ({ stepNumber }) => (stepNumber === MAX_STEPS - 1 ? { toolChoice: 'none' } : {}),
      // One call at a time, in the model's order: call indexes then match on a retry.
      toolCallConcurrency: 1,
      maxRetries: deps.maxRetries ?? MAX_RETRIES,
    });

    const usage = {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    };
    await recordUsage(db, input.household.id, context.today, {
      requests: result.steps.length,
      ...usage,
    });
    const reply = toWhatsApp(result.text);
    log.info(
      {
        steps: result.steps.length,
        tools: toolContext.effects.map((e) => `${e.tool}${e.ok ? '' : ':error'}`),
        finishReason: result.finishReason,
        ...usage,
      },
      'agent replied',
    );
    return {
      status: 'ok',
      reply: reply === '' ? EMPTY_REPLY : reply,
      effects: toolContext.effects,
      steps: result.steps.length,
      usage,
    };
  } catch (error) {
    log.error({ err: error, tools: toolContext.effects.map((e) => e.tool) }, 'agent failed');
    return {
      status: 'failed',
      reply: FALLBACK_REPLY,
      effects: toolContext.effects,
      steps: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
