import { describe, expect, it } from 'vitest';

import { readRecipientDelivery, resolveUpdatedRecipientDelivery } from './recipient-delivery';

describe('recipient delivery', () => {
  it('reads the channel, the destination and the tax id from the auth options', () => {
    expect(
      readRecipientDelivery({
        accessAuth: [],
        actionAuth: [],
        delivery: {
          channel: 'WHATSAPP',
          destination: '+55 11 98765-4321',
          taxId: { type: 'CPF', number: '123.456.789-09' },
        },
      }),
    ).toEqual({
      channel: 'WHATSAPP',
      destination: '+55 11 98765-4321',
      taxId: { type: 'CPF', number: '123.456.789-09' },
    });
  });

  it('accepts a delivery without the optional parts', () => {
    expect(readRecipientDelivery({ delivery: { channel: 'EMAIL' } })).toEqual({ channel: 'EMAIL' });
  });

  it('ignores missing or invalid delivery data', () => {
    expect(readRecipientDelivery(null)).toBeNull();
    expect(readRecipientDelivery({ accessAuth: [], actionAuth: [] })).toBeNull();
    expect(readRecipientDelivery({ delivery: { channel: 'SMS', destination: '+55 11 98765-4321' } })).toBeNull();
    expect(readRecipientDelivery({ delivery: { channel: 'WHATSAPP', destination: ' ' } })).toBeNull();
    expect(readRecipientDelivery({ delivery: { channel: 'EMAIL', taxId: { type: 'RG', number: '1' } } })).toBeNull();
  });

  it('keeps the stored delivery when an update does not send one', () => {
    const stored = {
      accessAuth: [],
      actionAuth: [],
      delivery: {
        channel: 'WHATSAPP',
        destination: '+55 11 98765-4321',
        taxId: { type: 'CPF', number: '529.982.247-25' },
      },
    };

    expect(resolveUpdatedRecipientDelivery(stored)).toEqual(stored.delivery);
    expect(resolveUpdatedRecipientDelivery({ accessAuth: [], actionAuth: [] })).toBeNull();
  });

  it('replaces the stored delivery with the one sent in the update', () => {
    const update = {
      channel: 'WHATSAPP' as const,
      destination: '+55 11 98765-4321',
      taxId: { type: 'CPF' as const, number: '111.444.777-35' },
    };

    expect(
      resolveUpdatedRecipientDelivery({ delivery: { channel: 'EMAIL', destination: 'a@b.test' } }, update),
    ).toEqual(update);
  });
});
