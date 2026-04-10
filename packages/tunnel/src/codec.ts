import { gzipSync, gunzipSync } from 'node:zlib';

const MAGIC = 'WST1';  // magic header: WebSocket Tunnel v1

/** Encode an array of WS message strings into a single base64 blob with magic header */
export function encode(messages: string[]): string {
  const json = JSON.stringify(messages);
  const compressed = gzipSync(Buffer.from(json, 'utf-8'));
  return MAGIC + compressed.toString('base64');
}

/** Decode a base64 blob back into an array of WS message strings. Returns null on invalid data. */
export function decode(encoded: string): string[] | null {
  if (!encoded.startsWith(MAGIC)) {
    return null;
  }

  try {
    const compressed = Buffer.from(encoded.slice(MAGIC.length), 'base64');
    const json = gunzipSync(compressed).toString('utf-8');
    return JSON.parse(json) as string[];
  } catch {
    return null;
  }
}

export interface Chunk {
  d: string;   // data
  c: string;   // chunk index
  t: string;   // total chunks
}

/** Split a base64 string into chunks of maxSize characters */
export function chunk(data: string, maxSize: number): Chunk[] {
  if (data.length <= maxSize) {
    return [{ d: data, c: '0', t: '1' }];
  }

  const totalChunks = Math.ceil(data.length / maxSize);
  const chunks: Chunk[] = [];
  for (let i = 0; i < totalChunks; i++) {
    chunks.push({
      d: data.slice(i * maxSize, (i + 1) * maxSize),
      c: String(i),
      t: String(totalChunks),
    });
  }
  return chunks;
}

/** Reassemble chunks back into the original string */
export function reassemble(chunks: Chunk[]): string {
  const sorted = [...chunks].sort((a, b) => Number(a.c) - Number(b.c));
  return sorted.map((c) => c.d).join('');
}
