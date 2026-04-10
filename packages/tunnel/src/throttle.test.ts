// src/throttle.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Throttle } from './throttle.js';

describe('Throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes immediately when interval has passed', () => {
    const onFlush = vi.fn();
    const throttle = new Throttle(1000, onFlush);

    // Advance past the interval so first message is "immediate"
    vi.advanceTimersByTime(1001);
    throttle.push('msg1');

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith(['msg1']);
  });

  it('buffers messages within interval and flushes at boundary', () => {
    const onFlush = vi.fn();
    const throttle = new Throttle(1000, onFlush);

    // First message — immediate (lastSendTime starts at -Infinity)
    throttle.push('msg1');
    expect(onFlush).toHaveBeenCalledTimes(1);

    // Second message within interval — buffered
    vi.advanceTimersByTime(200);
    throttle.push('msg2');
    expect(onFlush).toHaveBeenCalledTimes(1);

    // Third message still within interval — buffered
    vi.advanceTimersByTime(200);
    throttle.push('msg3');
    expect(onFlush).toHaveBeenCalledTimes(1);

    // Interval elapses — flush buffer
    vi.advanceTimersByTime(600);
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenLastCalledWith(['msg2', 'msg3']);
  });

  it('does not flush when buffer is empty', () => {
    const onFlush = vi.fn();
    const _throttle = new Throttle(1000, onFlush);

    vi.advanceTimersByTime(5000);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('cleans up on destroy', () => {
    const onFlush = vi.fn();
    const throttle = new Throttle(1000, onFlush);

    throttle.push('msg1');
    expect(onFlush).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(200);
    throttle.push('msg2');
    throttle.destroy();

    vi.advanceTimersByTime(2000);
    // msg2 was buffered but destroy should have flushed
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenLastCalledWith(['msg2']);
  });
});
