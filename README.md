# plent

Ent, a plant care assistant that tracks household plants and sends daily care reminders.

## Development

Requires Node 26 (see `.node-version`) and Docker. With [Colima](https://github.com/abiosoft/colima) in
place of Docker Desktop:

```sh
colima start --vm-type vz --mount-type virtiofs --cpu 4 --memory 8
```

Colima shares only your home folder with its VM. If the checkout lives elsewhere (or behind a symlink
out of your home folder), add `--mount <folder>:w` for it, or `docker compose up` can't mount the repo.

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
| `npm run repl`             | Chat with the agent in the terminal (needs a model)  |
| `npm run eval`             | Run the eval suite against a model                   |

Source files import each other with `.ts` extensions: Node 26 runs TypeScript directly, and `tsc`
rewrites the extensions when it builds.

## Configuration

Environment variables, validated at startup by `src/config.ts` (see `.env.example`):

- `DATABASE_URL` (required), `NODE_ENV`, `LOG_LEVEL`, `GCP_PROJECT`.
- The agent's model, `MODEL_PROVIDER` and `MODEL_ID`, plus an optional `MODEL_BASE_URL`:
  - `vertex-anthropic` (Claude) or `vertex-google` (Gemini) go through Vertex AI with Application Default
    Credentials and `GCP_PROJECT`. Each model is served from its own `MODEL_LOCATION`, wherever Vertex
    offers it, independent of the app's region. Only EU locations (`eu`, `europe-west1`, …) are accepted
    unless `MODEL_ALLOW_NON_EU=true`.
  - `anthropic`, `google` or `openai` call the Anthropic, Gemini or OpenAI API directly with
    `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` or `OPENAI_API_KEY`, to test with a real model
    without GCP. They're refused in production.

  `npm run model:ping` sends the configured model one short prompt and prints the reply.

Logs are JSON lines with a Cloud Logging `severity`. They carry IDs and statuses, never message bodies:
`body`, `text`, `prompt` and similar keys are removed.

## The agent

`src/agent/` answers one trigger message at a time: it builds the context (household block with short
plant and note refs like `p1` and `n1`, the last 20 messages or 72 hours, the message and what it
quotes), lets the model call its nine tools for up to five steps, and post-processes the reply for
WhatsApp. Each tool call is recorded in `tool_calls` with its effect, so a retried trigger replays it
instead of running it twice. The system prompt is in `src/agent/prompt.ts`.

**REPL.** `npm run repl -- [--chat dev] [--as Anna] [--tz Europe/Warsaw]` chats with the agent through
the fake chat adapter, as a group household in the database at `DATABASE_URL` (activated on first
use). Type messages as the current sender; `/as <name>` switches sender, `/reply` quotes Ent's last
message with your next one, `/digest` sends today's reminder. Tool calls are shown under each reply.

**Evals.** `npm run eval` runs every scenario in `evals/scenarios/` three times on a scratch database
each; a scenario passes when two runs pass. Checks look at the database and the tool calls, never at
the wording. Options: `--model provider:id` (repeat to compare models; keys and locations come from the
usual variables), `--only name,name`, `--runs`, `--pass`, `--concurrency`. A JSON report goes to
`evals/results/`.
