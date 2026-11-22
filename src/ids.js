/**
 * A UUIDv7: 48 bits of milliseconds, then random bits, with the version and variant set. A batch
 * that creates a page names it by one, so the sections created after it in the same batch can
 * name their parent.
 */
export function uuidv7(now = Date.now()) {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  let ms = BigInt(now)
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(ms & 0xffn)
    ms >>= 8n
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
