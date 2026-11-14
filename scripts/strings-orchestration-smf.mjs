/** Audit-only SMF encoder, authored here rather than installing dependencies.
 * Deliberately small, rejects unsupported events. NOT the shipped midi-file
 * library, and not on any production import path without explicit loader opt-in.
 * Parsing is deliberately independent (Python); parseMidi is not simulated. */
const be16 = (n) => [n >>> 8 & 255, n & 255];
const be32 = (n) => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
const text = (s) => [...Buffer.from(s, 'utf8')];
const vlq = (n) => { if (!Number.isInteger(n) || n < 0 || n > 0xfffffff) throw Error(`bad MIDI delta ${n}`); const a = [n & 127]; while ((n >>>= 7)) a.unshift((n & 127) | 128); return a; };
const meta = (tag, data) => [255, tag, ...vlq(data.length), ...data];
function event(e) {
  switch (e.type) {
    case 'noteOn': return [0x90 | e.channel, e.noteNumber, e.velocity];
    case 'noteOff': return [0x80 | e.channel, e.noteNumber, e.velocity];
    case 'controller': return [0xb0 | e.channel, e.controllerType, e.value];
    case 'trackName': return meta(3, text(e.text));
    case 'marker': return meta(6, text(e.text));
    case 'setTempo': return meta(0x51, be32(e.microsecondsPerBeat).slice(1));
    case 'timeSignature': return meta(0x58, [e.numerator, Math.log2(e.denominator), e.metronome, e.thirtyseconds]);
    case 'keySignature': return meta(0x59, [e.key & 255, e.scale]);
    case 'endOfTrack': return meta(0x2f, []);
    default: throw Error(`audit encoder does not support ${e.type}`);
  }
}
export function writeMidi(data) {
  const out = [...text('MThd'), ...be32(6), ...be16(data.header.format), ...be16(data.tracks.length), ...be16(data.header.ticksPerBeat)];
  for (const track of data.tracks) {
    const bytes = track.flatMap((e) => [...vlq(e.deltaTime), ...event(e)]);
    out.push(...text('MTrk'), ...be32(bytes.length), ...bytes);
  }
  return out;
}
export function parseMidi() { throw Error('Use scripts/strings-orchestration-measure.py: no parser test double is supplied'); }
