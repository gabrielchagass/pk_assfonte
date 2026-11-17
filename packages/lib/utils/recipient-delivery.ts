import { z } from 'zod';

/**
 * ProKey patch 0006 (D45): channel the signing link was delivered by, the
 * destination that received it and the signer's tax id, sent by the ProKey
 * API. Kept inside the recipient `authOptions` JSON (no migration) and printed
 * in the ProKey certificate.
 */
export const ZRecipientDeliverySchema = z
  .object({
    channel: z.enum(['EMAIL', 'WHATSAPP']),
    destination: z.string().trim().min(1).max(255).optional(),
    taxId: z
      .object({
        type: z.enum(['CPF', 'CNPJ']),
        number: z.string().trim().min(1).max(20),
      })
      .optional(),
  })
  .describe(
    'How the signing link was delivered to the recipient (channel and destination) and the recipient tax id. Printed in the signing certificate.',
  );

export type TRecipientDelivery = z.infer<typeof ZRecipientDeliverySchema>;

export const readRecipientDelivery = (authOptions: unknown): TRecipientDelivery | null => {
  if (!authOptions || typeof authOptions !== 'object' || !('delivery' in authOptions)) {
    return null;
  }

  const parsed = ZRecipientDeliverySchema.safeParse(authOptions.delivery);

  return parsed.success ? parsed.data : null;
};

/**
 * ProKey patch 0007 (DOM-D095): delivery kept by a recipient update. A new
 * delivery replaces the stored one; without it, the stored one is kept, since
 * the update rebuilds the auth options and would otherwise drop it.
 */
export const resolveUpdatedRecipientDelivery = (
  originalAuthOptions: unknown,
  update?: TRecipientDelivery,
): TRecipientDelivery | null => update ?? readRecipientDelivery(originalAuthOptions);
