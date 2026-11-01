import { afterEach, describe, expect, it, vi } from 'vitest';

import { getDefaultRecipientAuthKind, hasRecipientEmail, IS_EMAILLESS_SIGNING_ENABLED } from './emailless-signing';

describe('emailless signing', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is disabled unless the flag is exactly "true"', () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_EMAILLESS_SIGNING', '');
    expect(IS_EMAILLESS_SIGNING_ENABLED()).toBe(false);

    vi.stubEnv('NEXT_PUBLIC_ALLOW_EMAILLESS_SIGNING', '1');
    expect(IS_EMAILLESS_SIGNING_ENABLED()).toBe(false);

    vi.stubEnv('NEXT_PUBLIC_ALLOW_EMAILLESS_SIGNING', 'true');
    expect(IS_EMAILLESS_SIGNING_ENABLED()).toBe(true);
  });

  it('treats empty, blank and missing emails as no email', () => {
    expect(hasRecipientEmail({ email: '' })).toBe(false);
    expect(hasRecipientEmail({ email: '   ' })).toBe(false);
    expect(hasRecipientEmail({ email: null })).toBe(false);
    expect(hasRecipientEmail({ email: 'signer@example.com' })).toBe(true);
  });

  it('reports link access instead of email for recipients without email', () => {
    expect(getDefaultRecipientAuthKind({ email: '' })).toBe('LINK');
    expect(getDefaultRecipientAuthKind({ email: 'signer@example.com' })).toBe('EMAIL');
  });
});
