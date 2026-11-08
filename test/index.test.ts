import { describe, expect, it } from 'vitest';

import { BOT_NAME } from '../src/index.js';

describe('index', () => {
  it('names the bot Ent', () => {
    expect(BOT_NAME).toBe('Ent');
  });
});
