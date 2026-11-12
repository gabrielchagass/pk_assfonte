import { prisma } from '@documenso/prisma';
import { DocumentStatus, EnvelopeType } from '@prisma/client';

import { getFileServerSide } from '../../universal/upload/get-file.server';
import { countSignatures, IS_SIGNING_VERIFICATION_ENABLED, sha256Hex } from '../../utils/signing-verification';

export type DocumentVerification = {
  completed: number;
  total: number;
  items: {
    id: string;
    title: string;
    originalSha256: string;
    signedSha256: string;
  }[];
};

/**
 * Data for the verification panel of the public QR page. Same lookup as
 * `getDocumentByAccessToken` (completed documents only); returns null when the
 * feature is off or the token does not match. Exposes only counts and hashes:
 * no names, emails or other recipient data.
 */
export const getDocumentVerificationByAccessToken = async ({
  token,
}: {
  token: string;
}): Promise<DocumentVerification | null> => {
  if (!IS_SIGNING_VERIFICATION_ENABLED() || !token) {
    return null;
  }

  const envelope = await prisma.envelope.findFirst({
    where: {
      type: EnvelopeType.DOCUMENT,
      status: DocumentStatus.COMPLETED,
      qrToken: token,
    },
    select: {
      recipients: {
        select: {
          role: true,
          signingStatus: true,
        },
      },
      envelopeItems: {
        orderBy: {
          order: 'asc',
        },
        select: {
          id: true,
          title: true,
          documentData: {
            select: {
              type: true,
              data: true,
              initialData: true,
            },
          },
        },
      },
    },
  });

  if (!envelope) {
    return null;
  }

  const items = await Promise.all(
    envelope.envelopeItems.map(async (item) => ({
      id: item.id,
      title: item.title,
      originalSha256: await sha256Hex(
        await getFileServerSide({ type: item.documentData.type, data: item.documentData.initialData }),
      ),
      signedSha256: await sha256Hex(await getFileServerSide(item.documentData)),
    })),
  );

  return {
    ...countSignatures(envelope.recipients),
    items,
  };
};
