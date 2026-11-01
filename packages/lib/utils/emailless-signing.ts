import { env } from './env';

/**
 * Whether recipients without an email can complete signing.
 *
 * Off by default: the signer is asked for an email at completion, as upstream.
 * When `NEXT_PUBLIC_ALLOW_EMAILLESS_SIGNING=true`, a recipient created with an
 * empty email signs through their signing link and keeps the empty email. The
 * instance is expected to deliver links through another channel and to
 * distribute envelopes with `distributionMethod: NONE`.
 */
export const IS_EMAILLESS_SIGNING_ENABLED = () => env('NEXT_PUBLIC_ALLOW_EMAILLESS_SIGNING') === 'true';

export const hasRecipientEmail = (recipient: { email: string | null | undefined }) =>
  Boolean(recipient.email && recipient.email.trim().length > 0);

/**
 * Authentication shown in the signing certificate when the recipient used no
 * extra authentication. Without an email, access happened only through the
 * recipient's signing link, so the certificate must not claim email.
 */
export const getDefaultRecipientAuthKind = (recipient: { email: string | null | undefined }): 'EMAIL' | 'LINK' =>
  hasRecipientEmail(recipient) ? 'EMAIL' : 'LINK';
