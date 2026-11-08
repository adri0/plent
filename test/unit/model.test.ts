import { describe, expect, it } from 'vitest';

import { createModel } from '../../src/agent/model.ts';
import type { ModelConfig } from '../../src/config.ts';

// Building a model makes no request, so no credentials are needed here.
describe('createModel', () => {
  it.each<[ModelConfig, string]>([
    [
      { provider: 'vertex-anthropic', id: 'claude-haiku-5-5', location: 'eu', allowNonEu: false },
      'googleVertex.anthropic',
    ],
    [
      { provider: 'vertex-google', id: 'gemini-3.5-flash', location: 'eu', allowNonEu: false },
      'google.vertex',
    ],
    [{ provider: 'anthropic', id: 'claude-haiku-5-5', apiKey: 'test-key' }, 'anthropic'],
    [{ provider: 'google', id: 'gemini-3.5-flash', apiKey: 'test-key' }, 'google'],
  ])('builds %o', (config, provider) => {
    const model = createModel(config, 'plent-dev');
    expect(model).toMatchObject({ modelId: config.id });
    expect(typeof model === 'object' && model.provider).toContain(provider);
  });
});
