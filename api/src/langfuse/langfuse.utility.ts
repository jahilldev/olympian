import type { LangfuseEvent, ParsedSpan } from './langfuse.model.js';
import { SESSION_ID_KEYS } from './langfuse.model.js';

/**
 * Minimal protobuf binary reader covering wire types 0/1/2/5.
 * Sufficient to decode OTLP ExportTraceServiceRequest payloads.
 */
class ProtoReader {
  private pos = 0;

  constructor(private readonly buf: Buffer) {}

  isAtEnd(): boolean {
    return this.pos >= this.buf.length;
  }

  readVarint(): bigint {
    let result = 0n;
    let shift = 0n;

    while (this.pos < this.buf.length) {
      const byte = this.buf[this.pos++] as number;

      result |= BigInt(byte & 0x7f) << shift;

      if ((byte & 0x80) === 0) {
        break;
      }

      shift += 7n;
    }

    return result;
  }

  readFixed64LE(): bigint {
    const lo = this.buf.readUInt32LE(this.pos);
    const hi = this.buf.readUInt32LE(this.pos + 4);

    this.pos += 8;

    return (BigInt(hi) << 32n) | BigInt(lo);
  }

  readBytes(): Buffer {
    const len = Number(this.readVarint());
    const slice = this.buf.subarray(this.pos, this.pos + len);

    this.pos += len;

    return Buffer.from(slice);
  }

  readString(): string {
    return this.readBytes().toString('utf8');
  }

  readTag(): { field: number; wire: number } {
    const tag = Number(this.readVarint());

    return { field: tag >>> 3, wire: tag & 0x7 };
  }

  skip(wire: number): void {
    switch (wire) {
      case 0:
        this.readVarint();

        break;
      case 1:
        this.pos += 8;

        break;
      case 2:
        this.readBytes();

        break;
      case 5:
        this.pos += 4;

        break;
      default:
        throw new Error(`Unknown wire type ${wire}`);
    }
  }
}

/** Parse a single KeyValue message → { key, value } or null if malformed. */
function parseKeyValue(buf: Buffer): { key: string; value: unknown } | null {
  const r = new ProtoReader(buf);

  let key: string | undefined;
  let value: unknown;

  while (!r.isAtEnd()) {
    const { field, wire } = r.readTag();

    if (field === 1 && wire === 2) {
      key = r.readString();
    } else if (field === 2 && wire === 2) {
      value = parseAnyValue(r.readBytes());
    } else {
      r.skip(wire);
    }
  }

  return key !== undefined ? { key, value } : null;
}

/** Parse an AnyValue message, returning the contained primitive. */
function parseAnyValue(buf: Buffer): unknown {
  const r = new ProtoReader(buf);

  while (!r.isAtEnd()) {
    const { field, wire } = r.readTag();

    switch (field) {
      case 1: // string_value
        if (wire === 2) {
          return r.readString();
        }

        break;
      case 2: // bool_value
        if (wire === 0) {
          return r.readVarint() !== 0n;
        }

        break;
      case 3: // int_value
        if (wire === 0) {
          return Number(r.readVarint());
        }

        break;
      case 4: // double_value (wire type 1, 8 bytes) — not needed for session extraction
        r.skip(wire);

        break;
      default:
        r.skip(wire);
    }
  }
  return undefined;
}

/** Collect repeated KeyValue entries from a span/resource attributes list. */
function collectAttributes(spans: Buffer[]): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};

  for (const kv of spans) {
    const parsed = parseKeyValue(kv);

    if (parsed) {
      attrs[parsed.key] = parsed.value;
    }
  }

  return attrs;
}

/** Parse a single Span message. */
function parseSpan(buf: Buffer): ParsedSpan {
  const r = new ProtoReader(buf);
  const attrBufs: Buffer[] = [];
  const span: Partial<ParsedSpan> = { kind: 0, startNs: 0n, endNs: 0n };

  while (!r.isAtEnd()) {
    const { field, wire } = r.readTag();

    switch (field) {
      case 1:
        span.traceId = r.readBytes().toString('hex');

        break;
      case 2:
        span.spanId = r.readBytes().toString('hex');

        break;
      case 4:
        span.parentSpanId = r.readBytes().toString('hex');

        break;
      case 5:
        span.name = r.readString();

        break;
      case 6:
        span.kind = Number(r.readVarint());

        break;
      case 7:
        span.startNs = r.readFixed64LE();

        break;
      case 8:
        span.endNs = r.readFixed64LE();

        break;
      case 9:
        attrBufs.push(r.readBytes());

        break;
      default:
        r.skip(wire);
    }
  }

  span.attributes = collectAttributes(attrBufs);

  return span as ParsedSpan;
}

