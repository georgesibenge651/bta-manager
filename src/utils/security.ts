/**
 * Security and PIN Management Utility for CHIEF ALPHONS COMPANY LTD
 * Salted + stretched SHA-256 hashing for user PINs (never stored in clear text).
 *
 * Hash formats:
 *  - legacy : sha256(salt:pin)                      (64 hex chars)
 *  - v2     : "v2$" + 5000 chained SHA-256 rounds    (slows down brute force)
 * Legacy hashes are still accepted and silently upgraded on the next successful login.
 */

const V2_PREFIX = 'v2$';
const V2_ROUNDS = 5000;

/** Default PINs shipped with the demo seed. They MUST be changed at first login. */
export const SEED_DEFAULT_PINS = ['9999', '5555', '1234', '0000'];

/**
 * Generate a random cryptographic salt
 */
export function generateSalt(length = 16): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    return Array.from(arr)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // No CSPRNG available: refuse rather than silently using Math.random()
  throw new Error('Générateur aléatoire sécurisé indisponible sur cet appareil.');
}

/**
 * Synchronous v2 hash (salted, stretched).
 */
export function hashPinSync(pin: string, salt: string): string {
  const clean = pin.trim();
  let h = fallbackSha256(`${salt}:${clean}`);
  for (let i = 0; i < V2_ROUNDS; i++) {
    h = fallbackSha256(`${h}:${salt}`);
  }
  return V2_PREFIX + h;
}

/**
 * Async variant kept for API compatibility (uses the same v2 format).
 */
export async function hashPin(pin: string, salt: string): Promise<string> {
  return hashPinSync(pin, salt);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a candidate PIN against stored hash and salt.
 * No hash/salt stored => ALWAYS refuse (the old "default PIN" backdoor was removed).
 */
export function verifyPinSync(candidatePin: string, storedHash?: string, storedSalt?: string): boolean {
  if (!storedHash || !storedSalt || !candidatePin) return false;
  if (storedHash.startsWith(V2_PREFIX)) {
    return constantTimeEqual(hashPinSync(candidatePin, storedSalt), storedHash);
  }
  return constantTimeEqual(fallbackSha256(`${storedSalt}:${candidatePin.trim()}`), storedHash);
}

export async function verifyPin(candidatePin: string, storedHash?: string, storedSalt?: string): Promise<boolean> {
  return verifyPinSync(candidatePin, storedHash, storedSalt);
}

/** True when the stored hash is still one of the well-known demo PINs. */
export function isSeedDefaultPin(storedHash?: string, storedSalt?: string): boolean {
  if (!storedHash || !storedSalt) return true;
  return SEED_DEFAULT_PINS.some((pin) => verifyPinSync(pin, storedHash, storedSalt));
}

/** True when a PIN is too trivial to be accepted (1111, 1234, 0000, ...). */
export function isWeakPin(pin: string): boolean {
  const p = pin.trim();
  if (!/^\d{4,8}$/.test(p)) return true;
  if (/^(\d)\1+$/.test(p)) return true;
  if ('0123456789'.includes(p) || '9876543210'.includes(p)) return true;
  return SEED_DEFAULT_PINS.includes(p);
}

/**
 * Standard pure JS SHA-256 implementation (synchronous fallback)
 */
function fallbackSha256(ascii: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let lengthProperty = 'length';
  let i = 0, j = 0;
  let result = '';

  const words: number[] = [];
  const asciiBitLength = ascii[lengthProperty] * 8;

  let hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  let compositeClearHex = '';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    const code = ascii.charCodeAt(i);
    words[i >> 2] |= (code & 0xff) << (24 - (i % 4) * 8);
  }

  words[asciiBitLength >> 5] |= 0x80 << (24 - (asciiBitLength % 32));
  words[(((asciiBitLength + 64) >> 9) << 4) + 15] = asciiBitLength;

  for (i = 0; i < words.length; i += 16) {
    const w = words.slice(i, i + 16);
    let oldHash = hash.slice(0);

    for (j = 0; j < 64; j++) {
      let s1: number, s0: number, ch: number, maj: number, temp1: number, temp2: number;
      if (j < 16) {
        w[j] = w[j] || 0;
      } else {
        const s0w = w[j - 15];
        const s1w = w[j - 2];
        s0 = rightRotate(s0w, 7) ^ rightRotate(s0w, 18) ^ (s0w >>> 3);
        s1 = rightRotate(s1w, 17) ^ rightRotate(s1w, 19) ^ (s1w >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }

      s1 = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
      ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      temp1 = (hash[7] + s1 + ch + k[j] + w[j]) | 0;
      s0 = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
      maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      temp2 = (s0 + maj) | 0;

      hash = [(temp1 + temp2) | 0, hash[0], hash[1], hash[2], (hash[3] + temp1) | 0, hash[4], hash[5], hash[6]];
    }

    for (j = 0; j < 8; j++) {
      hash[j] = (hash[j] + oldHash[j]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }

  return result;
}
