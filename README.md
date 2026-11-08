# plent

Ent, a plant care WhatsApp bot that tracks household plants and sends daily care reminders.

## Development

Requires Node 26 (see `.node-version`) and Docker.

```sh
npm ci
cp .env.example .env              # then adjust
docker compose up                 # Postgres, then migrations to the latest schema
```

`docker compose up -d postgres` starts only the database; `npm run db:migrate` migrates it from the host
(`npm run db:migrate -- down` rolls back one migration).

| Command                    | What it does                                         |
| -------------------------- | ---------------------------------------------------- |
| `npm run lint`             | ESLint (typescript-eslint strict, type-checked)      |
| `npm run format:check`     | Prettier check (`npm run format` to fix)             |
| `npm run typecheck`        | `tsc --noEmit`                                       |
| `npm test`                 | Unit tests                                           |
| `npm run test:integration` | Integration tests against Postgres at `DATABASE_URL` |
| `npm run build`            | Compile `src/` to `dist/`                            |

Source files import each other with `.ts` extensions: Node 26 runs TypeScript directly, and `tsc`
rewrites the extensions when it builds.

## Configuration

Environment variables, validated at startup by `src/config.ts` (see `.env.example`):

- `DATABASE_URL` (required), `NODE_ENV`, `LOG_LEVEL`, `GCP_PROJECT`.
- The agent's model: `MODEL_PROVIDER` (`anthropic` or `google`), `MODEL_ID` and `MODEL_LOCATION`, plus an
  optional `MODEL_BASE_URL`. Each model is served from its own Vertex location, wherever Vertex offers it,
  independent of the app's region. Only EU locations (`eu`, `europe-west1`, …) are accepted unless
  `MODEL_ALLOW_NON_EU=true`.

Logs are JSON lines with a Cloud Logging `severity`. They carry IDs and statuses, never message bodies:
`body`, `text`, `prompt` and similar keys are removed.