/** nanoseconds bigint → ISO 8601 string */
function nanosToIso(ns: bigint): string {
  return new Date(Number(ns / 1_000_000n)).toISOString();
}

/** Span kind int → human label (mirrors OTLP SpanKind enum). */
function kindLabel(kind: number): string {
  return ['UNSPECIFIED', 'INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'][kind] ?? 'UNKNOWN';
}

/**
 * Deserialize an OTLP ExportTraceServiceRequest protobuf buffer into a list of
 * { sessionId, event } pairs ready for LangfuseService.ingest().
 *
 * Traverses: ExportTraceServiceRequest → ResourceSpans[] → ScopeSpans[] → Span[]
 * Session ID is extracted from span attributes (checked against SESSION_ID_KEYS),
 * falling back to resource attributes if not found on the span.
 */
export function deserializeOtlpTraces(raw: Buffer): { sessionId: string; event: LangfuseEvent }[] {
  const results: { sessionId: string; event: LangfuseEvent }[] = [];
  const root = new ProtoReader(raw);

  while (!root.isAtEnd()) {
    const { field: f1, wire: w1 } = root.readTag();

    if (f1 !== 1 || w1 !== 2) {
      root.skip(w1);

      continue;
    } // resource_spans (field 1)

    const rsBuf = root.readBytes();
    const rsReader = new ProtoReader(rsBuf);
    const resourceAttrBufs: Buffer[] = [];
    const scopeSpanBufs: Buffer[] = [];

    while (!rsReader.isAtEnd()) {
      const { field: f2, wire: w2 } = rsReader.readTag();

      if (f2 === 1 && w2 === 2) {
        // resource (field 1) — collect its attributes
        const resBuf = rsReader.readBytes();
        const resReader = new ProtoReader(resBuf);

        while (!resReader.isAtEnd()) {
          const { field: f3, wire: w3 } = resReader.readTag();

          if (f3 === 1 && w3 === 2) {
            resourceAttrBufs.push(resReader.readBytes());
          } else {
            resReader.skip(w3);
          }
        }
      } else if (f2 === 2 && w2 === 2) {
        scopeSpanBufs.push(rsReader.readBytes()); // scope_spans (field 2)
      } else {
        rsReader.skip(w2);
      }
    }

    const resourceAttrs = collectAttributes(resourceAttrBufs);
    const resourceSessionId = SESSION_ID_KEYS.map(
      (k) => resourceAttrs[k] as string | undefined,
    ).find(Boolean);

    for (const ssBuf of scopeSpanBufs) {
      const ssReader = new ProtoReader(ssBuf);

      while (!ssReader.isAtEnd()) {
        const { field: f4, wire: w4 } = ssReader.readTag();

        if (f4 !== 2 || w4 !== 2) {
          ssReader.skip(w4);

          continue;
        } // spans (field 2)

        const span = parseSpan(ssReader.readBytes());
        const sessionId =
          SESSION_ID_KEYS.map((k) => span.attributes[k] as string | undefined).find(Boolean) ??
          resourceSessionId;

        if (!sessionId) {
          continue; // no session ID — not from our agent, ignore
        }

        results.push({
          sessionId,
          event: {
            type: `span-${kindLabel(span.kind).toLowerCase()}`,
            timestamp: nanosToIso(span.startNs),
            body: {
              // Spread langfuse.* span attributes flat so the frontend can access
              // body['langfuse.observation.type'], body['langfuse.input'], etc. directly.
              ...span.attributes,
              traceId: span.traceId,
              spanId: span.spanId,
              parentSpanId: span.parentSpanId,
              name: span.name,
              kind: kindLabel(span.kind),
              startTime: nanosToIso(span.startNs),
              endTime: span.endNs > 0n ? nanosToIso(span.endNs) : undefined,
            },
          },
        });
      }
    }
  }

  return results;
}
