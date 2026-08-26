/**
 * Browser-side protobuf decoder for WebSocket binary frames.
 * Mirrors the schema in packages/types/src/websocket.proto and the
 * backend codec at backend/src/websocket/codec.ts.
 * Uses only browser-native APIs (TextDecoder, Uint8Array) — no deps.
 */

export type DecodedWireMessage = {
  type: string;
  channel?: string;
  sequence?: number;
  sessionId?: string;
  emittedAt?: string;
  payload?: unknown;
};

// ---------------------------------------------------------------------------
// Protobuf primitives
// ---------------------------------------------------------------------------

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

const dec = new TextDecoder();

function decodeWireMessage(buf: Uint8Array): DecodedWireMessage {
  const pos = { offset: 0 };
  const msg: DecodedWireMessage = { type: '' };

  while (pos.offset < buf.length) {
    const t = readVarint(buf, pos);
    const fieldNumber = t >>> 3;
    const wireType = t & 0x7;

    if (wireType === 2) {
      // LEN — string, bytes, or embedded message
      const len = readVarint(buf, pos);
      const bytes = buf.slice(pos.offset, pos.offset + len);
      pos.offset += len;
      const str = dec.decode(bytes);
      if (fieldNumber === 1) msg.type = str;
      else if (fieldNumber === 2) msg.channel = str;
      else if (fieldNumber === 4) msg.sessionId = str;
      else if (fieldNumber === 5) msg.emittedAt = str;
      else if (fieldNumber === 6) {
        try { msg.payload = JSON.parse(str); } catch { msg.payload = str; }
      }
    } else if (wireType === 0) {
      // VARINT
      const val = readVarint(buf, pos);
      if (fieldNumber === 3) msg.sequence = val;
    } else {
      break; // unexpected wire type — stop
    }
  }
  return msg;
}

// ---------------------------------------------------------------------------
// Public API — decodes a WireMessageBatch binary frame
// ---------------------------------------------------------------------------

/**
 * Decodes an ArrayBuffer received from the server when binary protocol is active.
 * The server always encodes as WireMessageBatch (repeated field 1 = WireMessage).
 */
export function decodeServerBinary(data: ArrayBuffer): DecodedWireMessage[] {
  const buf = new Uint8Array(data);
  const messages: DecodedWireMessage[] = [];
  const pos = { offset: 0 };

  while (pos.offset < buf.length) {
    const t = readVarint(buf, pos);
    const fieldNumber = t >>> 3;
    const wireType = t & 0x7;

    if (wireType === 2 && fieldNumber === 1) {
      const len = readVarint(buf, pos);
      const msgBuf = buf.slice(pos.offset, pos.offset + len);
      pos.offset += len;
      messages.push(decodeWireMessage(msgBuf));
    } else {
      break;
    }
  }

  return messages;
}
