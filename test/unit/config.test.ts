import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.ts';

const base = { DATABASE_URL: 'postgres://localhost/plent' };

describe('loadConfig', () => {
  it('applies defaults and leaves the model unset', () => {
    expect(loadConfig(base)).toEqual({
      env: 'development',
      logLevel: 'info',
      databaseUrl: 'postgres://localhost/plent',
      model: undefined,
    });
  });

  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/databaseUrl/);
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ ...base, LOG_LEVEL: 'loud' })).toThrow(/logLevel/);
  });

  it('reads a model with its own location', () => {
    const config = loadConfig({
      ...base,
      MODEL_PROVIDER: 'anthropic',
      MODEL_ID: 'claude-haiku-5-5',
      MODEL_LOCATION: 'eu',
    });
    expect(config.model).toEqual({
      provider: 'anthropic',
      id: 'claude-haiku-5-5',
      location: 'eu',
      baseUrl: undefined,
      allowNonEu: false,
    });
  });

  it('accepts EU regions other than the app region', () => {
    const config = loadConfig({
      ...base,
      MODEL_PROVIDER: 'google',
      MODEL_ID: 'gemini-3.5-flash',
      MODEL_LOCATION: 'europe-west1',
    });
    expect(config.model?.location).toBe('europe-west1');
  });

  it.each(['global', 'us', 'europe-west2', 'europe-west6'])(
    'rejects the non-EU location %s',
    (location) => {
      expect(() =>
        loadConfig({
          ...base,
          MODEL_PROVIDER: 'google',
          MODEL_ID: 'gemini-3.5-flash',
          MODEL_LOCATION: location,
        }),
      ).toThrow(/EU location/);
    },
  );

  it('allows a non-EU location with the explicit opt-in', () => {
    const config = loadConfig({
      ...base,
      MODEL_PROVIDER: 'google',
      MODEL_ID: 'gemini-3.5-flash',
      MODEL_LOCATION: 'global',
      MODEL_ALLOW_NON_EU: 'true',
    });
    expect(config.model?.location).toBe('global');
  });

  it('requires provider and location once a model is set', () => {
    expect(() => loadConfig({ ...base, MODEL_ID: 'claude-haiku-5-5' })).toThrow(
      /model\.provider[\s\S]*model\.location|model\.location[\s\S]*model\.provider/,
    );
  });
});
