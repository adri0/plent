import { MockLanguageModelV4 } from 'ai/test';

// A model that plays back a script, one entry per step: tool calls or a text reply. Its
// `doGenerateCalls` keep what the agent sent at each step (prompt, tools, tool choice).

export type ScriptStep =
  | { text: string }
  | { calls: { tool: string; input: Record<string, unknown> }[] }
  | { error: Error };

type GenerateResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;

const USAGE: GenerateResult['usage'] = {
  inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

export function scriptedModel(steps: ScriptStep[]): MockLanguageModelV4 {
  let index = 0;
  let callId = 0;
  return new MockLanguageModelV4({
    doGenerate: () => {
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      if (step === undefined) throw new Error('scriptedModel: empty script');
      if ('error' in step) return Promise.reject(step.error);
      if ('text' in step) {
        return Promise.resolve({
          content: [{ type: 'text', text: step.text }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: USAGE,
          warnings: [],
        });
      }
      return Promise.resolve({
        content: step.calls.map((call) => ({
          type: 'tool-call' as const,
          toolCallId: `call-${String(++callId)}`,
          toolName: call.tool,
          input: JSON.stringify(call.input),
        })),
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage: USAGE,
        warnings: [],
      });
    },
  });
}
