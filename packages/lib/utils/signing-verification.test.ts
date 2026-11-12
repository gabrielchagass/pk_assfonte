import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  chunkHash,
  countSignatures,
  describeTimeZone,
  getCertificateLegalBasis,
  getCertificateTimeZone,
  getTimestampAuthorityLabel,
  getVerificationUrl,
  IS_SIGNING_VERIFICATION_ENABLED,
  sha256Hex,
} from './signing-verification';

describe('signing verification', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is disabled unless the flag is exactly "true"', () => {
    vi.stubEnv('NEXT_PRIVATE_SIGNING_VERIFICATION', '');
    expect(IS_SIGNING_VERIFICATION_ENABLED()).toBe(false);

    vi.stubEnv('NEXT_PRIVATE_SIGNING_VERIFICATION', '1');
    expect(IS_SIGNING_VERIFICATION_ENABLED()).toBe(false);

    vi.stubEnv('NEXT_PRIVATE_SIGNING_VERIFICATION', 'true');
    expect(IS_SIGNING_VERIFICATION_ENABLED()).toBe(true);
  });

  it('builds the public URL used by the QR code', () => {
    expect(getVerificationUrl('https://sign.example.com/', 'qr_abc')).toBe('https://sign.example.com/share/qr_abc');
    expect(getVerificationUrl('https://sign.example.com', 'qr_abc')).toBe('https://sign.example.com/share/qr_abc');
  });

  it('counts only recipients that sign', () => {
    expect(
      countSignatures([
        { role: 'SIGNER', signingStatus: 'SIGNED' },
        { role: 'SIGNER', signingStatus: 'NOT_SIGNED' },
        { role: 'APPROVER', signingStatus: 'SIGNED' },
        { role: 'CC', signingStatus: 'NOT_SIGNED' },
        { role: 'VIEWER', signingStatus: 'SIGNED' },
      ]),
    ).toEqual({ completed: 2, total: 3 });
  });

  it('hashes like sha256sum', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('splits the hash in two lines', () => {
    const hash = 'a'.repeat(32) + 'b'.repeat(32);
    expect(chunkHash(hash)).toEqual(['a'.repeat(32), 'b'.repeat(32)]);
  });

  it('uses Brasília unless another zone is configured', () => {
    vi.stubEnv('NEXT_PRIVATE_CERTIFICATE_TIMEZONE', '');
    expect(getCertificateTimeZone()).toBe('America/Sao_Paulo');

    vi.stubEnv('NEXT_PRIVATE_CERTIFICATE_TIMEZONE', 'America/Manaus');
    expect(getCertificateTimeZone()).toBe('America/Manaus');
  });

  it('prints the legal basis only when it is configured', () => {
    vi.stubEnv('NEXT_PRIVATE_CERTIFICATE_LEGAL_BASIS', '  ');
    expect(getCertificateLegalBasis()).toBeNull();

    vi.stubEnv('NEXT_PRIVATE_CERTIFICATE_LEGAL_BASIS', 'Texto validado. ');
    expect(getCertificateLegalBasis()).toBe('Texto validado.');
  });

  it('describes the zone with its offset at the given date', () => {
    const at = new Date('2026-11-12T04:24:08Z');

    expect(describeTimeZone('America/Sao_Paulo', at)).toBe('GMT -03:00 (Brasília)');
    expect(describeTimeZone('America/Manaus', at)).toBe('GMT -04:00 (Manaus)');
  });

  it('names the timestamp authority only when one is configured', () => {
    vi.stubEnv('NEXT_PRIVATE_SIGNING_TIMESTAMP_AUTHORITY', '');
    vi.stubEnv('NEXT_PRIVATE_SIGNING_TIMESTAMP_AUTHORITY_LABEL', 'DigiCert');
    expect(getTimestampAuthorityLabel()).toBeNull();

    vi.stubEnv('NEXT_PRIVATE_SIGNING_TIMESTAMP_AUTHORITY', 'http://timestamp.digicert.com');
    expect(getTimestampAuthorityLabel()).toBe('DigiCert');

    vi.stubEnv('NEXT_PRIVATE_SIGNING_TIMESTAMP_AUTHORITY_LABEL', '');
    vi.stubEnv(
      'NEXT_PRIVATE_SIGNING_TIMESTAMP_AUTHORITY',
      'http://timestamp.digicert.com, http://timestamp.sectigo.com,http://timestamp.digicert.com',
    );
    expect(getTimestampAuthorityLabel()).toBe('timestamp.digicert.com, timestamp.sectigo.com');
  });
});
