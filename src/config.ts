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

const modelSchema = z
  .object({
    // Each model is served from wherever Vertex offers it, independent of the app's region.
    provider: z.enum(['anthropic', 'google']),
    id: z.string().min(1),
    location: z.string().min(1),
    baseUrl: z.url().optional(),
    allowNonEu: z.boolean(),
  })
  .refine((m) => m.allowNonEu || EU_LOCATIONS.has(m.location), {
    message: 'must be an EU location (set MODEL_ALLOW_NON_EU=true to override)',
    path: ['location'],
  });

const configSchema = z.object({
  env: z.enum(['development', 'test', 'production']),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  databaseUrl: z.string().min(1),
  gcpProject: z.string().min(1).optional(),
  // Unset until the agent needs it, so the database and domain work run without a model.
  model: modelSchema.optional(),
});

export type Config = z.infer<typeof configSchema>;
export type ModelConfig = z.infer<typeof modelSchema>;

const envBool = z.stringbool().default(false);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const model =
    env.MODEL_ID === undefined
      ? undefined
      : {
          provider: env.MODEL_PROVIDER,
          id: env.MODEL_ID,
          location: env.MODEL_LOCATION,
          baseUrl: env.MODEL_BASE_URL,
          allowNonEu: envBool.parse(env.MODEL_ALLOW_NON_EU),
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
