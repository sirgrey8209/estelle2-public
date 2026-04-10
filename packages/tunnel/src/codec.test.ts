import { describe, it, expect } from 'vitest';
import { encode, decode, chunk, reassemble } from './codec.js';

describe('encode/decode', () => {
  it('round-trips a single message', () => {
    const messages = ['{"type":"ping"}'];
    const encoded = encode(messages);
    expect(typeof encoded).toBe('string');
    const decoded = decode(encoded);
    expect(decoded).toEqual(messages);
  });

  it('round-trips multiple messages', () => {
    const messages = [
      '{"type":"claude_event","payload":"hello"}',
      '{"type":"ping"}',
      '{"type":"claude_send","payload":"world"}',
    ];
    const encoded = encode(messages);
    const decoded = decode(encoded);
    expect(decoded).toEqual(messages);
  });

  it('handles empty array', () => {
    const encoded = encode([]);
    const decoded = decode(encoded);
    expect(decoded).toEqual([]);
  });

  it('compresses large payloads', () => {
    const big = 'x'.repeat(10000);
    const messages = [big];
    const encoded = encode(messages);
    expect(encoded.length).toBeLessThan(big.length);
    expect(decode(encoded)).toEqual(messages);
  });

  it('starts with magic header WST1', () => {
    const encoded = encode(['test']);
    expect(encoded.startsWith('WST1')).toBe(true);
  });

  it('handles Korean text', () => {
    const messages = ['{"content":"안녕하세요 주인님"}'];
    const encoded = encode(messages);
    expect(decode(encoded)).toEqual(messages);
  });

  it('handles emoji', () => {
    const messages = ['{"icon":"🚀","text":"배포 완료 ✅"}'];
    const encoded = encode(messages);
    expect(decode(encoded)).toEqual(messages);
  });

  it('handles mixed unicode and special characters', () => {
    const messages = [
      '{"jp":"日本語テスト","emoji":"👨‍💻","special":"\\n\\t\\r\\0"}',
      '{"math":"∑∏∫","arrows":"←→↑↓"}',
    ];
    const encoded = encode(messages);
    expect(decode(encoded)).toEqual(messages);
  });

  it('handles empty string message', () => {
    const messages = ['', '{"type":"ping"}', ''];
    const encoded = encode(messages);
    expect(decode(encoded)).toEqual(messages);
  });

  it('handles very large batch of messages', () => {
    const messages = Array.from({ length: 100 }, (_, i) =>
      `{"seq":${i},"data":"${'a'.repeat(200)}"}`
    );
    const encoded = encode(messages);
    expect(decode(encoded)).toEqual(messages);
  });

  it('preserves message order', () => {
    const messages = ['first', 'second', 'third', 'fourth', 'fifth'];
    const encoded = encode(messages);
    const decoded = decode(encoded);
    expect(decoded).toEqual(messages);
  });
});

describe('decode error handling', () => {
  it('returns null for data without magic header', () => {
    expect(decode('notvaliddata')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(decode('')).toBeNull();
  });

  it('returns null for corrupted base64 after magic header', () => {
    expect(decode('WST1!!!notbase64!!!')).toBeNull();
  });

  it('returns null for valid base64 but not gzip after magic header', () => {
    expect(decode('WST1aGVsbG8=')).toBeNull();
  });

  it('returns null for truncated data', () => {
    const encoded = encode(['test message']);
    const truncated = encoded.slice(0, encoded.length - 10);
    expect(decode(truncated)).toBeNull();
  });

  it('returns null for magic header only', () => {
    expect(decode('WST1')).toBeNull();
  });
});

describe('chunk/reassemble', () => {
  it('returns single chunk for small data', () => {
    const data = 'short';
    const chunks = chunk(data, 1000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ d: 'short', c: '0', t: '1' });
  });

  it('splits large data into multiple chunks', () => {
    const data = 'a'.repeat(100);
    const chunks = chunk(data, 30);
    expect(chunks.length).toBeGreaterThan(1);
    const reassembled = reassemble(chunks);
    expect(reassembled).toBe(data);
  });

  it('reassembles chunks in any order', () => {
    const data = 'a'.repeat(100);
    const chunks = chunk(data, 30);
    const shuffled = [...chunks].reverse();
    const reassembled = reassemble(shuffled);
    expect(reassembled).toBe(data);
  });

  it('preserves magic header through chunk/reassemble', () => {
    const encoded = encode(['{"type":"ping"}', '한글 메시지']);
    const chunks = chunk(encoded, 30);
    const reassembled = reassemble(chunks);
    expect(reassembled).toBe(encoded);
    expect(decode(reassembled)).toEqual(['{"type":"ping"}', '한글 메시지']);
  });

  it('handles exact boundary splits', () => {
    const data = 'abcdef';
    const chunks = chunk(data, 3);
    expect(chunks).toHaveLength(2);
    expect(reassemble(chunks)).toBe('abcdef');
  });
});

describe('full pipeline: encode → chunk → reassemble → decode', () => {
  it('round-trips through chunking', () => {
    const messages = Array.from({ length: 50 }, (_, i) =>
      `{"seq":${i},"payload":"${'x'.repeat(100)}"}`
    );
    const encoded = encode(messages);
    const chunks = chunk(encoded, 100);
    expect(chunks.length).toBeGreaterThan(1);

    const reassembled = reassemble(chunks);
    const decoded = decode(reassembled);
    expect(decoded).toEqual(messages);
  });
});
