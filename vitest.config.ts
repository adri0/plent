import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['test/unit/**/*.test.ts', 'src/**/*.test.ts'] } },
      // Needs Postgres at DATABASE_URL (`docker compose up -d postgres`).
      { test: { name: 'integration', include: ['test/integration/**/*.test.ts'] } },
    ],
  },
});
