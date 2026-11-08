import { pino, type Logger, type LoggerOptions } from 'pino';

export type { Logger };

// Logs carry IDs and statuses only. These keys hold message text, prompts or secrets, so they
// are removed if they ever reach a log call, at the top level or one object down.
const BODY_KEYS = ['body', 'text', 'prompt', 'messages', 'reply', 'content', 'apiKey'];
export const REDACT_PATHS = [...BODY_KEYS, ...BODY_KEYS.map((key) => `*.${key}`)];

// Cloud Logging reads `severity` from JSON lines.
const SEVERITY: Record<string, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

export function loggerOptions(level: string): LoggerOptions {
  return {
    level,
    base: { service: 'plent' },
    messageKey: 'message',
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, remove: true },
    formatters: {
      level: (label) => ({ severity: SEVERITY[label] ?? 'DEFAULT' }),
    },
  };
}

export function createLogger(level: string, destination?: pino.DestinationStream): Logger {
  return pino(loggerOptions(level), destination);
}
