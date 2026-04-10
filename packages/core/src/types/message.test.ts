// packages/core/src/types/message.test.ts
import { describe, it, expect } from 'vitest';
import type { Message } from './message.js';

describe('Message type', () => {
  it('supports exclude field', () => {
    const msg: Message = {
      type: 'test',
      payload: {},
      timestamp: Date.now(),
      exclude: [65, 66],
    };
    expect(msg.exclude).toEqual([65, 66]);
  });

  it('exclude is optional', () => {
    const msg: Message = {
      type: 'test',
      payload: {},
      timestamp: Date.now(),
    };
    expect(msg.exclude).toBeUndefined();
  });
});
