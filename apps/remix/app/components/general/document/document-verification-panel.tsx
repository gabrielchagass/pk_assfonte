import type { DocumentVerification } from '@documenso/lib/server-only/document/get-document-verification-by-access-token';
import { sha256Hex } from '@documenso/lib/utils/signing-verification';
import { cn } from '@documenso/ui/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@documenso/ui/primitives/alert';
import { Button } from '@documenso/ui/primitives/button';
import { Trans } from '@lingui/react/macro';
import { FileSearchIcon, ShieldCheckIcon } from 'lucide-react';
import { type ChangeEvent, useRef, useState } from 'react';

export type DocumentVerificationPanelProps = {
  verification: DocumentVerification;
  className?: string;
};

type CheckResult =
  | { kind: 'signed'; fileName: string }
  | { kind: 'original'; fileName: string }
  | { kind: 'mismatch'; fileName: string; hash: string }
  | { kind: 'error'; fileName: string };

// Verification panel of the public QR page (NEXT_PRIVATE_SIGNING_VERIFICATION).
// The chosen file is hashed in the browser and never uploaded.
export const DocumentVerificationPanel = ({ verification, className }: DocumentVerificationPanelProps) => {
  const [result, setResult] = useState<CheckResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    setIsChecking(true);

    try {
      const hash = await sha256Hex(await file.arrayBuffer());

      if (verification.items.some((item) => item.signedSha256 === hash)) {
        setResult({ kind: 'signed', fileName: file.name });
      } else if (verification.items.some((item) => item.originalSha256 === hash)) {
        setResult({ kind: 'original', fileName: file.name });
      } else {
        setResult({ kind: 'mismatch', fileName: file.name, hash });
      }
    } catch {
      setResult({ kind: 'error', fileName: file.name });
    } finally {
      setIsChecking(false);
      input.value = '';
    }
  };

  return (
    <section className={cn('rounded-lg border border-border p-4 md:p-6', className)}>
      <div className="flex items-start gap-3">
        <ShieldCheckIcon className="mt-0.5 h-6 w-6 flex-shrink-0 text-green-600" />
        <div className="space-y-1">
          <h2 className="font-semibold text-lg">
            <Trans>Integrity and authenticity verification</Trans>
          </h2>
          {verification.total > 0 && (
            <p className="text-muted-foreground text-sm">
              <Trans>
                Signatures completed: {verification.completed} of {verification.total}
              </Trans>
            </p>
          )}
        </div>
      </div>

      <dl className="mt-4 space-y-3 text-sm">
        {verification.items.map((item) => (
          <div key={item.id} className="space-y-1">
            {verification.items.length > 1 && <p className="font-medium">{item.title}</p>}
            <dt className="text-muted-foreground">
              <Trans>SHA-256 of the original file</Trans>
            </dt>
            <dd className="break-all font-mono text-xs">{item.originalSha256}</dd>
            <dt className="text-muted-foreground">
              <Trans>SHA-256 of the signed file</Trans>
            </dt>
            <dd className="break-all font-mono text-xs">{item.signedSha256}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 space-y-3">
        <h3 className="font-medium">
          <Trans>Check your file</Trans>
        </h3>
        <p className="text-muted-foreground text-sm">
          <Trans>
            Choose the PDF you received to compare it with this document. The file is checked in your browser and is not
            uploaded.
          </Trans>
        </p>

        {/* Native file inputs label themselves in the browser's language; the
            visible button follows the page language instead. */}
        <input
          ref={inputRef}
          id="verification-file"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => void onFileChange(event)}
          disabled={isChecking}
          className="sr-only"
        />
        <Button type="button" variant="outline" loading={isChecking} onClick={() => inputRef.current?.click()}>
          <FileSearchIcon className="mr-2 h-4 w-4" />
          <Trans>Choose file</Trans>
        </Button>

        {result?.kind === 'signed' && (
          <Alert variant="default">
            <AlertTitle>
              <Trans>The file is identical to the signed document</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>{result.fileName} has not been altered since the signatures were completed.</Trans>
            </AlertDescription>
          </Alert>
        )}

        {result?.kind === 'original' && (
          <Alert variant="warning">
            <AlertTitle>
              <Trans>This is the original file, without the signatures</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>
                {result.fileName} matches the document before it was signed. The signed version is the one available for
                download on this page.
              </Trans>
            </AlertDescription>
          </Alert>
        )}

        {result?.kind === 'mismatch' && (
          <Alert variant="destructive">
            <AlertTitle>
              <Trans>The file does not match this document</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>
                {result.fileName} was altered or is a different document. Use the file available for download on this
                page.
              </Trans>
              <span className="mt-1 block break-all font-mono text-xs">SHA-256: {result.hash}</span>
            </AlertDescription>
          </Alert>
        )}

        {result?.kind === 'error' && (
          <Alert variant="destructive">
            <AlertDescription>
              <Trans>The file {result.fileName} could not be read.</Trans>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </section>
  );
};
