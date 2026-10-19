const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32, no I/L/O/U

/** Random identifier body using the platform CSPRNG. */
export function randomId(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 32];
  return out;
}

export const newProjectId = () => `PRJ-${randomId(8)}`;
export const newTransferId = () => `TR-${randomId(8)}`;
export const newSupportId = () => `SUP-${randomId(8)}`;
export const newAccountRequestId = () => `ACR-${randomId(8)}`;
export const newAuditId = () => `AUD-${randomId(10)}`;
export const newNotificationId = () => `NTF-${randomId(10)}`;

/** Sequential, human-readable ids scoped to a project document (e.g. `T-0007`). */
export function sequenceId(prefix: string, n: number, width: number): string {
  return `${prefix}-${String(n).padStart(width, '0')}`;
}
