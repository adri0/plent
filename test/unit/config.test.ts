import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.ts';

const base = { DATABASE_URL: 'postgres://localhost/plent' };
const vertex = { ...base, GCP_PROJECT: 'plent-dev', MODEL_ID: 'gemini-3.5-flash' };

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

  describe('Vertex models', () => {
    it('read a model with its own location', () => {
      const config = loadConfig({
        ...vertex,
        MODEL_PROVIDER: 'vertex-anthropic',
        MODEL_ID: 'claude-haiku-5-5',
        MODEL_LOCATION: 'eu',
      });
      expect(config.model).toEqual({
        provider: 'vertex-anthropic',
        id: 'claude-haiku-5-5',
        location: 'eu',
        allowNonEu: false,
      });
    });

    it('accept EU regions other than the app region', () => {
      const config = loadConfig({
        ...vertex,
        MODEL_PROVIDER: 'vertex-google',
        MODEL_LOCATION: 'europe-west1',
      });
      expect(config.model).toMatchObject({ location: 'europe-west1' });
    });

    it.each(['global', 'us', 'europe-west2', 'europe-west6'])(
      'reject the non-EU location %s',
      (location) => {
        expect(() =>
          loadConfig({ ...vertex, MODEL_PROVIDER: 'vertex-google', MODEL_LOCATION: location }),
        ).toThrow(/EU location/);
      },
    );

    it('allow a non-EU location with the explicit opt-in', () => {
      const config = loadConfig({
        ...vertex,
        MODEL_PROVIDER: 'vertex-google',
        MODEL_LOCATION: 'global',
        MODEL_ALLOW_NON_EU: 'true',
      });
      expect(config.model).toMatchObject({ location: 'global' });
    });

    it('require a location', () => {
      expect(() => loadConfig({ ...vertex, MODEL_PROVIDER: 'vertex-google' })).toThrow(
        /model\.location/,
      );
    });

    it('require GCP_PROJECT', () => {
      expect(() =>
        loadConfig({
          ...base,
          MODEL_PROVIDER: 'vertex-google',
          MODEL_ID: 'gemini-3.5-flash',
          MODEL_LOCATION: 'eu',
        }),
      ).toThrow(/gcpProject/);
    });
  });

  describe('API-key models', () => {
    it('read the Anthropic key', () => {
      const config = loadConfig({
        ...base,
        MODEL_PROVIDER: 'anthropic',
        MODEL_ID: 'claude-haiku-5-5',
        ANTHROPIC_API_KEY: 'sk-ant-test',
        GOOGLE_GENERATIVE_AI_API_KEY: 'unused',
      });
      expect(config.model).toEqual({
        provider: 'anthropic',
        id: 'claude-haiku-5-5',
        apiKey: 'sk-ant-test',
      });
    });

    it('read the Gemini key', () => {
      const config = loadConfig({
        ...base,
        MODEL_PROVIDER: 'google',
        MODEL_ID: 'gemini-3.5-flash',
        GOOGLE_GENERATIVE_AI_API_KEY: 'gm-test',
      });
      expect(config.model).toMatchObject({ provider: 'google', apiKey: 'gm-test' });
    });

    it('read the OpenAI key', () => {
      const config = loadConfig({
        ...base,
        MODEL_PROVIDER: 'openai',
        MODEL_ID: 'gpt-5-mini',
        OPENAI_API_KEY: 'sk-test',
        ANTHROPIC_API_KEY: 'unused',
      });
      expect(config.model).toEqual({ provider: 'openai', id: 'gpt-5-mini', apiKey: 'sk-test' });
    });

    it('need no GCP project or location', () => {
      const config = loadConfig({
        ...base,
        MODEL_PROVIDER: 'anthropic',
        MODEL_ID: 'claude-haiku-5-5',
        ANTHROPIC_API_KEY: 'sk-ant-test',
      });
      expect(config.gcpProject).toBeUndefined();
    });

    it('require the key', () => {
      expect(() =>
        loadConfig({ ...base, MODEL_PROVIDER: 'anthropic', MODEL_ID: 'claude-haiku-5-5' }),
      ).toThrow(/model\.apiKey/);
    });

    it('are refused in production', () => {
      expect(() =>
        loadConfig({
          ...base,
          NODE_ENV: 'production',
          MODEL_PROVIDER: 'anthropic',
          MODEL_ID: 'claude-haiku-5-5',
          ANTHROPIC_API_KEY: 'sk-ant-test',
        }),
      ).toThrow(/production uses Vertex/);
    });
  });

  it('rejects an unknown provider', () => {
    expect(() => loadConfig({ ...base, MODEL_PROVIDER: 'mistral', MODEL_ID: 'x' })).toThrow(
      /model\.provider/,
    );
  });
});
