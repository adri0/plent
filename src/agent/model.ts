import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import type { LanguageModel } from 'ai';

import type { Config, ModelConfig } from '../config.ts';

// Builds the agent's model from config. Vertex models use Application Default Credentials;
// the API-key providers are for local testing without GCP.
export function createModel(model: ModelConfig, gcpProject: Config['gcpProject']): LanguageModel {
  const baseURL = model.baseUrl === undefined ? {} : { baseURL: model.baseUrl };
  const project = gcpProject === undefined ? {} : { project: gcpProject };
  switch (model.provider) {
    case 'vertex-anthropic':
      return createVertexAnthropic({ ...project, location: model.location, ...baseURL })(model.id);
    case 'vertex-google':
      return createVertex({ ...project, location: model.location, ...baseURL })(model.id);
    case 'anthropic':
      return createAnthropic({ apiKey: model.apiKey, ...baseURL })(model.id);
    case 'google':
      return createGoogleGenerativeAI({ apiKey: model.apiKey, ...baseURL })(model.id);
  }
}
