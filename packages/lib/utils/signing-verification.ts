import { env } from './env';

/**
 * Verification block in the signing certificate and on the public QR page.
 *
 * Off by default, as upstream. When `NEXT_PRIVATE_SIGNING_VERIFICATION=true`:
 * - the certificate shows the public verification URL next to the QR code,
 *   how many signatures were completed, the SHA-256 of the original file and
 *   instructions on how to check the document;
 * - the public QR page (`/share/qr_*`) shows the SHA-256 of the original and
 *   signed files and lets the visitor check a local copy, hashed in the
 *   browser (the file is never uploaded).
 */
export const IS_SIGNING_VERIFICATION_ENABLED = () => env('NEXT_PRIVATE_SIGNING_VERIFICATION') === 'true';

export const getVerificationUrl = (baseUrl: string, qrToken: string) =>
  `${baseUrl.replace(/\/+$/, '')}/share/${qrToken}`;

type CountableRecipient = {
  role: string;
  signingStatus: string;
};

/**
 * Signatures completed out of the recipients expected to sign. Viewers, CCs
 * and assistants do not sign and are not counted.
 */
export const countSignatures = (recipients: CountableRecipient[]) => {
  const signers = recipients.filter((recipient) => recipient.role === 'SIGNER' || recipient.role === 'APPROVER');

  return {
    completed: signers.filter((recipient) => recipient.signingStatus === 'SIGNED').length,
    total: signers.length,
  };
};

/**
 * Lowercase hex, as printed by `sha256sum` and `Get-FileHash`, so the value in
 * the certificate can be compared with any common tool.
 */
export const toHex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

export const sha256Hex = async (data: Uint8Array | ArrayBuffer) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data as BufferSource);

  return toHex(digest);
};

/**
 * Splits a 64-char hash into lines so it wraps predictably in the PDF.
 */
export const chunkHash = (hash: string, size = 32) => hash.match(new RegExp(`.{1,${size}}`, 'g')) ?? [hash];
