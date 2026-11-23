import Type, { type Static } from "typebox";
import { Check } from "typebox/value";

/** The version of the envelope every frame carries. A frame of another version is not decoded. */
export const PROTOCOL_VERSION = 1;

/** What travels in a frame: `data` is the message's own payload, which the room defines. */
export const envelopeSchema = Type.Object(
  {
    v: Type.Literal(PROTOCOL_VERSION),
    type: Type.String({ minLength: 1 }),
    room: Type.String({ minLength: 1 }),
    data: Type.Unknown(),
  },
  { additionalProperties: false },
);

export type Envelope = Static<typeof envelopeSchema>;

/** The text frame of a message. */
export function encode(envelope: Envelope): string {
  return JSON.stringify(envelope);
}

/** The envelope a text frame holds, or null when it is not JSON, not an envelope, or of another version. */
export function decode(frame: string): Envelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame);
  } catch {
    return null;
  }
  return Check(envelopeSchema, parsed) ? parsed : null;
}
