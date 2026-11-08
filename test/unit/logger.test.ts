import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from '../../src/ops/logger.ts';

function capture(): { lines: () => Record<string, unknown>[]; stream: Writable } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const lines = () =>
    chunks
      .join('')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { lines, stream };
}

describe('logger', () => {
  it('writes JSON with severity, service and message', () => {
    const { lines, stream } = capture();
    createLogger('info', stream).warn({ messageId: 'm1' }, 'retrying');
    expect(lines()[0]).toMatchObject({
      severity: 'WARNING',
      service: 'plent',
      message: 'retrying',
      messageId: 'm1',
    });
  });

  it('drops message bodies, at the top level and one object down', () => {
    const { lines, stream } = capture();
    createLogger('info', stream).info(
      { messageId: 'm1', body: 'water the pothos', message: { id: 'm2', text: 'hi' } },
      'stored',
    );
    const line = lines()[0];
    expect(line).not.toHaveProperty('body');
    expect(line).toMatchObject({ messageId: 'm1', message: 'stored' });
    expect(JSON.stringify(line)).not.toContain('pothos');
  });
});
