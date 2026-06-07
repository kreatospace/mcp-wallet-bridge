const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * bs58Encode
 * Pure TypeScript Base58 encoder. No external dependency.
 */
export function bs58Encode(bytes: Uint8Array): string {
  const digits: number[] = [0];

  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let result = "";
  // Leading zeros
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    result += "1";
  }
  // Encode digits in reverse
  for (let i = digits.length - 1; i >= 0; i--) {
    result += ALPHABET[digits[i]];
  }

  return result;
}
