import { z } from 'zod';

// Vertex locations that keep processing inside EU member states: the `eu` multi-region
// endpoint and the regions in EU countries (not London's europe-west2 or Zurich's europe-west6).
export const EU_LOCATIONS: ReadonlySet<string> = new Set([
  'eu',
  'europe-central2',
  'europe-north1',
  'europe-north2',
  'europe-southwest1',
  'europe-west1',
  'europe-west3',
  'europe-west4',
  'europe-west8',
  'europe-west9',
  'europe-west10',
  'europe-west12',
]);

// Through Vertex AI (GCP credentials): each model is served from wherever Vertex offers it,
// independent of the app's region.
const vertexModelSchema = z
  .object({
    provider: z.enum(['vertex-anthropic', 'vertex-google']),
    id: z.string().min(1),
    location: z.string().min(1),
    baseUrl: z.url().optional(),
    allowNonEu: z.boolean(),
  })
  .refine((m) => m.allowNonEu || EU_LOCATIONS.has(m.location), {
    message: 'must be an EU location (set MODEL_ALLOW_NON_EU=true to override)',
    path: ['location'],
  });

// Straight to the Anthropic or Gemini API with an API key, for local testing without GCP.
// No data residency, so never in production.
const apiModelSchema = z.object({
  provider: z.enum(['anthropic', 'google']),
  id: z.string().min(1),
  apiKey: z
    .string({ error: 'set ANTHROPIC_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY' })
    .min(1, 'set ANTHROPIC_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY'),
  baseUrl: z.url().optional(),
});

const modelSchema = z.discriminatedUnion('provider', [vertexModelSchema, apiModelSchema]);

const configSchema = z
  .object({
    env: z.enum(['development', 'test', 'production']),
    logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
    databaseUrl: z.string().min(1),
    gcpProject: z.string().min(1).optional(),
    // Unset until the agent needs it, so the database and domain work run without a model.
    model: modelSchema.optional(),
  })
  .superRefine((c, ctx) => {
    if (c.model === undefined) return;
    if (c.model.provider.startsWith('vertex-') && c.gcpProject === undefined) {
      ctx.addIssue({ code: 'custom', message: 'required for Vertex models', path: ['gcpProject'] });
    }
    if (!c.model.provider.startsWith('vertex-') && c.env === 'production') {
      ctx.addIssue({
        code: 'custom',
        message: 'API-key providers are for local testing; production uses Vertex',
        path: ['model', 'provider'],
      });
    }
  });

export type Config = z.infer<typeof configSchema>;
export type ModelConfig = z.infer<typeof modelSchema>;

const envBool = z.stringbool().default(false);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Every field is passed; the provider's schema keeps the ones it uses.
  const model =
    env.MODEL_ID === undefined
      ? undefined
      : {
          provider: env.MODEL_PROVIDER,
          id: env.MODEL_ID,
          location: env.MODEL_LOCATION,
          baseUrl: env.MODEL_BASE_URL,
          allowNonEu: envBool.parse(env.MODEL_ALLOW_NON_EU),
          apiKey:
            env.MODEL_PROVIDER === 'google'
              ? env.GOOGLE_GENERATIVE_AI_API_KEY
              : env.ANTHROPIC_API_KEY,
        };

  const result = configSchema.safeParse({
    env: env.NODE_ENV ?? 'development',
    logLevel: env.LOG_LEVEL ?? 'info',
    databaseUrl: env.DATABASE_URL,
    gcpProject: env.GCP_PROJECT,
    model,
  });
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
