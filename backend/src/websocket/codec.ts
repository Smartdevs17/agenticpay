/**
 * Minimal protobuf-compatible binary codec for WebSocket wire messages.
 * Implements the schema defined in packages/types/src/websocket.proto.
 * No external dependencies — encodes/decodes using the protobuf binary format
 * spec so messages are interoperable with any standard protobuf decoder.
 */
import type { WebSocketWireMessage } from './types.js';

// ---------------------------------------------------------------------------
// Protobuf primitives
// ---------------------------------------------------------------------------

function writeVarint(out: number[], value: number): void {
  let v = value >>> 0;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
}

function readVarint(buf: Uint8Array, pos: { offset: number }): number {
  let result = 0;
  let shift = 0;
  while (pos.offset < buf.length) {
    const byte = buf[pos.offset++];
    result |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) break;
    shift += 7;
  }
  return result >>> 0;
}

// wire types
const VARINT = 0;
const LEN = 2;

function tag(field: number, wireType: number): number {
  return (field << 3) | wireType;
}

function encodeString(out: number[], field: number, value: string): void {
  if (!value) return;
  const encoded = Buffer.from(value, 'utf8');
  writeVarint(out, tag(field, LEN));
  writeVarint(out, encoded.length);
  for (const b of encoded) out.push(b);
}

function encodeUint32(out: number[], field: number, value: number): void {
  if (value === 0) return;
  writeVarint(out, tag(field, VARINT));
  writeVarint(out, value);
}

function encodeBytes(out: number[], field: number, value: Buffer): void {
  if (value.length === 0) return;
  writeVarint(out, tag(field, LEN));
  writeVarint(out, value.length);
  for (const b of value) out.push(b);
}

// ---------------------------------------------------------------------------
// WireMessage encoder (fields match websocket.proto)
// ---------------------------------------------------------------------------

export function encodeWireMessage(msg: WebSocketWireMessage): Buffer {
  const out: number[] = [];
  encodeString(out, 1, msg.type);
  if (msg.channel) encodeString(out, 2, msg.channel);
  encodeUint32(out, 3, msg.sequence);
  encodeString(out, 4, msg.sessionId);
  encodeString(out, 5, msg.emittedAt);
  if (msg.payload !== undefined) {
    encodeBytes(out, 6, Buffer.from(JSON.stringify(msg.payload), 'utf8'));
  }
  return Buffer.from(out);
}

// ---------------------------------------------------------------------------
// WireMessageBatch encoder — always wraps messages in repeated field 1
// ---------------------------------------------------------------------------

export function encodeBatch(msgs: WebSocketWireMessage[]): Buffer {
  const out: number[] = [];
  for (const msg of msgs) {
    const encoded = encodeWireMessage(msg);
    writeVarint(out, tag(1, LEN));
    writeVarint(out, encoded.length);
    for (const b of encoded) out.push(b);
  }
  return Buffer.from(out);
}

// ---------------------------------------------------------------------------
// ClientMessage decoder (server receives from binary-mode clients)
// ---------------------------------------------------------------------------

export function decodeClientMessage(
  data: Buffer,
): { type: string; channels: string[]; expiresAt?: string } | null {
  try {
    const pos = { offset: 0 };
    let type: string | undefined;
    const channels: string[] = [];
    let expiresAt: string | undefined;

    while (pos.offset < data.length) {
      const t = readVarint(data, pos);
      const fieldNumber = t >>> 3;
      const wireType = t & 0x7;
      if (wireType === LEN) {
        const len = readVarint(data, pos);
        const str = data.slice(pos.offset, pos.offset + len).toString('utf8');
        pos.offset += len;
        if (fieldNumber === 1) type = str;
        else if (fieldNumber === 2) channels.push(str);
        else if (fieldNumber === 3) expiresAt = str;
      } else {
        break; // unsupported wire type — stop parsing
      }
    }

    if (!type) return null;
    return { type, channels, expiresAt };
  } catch {
    return null;
  }
}
