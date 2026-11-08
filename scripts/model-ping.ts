// Sends one short prompt to the configured model and prints the reply, token counts and time.
// `npm run model:ping`, with the MODEL_* variables (and an API key or GCP credentials) set.
import { generateText } from 'ai';

import { createModel } from '../src/agent/model.ts';
import { loadConfig } from '../src/config.ts';

const { model, gcpProject } = loadConfig();
if (model === undefined) {
  console.error('No model configured: set MODEL_PROVIDER and MODEL_ID (see .env.example).');
  process.exit(1);
}

const where = 'location' in model ? ` @ ${model.location}` : ' (API key)';
console.log(`${model.provider} ${model.id}${where}`);

const started = performance.now();
const { text, usage } = await generateText({
  model: createModel(model, gcpProject),
  prompt: 'Name one houseplant that tolerates low light, in five words or fewer.',
});
const ms = Math.round(performance.now() - started);

console.log(`reply: ${text}`);
console.log(
  `tokens: ${String(usage.inputTokens)} in, ${String(usage.outputTokens)} out; ${String(ms)} ms`,
);
