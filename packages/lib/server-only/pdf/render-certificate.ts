// sort-imports-ignore
import '../konva/skia-backend';

import fs from 'node:fs';
import path from 'node:path';
import type { Canvas } from '@documenso/skia-canvas';
import { Image as SkiaImage } from '@documenso/skia-canvas';
import type { I18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { Field, RecipientRole, Signature } from '@prisma/client';
import { SigningStatus } from '@prisma/client';
import Konva from 'konva';
import { DateTime } from 'luxon';
import { UAParser } from 'ua-parser-js';
import { renderSVG } from 'uqr';

import { NEXT_PUBLIC_WEBAPP_URL } from '../../constants/app';
import { APP_I18N_OPTIONS } from '../../constants/i18n';
import { getSignatureFontFamily } from '../../constants/pdf';
import { RECIPIENT_ROLE_SIGNING_REASONS, RECIPIENT_ROLES_DESCRIPTION } from '../../constants/recipient-roles';
import type { TDocumentAuditLogBaseSchema } from '../../types/document-audit-logs';
import { svgToPng } from '../../utils/images/svg-to-png';
import { describeTimeZone } from '../../utils/signing-verification';
import { ensureFontLibrary } from './helpers';

type ColumnWidths = [number, number, number];

type BaseAuditLog = Pick<TDocumentAuditLogBaseSchema, 'createdAt' | 'ipAddress' | 'userAgent'>;

export type CertificateRecipient = {
  id: number;
  name: string;
  email: string;
  role: RecipientRole;
  rejectionReason: string | null;
  signingStatus: SigningStatus;
  signatureField?: Pick<Field, 'id' | 'secondaryId' | 'recipientId'> & {
    signature?: Pick<Signature, 'signatureImageAsBase64' | 'typedSignature'> | null;
  };
  authLevel: string;
  logs: {
    emailed: BaseAuditLog | null;
    sent: BaseAuditLog | null;
    opened: BaseAuditLog | null;
    completed: BaseAuditLog | null;
    rejected: BaseAuditLog | null;
  };
};

export type CertificateVerification = {
  url: string;
  completed: number;
  total: number;
  originalSha256: string | null;
  /** IANA zone for the dates in the certificate (ProKey layout). */
  timeZone: string;
  /** Timestamp authority name, or null when no TSA is configured. */
  timestampAuthority: string | null;
  /** Legal basis sentence, only once validated (env); null hides the line. */
  legalBasis: string | null;
};

type GenerateCertificateOptions = {
  recipients: CertificateRecipient[];
  envelopeId: string;
  qrToken: string | null;
  verification?: CertificateVerification | null;
  hidePoweredBy: boolean;
  i18n: I18n;
  envelopeOwner: {
    name: string;
    email: string;
  };
  pageWidth: number;
  pageHeight: number;
};

// Helper function to get device info from user agent
const getDevice = (userAgent?: string | null): string => {
  if (!userAgent) {
    return 'Unknown';
  }

  const parser = new UAParser(userAgent);

  parser.setUA(userAgent);

  const result = parser.getResult();

  return `${result.os.name} - ${result.browser.name} ${result.browser.version}`;
};

const textMutedForegroundLight = '#929DAE';
const textForeground = '#000';
const textMutedForeground = '#64748B';
const textRejectedRed = '#dc2626';
const textBase = 10;
const textSm = 9;
const textXs = 8;
const fontMedium = '500';

const columnWidthPercentages = [30, 30, 40];
const rowPadding = 12;
const tableHeaderHeight = 38;
const pageTopMargin = 72;
const pageBottomMargin = 24;
const contentMaxWidth = 768;

const titleFontSize = 18;

// ProKey layout (NEXT_PRIVATE_SIGNING_VERIFICATION).
const cardFill = 'rgba(255, 255, 255, 0.92)';
const brandBlue = '#2563FF';

type RenderLabelAndTextOptions = {
  label: string;
  text: string;
  width: number;
  y?: number;
  labelFill?: string;
  valueFill?: string;
  /** 'word' keeps words whole (ProKey layout); upstream breaks anywhere. */
  wrap?: 'char' | 'word';
};

const renderLabelAndText = (options: RenderLabelAndTextOptions) => {
  const { width, y } = options;

  const group = new Konva.Group({
    y,
  });

  const labelFill = options.labelFill ?? textMutedForeground;
  const valueFill = options.valueFill ?? textMutedForeground;

  const label = new Konva.Text({
    x: 0,
    y: 0,
    text: `${options.label}: `,
    fontStyle: fontMedium,
    fontFamily: 'Inter',
    fill: labelFill,
    fontSize: textSm,
  });

  group.add(label);

  const value = new Konva.Text({
    x: label.width(),
    y: 0,
    width: width - label.width(),
    fontFamily: 'Inter',
    text: options.text,
    fill: valueFill,
    wrap: options.wrap ?? 'char',
    fontSize: textSm,
  });

  group.add(value);

  return group;
};

type RenderRowHeaderOptions = {
  columnWidths: number[];
  i18n: I18n;
};

const renderRowHeader = (options: RenderRowHeaderOptions) => {
  const { columnWidths, i18n } = options;

  const columnOneWidth = columnWidths[0];
  const columnTwoWidth = columnWidths[1];
  const columnThreeWidth = columnWidths[2];

  const headerRow = new Konva.Group();

  const headerFontStyling = {
    fontFamily: 'Inter',
    fontSize: 11,
    fontStyle: fontMedium,
    verticalAlign: 'middle',
    fill: textMutedForeground,
    height: tableHeaderHeight,
  };

  const header1 = new Konva.Text({
    x: rowPadding,
    width: columnOneWidth,
    text: i18n._(msg`Signer Events`),
    ...headerFontStyling,
  });
  headerRow.add(header1);

  const header2 = new Konva.Text({
    x: columnOneWidth + rowPadding,
    width: columnTwoWidth,
    text: i18n._(msg`Signature`),
    ...headerFontStyling,
  });
  headerRow.add(header2);

  const header3 = new Konva.Text({
    x: columnOneWidth + columnTwoWidth + rowPadding,
    width: columnThreeWidth,
    text: i18n._(msg`Details`),
    ...headerFontStyling,
  });
  headerRow.add(header3);

  return headerRow;
};

const columnPadding = 10;

// ProKey layout: dates in the certificate zone, which the header names once.
const formatLogDate = (date: Date, timeZone?: string) =>
  timeZone
    ? DateTime.fromJSDate(date).setZone(timeZone).toFormat('dd/MM/yyyy HH:mm:ss')
    : DateTime.fromJSDate(date).setLocale(APP_I18N_OPTIONS.defaultLocale).toFormat('yyyy-MM-dd hh:mm:ss a (ZZZZ)');

type RenderColumnOptions = {
  recipient: CertificateRecipient;
  width: number;
  i18n: I18n;
  timeZone?: string;
  envelopeOwner: {
    name: string;
    email: string;
  };
};

const renderColumnOne = (options: RenderColumnOptions) => {
  const { recipient, width, i18n } = options;

  const columnGroup = new Konva.Group();

  const textSectionPadding = 8;

  const textFontStyling = {
    x: 0,
    fontFamily: 'Inter',
    wrap: 'char',
    lineHeight: 1.2,
    fill: textMutedForeground,
    width: width - columnPadding,
  };

  if (recipient.name) {
    const nameText = new Konva.Text({
      y: 0,
      text: recipient.name,
      fontSize: textBase,
      ...textFontStyling,
      fontStyle: fontMedium,
    });

    columnGroup.add(nameText);
  }

  const emailText = new Konva.Text({
    y: columnGroup.getClientRect().height,
    text: recipient.email,
    fontSize: textBase,
    ...textFontStyling,
  });

  columnGroup.add(emailText);

  const roleText = new Konva.Text({
    y: columnGroup.getClientRect().height + textSectionPadding,
    text: i18n._(RECIPIENT_ROLES_DESCRIPTION[recipient.role].roleName),
    fontSize: textSm,
    ...textFontStyling,
  });
  columnGroup.add(roleText);

  const authLabel = new Konva.Text({
    y: columnGroup.getClientRect().height + textSectionPadding,
    text: `${i18n._(msg`Authentication Level`)}:`,
    fontSize: textSm,
    fontStyle: fontMedium,
    ...textFontStyling,
  });
  columnGroup.add(authLabel);

  const authValue = new Konva.Text({
    y: columnGroup.getClientRect().height,
    text: recipient.authLevel,
    fontSize: textSm,
    ...textFontStyling,
  });
  columnGroup.add(authValue);

  return columnGroup;
};

const renderColumnTwo = (options: RenderColumnOptions) => {
  const { recipient, width, i18n, timeZone } = options;

  // Column 2: Signature
  const column = new Konva.Group();

  const columnWidth = width - columnPadding;

  const isRejected = Boolean(recipient.logs.rejected);

  if (recipient.signatureField?.secondaryId) {
    // Signature container with green border
    const signatureContainer = new Konva.Group({ x: 0, y: 0 });

    const minSignatureHeight = 40;
    const maxSignatureWidth = 100;

    // Signature content
    if (recipient.signatureField?.signature?.signatureImageAsBase64) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const img = new SkiaImage(
        recipient.signatureField?.signature?.signatureImageAsBase64,
      ) as unknown as HTMLImageElement;

      const signatureImage = new Konva.Image({
        image: img,
        x: 4,
        y: 4,
        width: maxSignatureWidth,
        height: maxSignatureWidth * (img.height / img.width),
      });

      signatureContainer.add(signatureImage);
    } else if (recipient.signatureField?.signature?.typedSignature) {
      const typedSig = new Konva.Text({
        x: 2,
        text: recipient.signatureField?.signature?.typedSignature,
        padding: 4,
        fontFamily: getSignatureFontFamily(recipient.signatureField?.signature?.typedSignature),
        fontSize: 16,
        align: 'center',
        verticalAlign: 'middle',
        width: maxSignatureWidth,
      });

      if (typedSig.getClientRect().height < minSignatureHeight) {
        typedSig.setAttrs({
          height: minSignatureHeight,
        });
      }

      signatureContainer.add(typedSig);
    }

    // Do not add the signature container for rejected recipients.
    if (!isRejected) {
      column.add(signatureContainer);
    }

    const signatureHeight = Math.max(signatureContainer.getClientRect().height, minSignatureHeight);

    const signatureBorder = new Konva.Rect({
      x: 2,
      y: 2,
      width: maxSignatureWidth,
      height: signatureHeight,
      stroke: 'rgba(122, 196, 85, 0.6)',
      strokeWidth: 1,
      cornerRadius: 8,
    });
    signatureContainer.add(signatureBorder);

    const signatureShadow = new Konva.Rect({
      x: 0,
      y: 0,
      width: maxSignatureWidth + 4,
      height: signatureHeight + 4,
      stroke: 'rgba(122, 196, 85, 0.1)',
      strokeWidth: 4,
      cornerRadius: 8,
    });
    signatureContainer.add(signatureShadow);

    // Signature ID
    const sigIdLabel = new Konva.Text({
      x: 0,
      y: isRejected ? 0 : signatureHeight + 10,
      text: `${i18n._(msg`Signature ID`)}:`,
      fill: textMutedForeground,
      width: columnWidth,
      fontFamily: 'Inter',
      fontSize: textSm,
      fontStyle: fontMedium,
      lineHeight: 1.4,
    });
    column.add(sigIdLabel);

    const sigIdValue = new Konva.Text({
      x: 0,
      y: column.getClientRect().height,
      text: recipient.signatureField.secondaryId.toUpperCase(),
      fill: textMutedForeground,
      fontFamily: 'monospace',
      fontSize: textSm,
      width: columnWidth,
      wrap: 'char',
    });
    column.add(sigIdValue);
  } else {
    const naText = new Konva.Text({
      x: 0,
      y: 0,
      text: 'N/A',
      fill: textMutedForeground,
      fontFamily: 'Inter',
      fontSize: textSm,
    });
    column.add(naText);
  }

  const relevantLog = isRejected ? recipient.logs.rejected : recipient.logs.completed;

  const ipLabelAndText = renderLabelAndText({
    wrap: timeZone ? 'word' : undefined,
    label: i18n._(msg`IP Address`),
    text: relevantLog?.ipAddress ?? i18n._(msg`Unknown`),
    width,
    y: column.getClientRect().height + 6,
  });
  column.add(ipLabelAndText);

  const deviceLabelAndText = renderLabelAndText({
    wrap: timeZone ? 'word' : undefined,
    label: i18n._(msg`Device`),
    text: getDevice(relevantLog?.userAgent),
    width,
    y: column.getClientRect().height + 6,
  });
  column.add(deviceLabelAndText);

  return column;
};

const renderColumnThree = (options: RenderColumnOptions) => {
  const { recipient, width, i18n, envelopeOwner, timeZone } = options;

  const column = new Konva.Group();

  type DetailItem = {
    label: string;
    value: string;
    labelFill?: string;
    valueFill?: string;
  };

  const itemsToRender: DetailItem[] = [
    {
      label: i18n._(msg`Sent`),
      value: recipient.logs.emailed
        ? formatLogDate(recipient.logs.emailed.createdAt, timeZone)
        : recipient.logs.sent
          ? formatLogDate(recipient.logs.sent.createdAt, timeZone)
          : i18n._(msg`Unknown`),
    },
    {
      label: i18n._(msg`Viewed`),
      value: recipient.logs.opened
        ? formatLogDate(recipient.logs.opened.createdAt, timeZone)
        : i18n._(msg`Unknown`),
    },
  ];

  if (recipient.logs.rejected) {
    itemsToRender.push({
      label: i18n._(msg`Rejected`),
      value: formatLogDate(recipient.logs.rejected.createdAt, timeZone),
      labelFill: textRejectedRed,
      valueFill: textRejectedRed,
    });
  } else {
    itemsToRender.push({
      label: i18n._(msg`Signed`),
      value: recipient.logs.completed
        ? formatLogDate(recipient.logs.completed.createdAt, timeZone)
        : i18n._(msg`Unknown`),
    });
  }

  const isOwner = recipient.email.toLowerCase() === envelopeOwner.email.toLowerCase();

  itemsToRender.push({
    label: i18n._(msg`Reason`),
    value:
      recipient.signingStatus === SigningStatus.REJECTED
        ? recipient.rejectionReason || ''
        : isOwner
          ? i18n._(msg`I am the owner of this document`)
          : i18n._(RECIPIENT_ROLE_SIGNING_REASONS[recipient.role]),
  });

  for (const [index, item] of itemsToRender.entries()) {
    const labelAndText = renderLabelAndText({
      wrap: timeZone ? 'word' : undefined,
      label: item.label,
      text: item.value,
      width,
      y: column.getClientRect().height + (index === 0 ? 0 : 8),
      labelFill: item.labelFill,
      valueFill: item.valueFill,
    });
    column.add(labelAndText);
  }

  return column;
};

type RenderRowOptions = {
  recipient: CertificateRecipient;
  columnWidths: ColumnWidths;
  i18n: I18n;
  timeZone?: string;
  envelopeOwner: {
    name: string;
    email: string;
  };
};

const renderRow = (options: RenderRowOptions) => {
  const { recipient, columnWidths, i18n, envelopeOwner, timeZone } = options;

  const rowGroup = new Konva.Group();

  const width = columnWidths[0] + columnWidths[1] + columnWidths[2];

  // Draw top border line.
  const borderLine = new Konva.Line({
    points: [0, 0, width + rowPadding * 2, 0],
    stroke: '#e5e7eb',
    strokeWidth: 1,
  });

  rowGroup.add(borderLine);

  // Column 1: Signer Events
  const columnGroup = renderColumnOne({
    recipient,
    width: columnWidths[0],
    i18n,
    envelopeOwner,
  });
  columnGroup.setAttrs({
    x: rowPadding,
    y: rowPadding,
  } satisfies Partial<Konva.GroupConfig>);
  rowGroup.add(columnGroup);

  const columnTwoGroup = renderColumnTwo({
    recipient,
    width: columnWidths[1],
    i18n,
    envelopeOwner,
    timeZone,
  });
  columnTwoGroup.setAttrs({
    x: rowPadding + columnWidths[0],
    y: rowPadding,
  } satisfies Partial<Konva.GroupConfig>);
  rowGroup.add(columnTwoGroup);

  // Column 3: Details
  const columnThreeGroup = renderColumnThree({
    recipient,
    width: columnWidths[2],
    i18n,
    envelopeOwner,
    timeZone,
  });
  columnThreeGroup.setAttrs({
    x: rowPadding + columnWidths[0] + columnWidths[1],
    y: rowPadding,
  } satisfies Partial<Konva.GroupConfig>);
  rowGroup.add(columnThreeGroup);

  const rowBottomPadding = new Konva.Rect({
    x: 0,
    y: rowGroup.getClientRect().height,
    width: rowGroup.getClientRect().width,
    height: rowPadding,
  });
  rowGroup.add(rowBottomPadding);

  return rowGroup;
};

const renderBranding = async ({ qrToken, i18n }: { qrToken: string | null; i18n: I18n }) => {
  const branding = new Konva.Group();

  const brandingHeight = 12;

  const text = new Konva.Text({
    x: 0,
    verticalAlign: 'middle',
    text: i18n._(msg`Signing certificate provided by`) + ':',
    fontStyle: fontMedium,
    fontFamily: 'Inter',
    fontSize: textSm,
    height: brandingHeight,
  });

  const logoPath = path.join(process.cwd(), 'public/static/logo.png');
  const logo = fs.readFileSync(logoPath);

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const img = new SkiaImage(logo) as unknown as HTMLImageElement;

  const documensoImage = new Konva.Image({
    image: img,
    height: brandingHeight,
    width: brandingHeight * (img.width / img.height),
    x: text.width() + 16,
  });

  const qrSize = qrToken ? 72 : 0;

  const logoGroup = new Konva.Group({
    y: qrSize + 16,
  });
  logoGroup.add(text);
  logoGroup.add(documensoImage);

  branding.add(logoGroup);

  if (qrToken) {
    const qrSvg = renderSVG(`${NEXT_PUBLIC_WEBAPP_URL()}/share/${qrToken}`, {
      ecc: 'Q',
    });

    const svgImage = await svgToPng(qrSvg);

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const qrSkiaImage = new SkiaImage(svgImage) as unknown as HTMLImageElement;
    const qrImage = new Konva.Image({
      image: qrSkiaImage,
      height: qrSize,
      width: qrSize,
      x: branding.getClientRect().width - qrSize,
      y: 0,
    });

    branding.add(qrImage);
  }

  return branding;
};

type RenderVerificationOptions = {
  verification: CertificateVerification;
  width: number;
  i18n: I18n;
};

// Verification block (NEXT_PRIVATE_SIGNING_VERIFICATION): QR code with the
// public URL written next to it, signatures completed, legal basis, SHA-256 of
// the original file and how to check the document. Goes at the top of the
// first page, under the ProKey header.
const renderVerification = async ({ verification, width, i18n }: RenderVerificationOptions) => {
  const group = new Konva.Group();

  const padding = 14;
  const qrSize = 96;
  const gap = 4;

  const qrSvg = renderSVG(verification.url, { ecc: 'Q' });
  const qrPng = await svgToPng(qrSvg);

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const qrSkiaImage = new SkiaImage(qrPng) as unknown as HTMLImageElement;

  group.add(
    new Konva.Image({
      image: qrSkiaImage,
      x: padding,
      y: padding,
      width: qrSize,
      height: qrSize,
    }),
  );

  const textX = padding + qrSize + 16;
  const textWidth = width - textX - padding;
  let y = padding;

  const addText = (text: string, config: Partial<Konva.TextConfig> = {}) => {
    const node = new Konva.Text({
      x: textX,
      y,
      width: textWidth,
      text,
      fontFamily: 'Inter',
      fontSize: textSm,
      fill: textMutedForeground,
      wrap: 'word',
      ...config,
    });

    group.add(node);
    y += node.height() + gap;
  };

  const addLabelAndText = (label: string, text: string) => {
    const node = renderLabelAndText({ label, text, width: textWidth, y, wrap: 'word' });

    node.x(textX);
    group.add(node);
    y += node.getClientRect().height + gap;
  };

  addText(i18n._(msg`Integrity and authenticity verification`), {
    fontSize: 11,
    fontStyle: '700',
    fill: textForeground,
  });
  y += 2;

  addLabelAndText(i18n._(msg`Public verification URL`), verification.url);

  if (verification.total > 0) {
    addLabelAndText(i18n._(msg`Signatures completed`), i18n._(msg`${verification.completed} of ${verification.total}`));
  }

  if (verification.legalBasis) {
    addText(verification.legalBasis);
  }

  if (verification.originalSha256) {
    // Label and hash on separate lines, so the hash never breaks in the middle.
    addText(`${i18n._(msg`SHA-256 of the original file`)}:`, { fontStyle: fontMedium });
    y -= gap / 2;
    addText(verification.originalSha256, { wrap: 'char' });
  }

  y += 4;

  addText(i18n._(msg`How to check this document`), {
    fontStyle: '700',
    fill: textForeground,
  });

  addText(
    i18n._(
      msg`This copy carries the audit data, but a printed or copied version can be altered. To check that the file is intact and that the signatures are valid, open the public verification URL or scan the QR code and compare your file on that page.`,
    ),
  );

  const boxHeight = Math.max(y - gap, padding + qrSize) + padding;

  const box = new Konva.Rect({
    x: 0,
    y: 0,
    width,
    height: boxHeight,
    stroke: '#e5e7eb',
    strokeWidth: 1.5,
    cornerRadius: 8,
    fill: cardFill,
  });

  group.add(box);
  box.moveToBottom();

  return group;
};

type GroupRowsIntoPagesOptions = {
  recipients: CertificateRecipient[];
  maxHeight: number;
  /** Height left for the table on the first page, when it differs (ProKey layout). */
  firstPageMaxHeight?: number;
  timeZone?: string;
  i18n: I18n;
  columnWidths: ColumnWidths;
  envelopeOwner: {
    name: string;
    email: string;
  };
};

const groupRowsIntoPages = (options: GroupRowsIntoPagesOptions) => {
  const { recipients, maxHeight, i18n, columnWidths, envelopeOwner, timeZone } = options;
  const firstPageMaxHeight = options.firstPageMaxHeight ?? maxHeight;

  const rowHeader = renderRowHeader({ columnWidths, i18n });
  const rowHeaderHeight = rowHeader.getClientRect().height;

  const groupedRows: Konva.Group[][] = [[]];

  let availablePageHeight = firstPageMaxHeight - rowHeaderHeight;
  let currentGroupedRowIndex = 0;

  // Group rows into pages.
  for (const recipient of recipients) {
    const row = renderRow({ recipient, columnWidths, i18n, envelopeOwner, timeZone });

    const rowHeight = row.getClientRect().height;

    if (rowHeight > availablePageHeight) {
      currentGroupedRowIndex++;
      groupedRows[currentGroupedRowIndex] = [row];
      availablePageHeight = maxHeight - rowHeaderHeight;
    } else {
      groupedRows[currentGroupedRowIndex].push(row);
    }

    // Reduce available height by the row height.
    availablePageHeight -= rowHeight;
  }

  return groupedRows;
};

type RenderTablesOptions = {
  groupedRows: Konva.Group[][];
  columnWidths: ColumnWidths;
  i18n: I18n;
  /** White card behind the table, over the page background (ProKey layout). */
  filled?: boolean;
};

const renderTables = (options: RenderTablesOptions) => {
  const { groupedRows, columnWidths, i18n, filled } = options;

  const tables: Konva.Group[] = [];

  // Render the rows for each page.
  for (const rows of groupedRows) {
    const table = new Konva.Group();
    const tableHeader = renderRowHeader({ columnWidths, i18n });

    table.add(tableHeader);

    for (const row of rows) {
      row.setAttrs({
        x: 0,
        y: table.getClientRect().height,
      } satisfies Partial<Konva.GroupConfig>);

      table.add(row);
    }

    // Add table background and border.
    const tableClientRect = table.getClientRect();
    const cardRect = new Konva.Rect({
      x: tableClientRect.x,
      y: tableClientRect.y,
      width: tableClientRect.width,
      height: tableClientRect.height,
      stroke: '#e5e7eb',
      strokeWidth: 1.5,
      cornerRadius: 8,
      ...(filled ? { fill: cardFill } : {}),
    });
    table.add(cardRect);

    if (filled) {
      cardRect.moveToBottom();
    }

    tables.push(table);
  }

  return tables;
};

// ---------------------------------------------------------------------------
// ProKey layout (NEXT_PRIVATE_SIGNING_VERIFICATION): header with the ProKey
// logo, verification block at the top of the first page, security border
// (key teeth) and microtext background, dates in the certificate zone and
// "prokey.com.br" in the footer. The upstream layout above is unchanged.
// ---------------------------------------------------------------------------

// Brand gradient and logo strokes, from quadro_chaves_app/src/assets/brand.
const brandGradientStops = [0, '#00A6FF', 0.45, '#2563FF', 1, '#7B2CFF'];
const hexLogoPaths = [
  'M256 58 L427 157 L427 355 L256 454 L85 355 L85 157 Z',
  'M256 168 L332 212 L332 300 L256 344 L180 300 L180 212 Z',
];
// Bounding box of the hexagon in the 512 x 512 logo.
const hexLogoBox = { x: 85, y: 58, width: 342, height: 396 };

// Key teeth profile used by the border: plateaus and ramps, 0 to 1.
const keyTeethProfile = [0, 0.15, 0.9, 0.9, 0.45, 0.45, 0.8, 0.8, 0.25, 0.25, 0.65, 0.65, 0];

const keyTeeth = (distance: number, period: number) => {
  const position = (((distance % period) + period) % period) / period;
  const scaled = position * (keyTeethProfile.length - 1);
  const index = Math.floor(scaled);
  const fraction = scaled - index;

  return keyTeethProfile[index] + (keyTeethProfile[index + 1] - keyTeethProfile[index]) * fraction;
};

type FramePoint = [x: number, y: number, normalX: number, normalY: number];

// Point and inward normal at a distance along a rectangle, clockwise from the
// top left corner.
const framePoint = (x0: number, y0: number, width: number, height: number, distance: number): FramePoint => {
  const perimeter = 2 * (width + height);
  const d = ((distance % perimeter) + perimeter) % perimeter;

  if (d < width) {
    return [x0 + d, y0, 0, 1];
  }

  if (d < width + height) {
    return [x0 + width, y0 + (d - width), -1, 0];
  }

  if (d < 2 * width + height) {
    return [x0 + width - (d - width - height), y0 + height, 0, -1];
  }

  return [x0, y0 + height - (d - 2 * width - height), 1, 0];
};

const traceHexagon = (c: CanvasRenderingContext2D, cx: number, cy: number, radius: number) => {
  c.beginPath();

  for (let k = 0; k < 6; k++) {
    const angle = -Math.PI / 2 + (k * Math.PI) / 3;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);

    if (k === 0) {
      c.moveTo(x, y);
    } else {
      c.lineTo(x, y);
    }
  }

  c.closePath();
};

type RenderSecurityBackgroundOptions = {
  pageWidth: number;
  pageHeight: number;
  microtext: string;
};

// Drawn in millimetres (the page width is 210 mm on A4) and scaled to points.
const renderSecurityBackground = ({ pageWidth, pageHeight, microtext }: RenderSecurityBackgroundOptions) =>
  new Konva.Shape({
    listening: false,
    sceneFunc: (konvaContext) => {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const c = konvaContext._context as unknown as CanvasRenderingContext2D;
      const unit = pageWidth / 210;
      const width = pageWidth / unit;
      const height = pageHeight / unit;

      c.save();
      c.scale(unit, unit);

      const gradient = c.createLinearGradient(0, 0, width, height);

      for (let i = 0; i < brandGradientStops.length; i += 2) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        gradient.addColorStop(brandGradientStops[i] as number, brandGradientStops[i + 1] as string);
      }

      // Background: microtext lines, shifted on each line.
      c.fillStyle = gradient;
      c.globalAlpha = 0.09;
      c.font = '500 1.35px Inter';

      const line = `${microtext} · `.repeat(Math.ceil((width * 2) / (microtext.length + 3)));

      // Outlines, not text: the microtext must not show up when the PDF text
      // is copied, searched or read aloud.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const skia = c as unknown as { outlineText?: (text: string) => Path2D };
      const outline = typeof skia.outlineText === 'function' ? skia.outlineText(line) : null;

      for (let y = 2, k = 0; y < height + 2; y += 2.4, k++) {
        if (outline) {
          c.save();
          c.translate(-((k * 7) % 40), y);
          c.fill(outline);
          c.restore();
        }
      }

      // Border: parallel lines that follow the key teeth.
      const band = 7;
      const outer = 5;
      const frameWidth = width - outer * 2;
      const frameHeight = height - outer * 2;
      const perimeter = 2 * (frameWidth + frameHeight);

      c.strokeStyle = gradient;
      c.lineJoin = 'round';

      for (let k = 0; k < 8; k++) {
        c.globalAlpha = 0.35 + 0.06 * k;
        c.lineWidth = k === 7 ? 0.32 : 0.14;
        c.beginPath();

        for (let d = 0; d <= perimeter; d += 0.25) {
          const [x, y, nx, ny] = framePoint(outer, outer, frameWidth, frameHeight, d);
          const offset = 0.6 + k * 0.42 + 2.6 * keyTeeth(d + k * 0.35, 18);

          if (d === 0) {
            c.moveTo(x + nx * offset, y + ny * offset);
          } else {
            c.lineTo(x + nx * offset, y + ny * offset);
          }
        }

        c.closePath();
        c.stroke();
      }

      c.globalAlpha = 0.85;
      c.lineWidth = 0.32;
      c.strokeRect(outer, outer, frameWidth, frameHeight);

      const inner = outer + band + 1.6;

      c.globalAlpha = 0.6;
      c.lineWidth = 0.18;
      c.strokeRect(inner, inner, width - inner * 2, height - inner * 2);

      // ProKey hexagon in each corner, over a white hexagon.
      const corner = 9.5;
      const radius = 5.2;

      for (const [cx, cy] of [
        [corner, corner],
        [width - corner, corner],
        [corner, height - corner],
        [width - corner, height - corner],
      ]) {
        c.globalAlpha = 1;
        c.fillStyle = '#FFFFFF';
        traceHexagon(c, cx, cy, radius * 1.18);
        c.fill();

        c.globalAlpha = 0.95;
        c.lineWidth = radius * 0.12;
        traceHexagon(c, cx, cy, radius);
        c.stroke();
        traceHexagon(c, cx, cy, radius * 0.44);
        c.stroke();
      }

      c.restore();
    },
  });

type RenderProKeyHeaderOptions = {
  width: number;
  verification: CertificateVerification;
  i18n: I18n;
};

// Logo on the left, as tall as the text block on the right: title and the
// line with the time zone and the timestamp authority.
const renderProKeyHeader = ({ width, verification, i18n }: RenderProKeyHeaderOptions) => {
  const group = new Konva.Group();

  const title = new Konva.Text({
    x: 0,
    y: 0,
    width,
    align: 'right',
    text: i18n._(msg`Signing Certificate`),
    fontFamily: 'Inter',
    fontSize: titleFontSize,
    fontStyle: '700',
    fill: textForeground,
  });

  const zone = describeTimeZone(verification.timeZone, new Date());
  const tsa = verification.timestampAuthority;

  const subtitle = new Konva.Text({
    x: 0,
    y: title.height() + 4,
    width,
    align: 'right',
    text: tsa
      ? i18n._(msg`Dates and times in ${zone}. Timestamp by ${tsa} (RFC 3161).`)
      : i18n._(msg`Dates and times in ${zone}.`),
    fontFamily: 'Inter',
    fontSize: textSm,
    fill: textMutedForeground,
  });

  const blockHeight = subtitle.y() + subtitle.height();
  const scale = blockHeight / hexLogoBox.height;

  for (const data of hexLogoPaths) {
    group.add(
      new Konva.Path({
        data,
        x: -hexLogoBox.x * scale,
        y: -hexLogoBox.y * scale,
        scaleX: scale,
        scaleY: scale,
        strokeWidth: 30,
        lineJoin: 'round',
        strokeLinearGradientStartPoint: { x: 92, y: 76 },
        strokeLinearGradientEndPoint: { x: 420, y: 436 },
        strokeLinearGradientColorStops: brandGradientStops,
      }),
    );
  }

  group.add(
    new Konva.Text({
      x: hexLogoBox.width * scale + 8,
      y: 0,
      height: blockHeight,
      verticalAlign: 'middle',
      text: 'ProKey',
      fontFamily: 'Inter',
      fontSize: Math.round(blockHeight * 0.62),
      fontStyle: '700',
      fill: '#0B1021',
    }),
  );

  group.add(title);
  group.add(subtitle);

  return group;
};

type RenderProKeyFooterOptions = {
  x: number;
  y: number;
  width: number;
  envelopeId: string;
  i18n: I18n;
};

const renderProKeyFooter = ({ x, y, width, envelopeId, i18n }: RenderProKeyFooterOptions) => {
  const group = new Konva.Group({ x, y });

  group.add(
    new Konva.Text({
      x: 0,
      y: 0,
      text: `${i18n._(msg`Envelope ID`)}: ${envelopeId}`,
      fontFamily: 'Inter',
      fontSize: textXs,
      fill: textMutedForegroundLight,
    }),
  );

  const site = new Konva.Text({
    y: -1,
    text: 'prokey.com.br',
    fontFamily: 'Inter',
    fontSize: textSm + 1,
    fontStyle: '700',
    fill: brandBlue,
  });

  site.x(width - site.width());

  const label = new Konva.Text({
    y: 0,
    text: `${i18n._(msg`Signing certificate provided by`)}: `,
    fontFamily: 'Inter',
    fontSize: textXs,
    fontStyle: fontMedium,
    fill: textForeground,
  });

  label.x(site.x() - label.width() - 2);

  group.add(label);
  group.add(site);

  return group;
};

type RenderProKeyCertificateOptions = {
  recipients: CertificateRecipient[];
  envelopeId: string;
  verification: CertificateVerification;
  i18n: I18n;
  envelopeOwner: {
    name: string;
    email: string;
  };
  pageWidth: number;
  pageHeight: number;
};

const renderProKeyCertificate = async ({
  recipients,
  envelopeId,
  verification,
  i18n,
  envelopeOwner,
  pageWidth,
  pageHeight,
}: RenderProKeyCertificateOptions) => {
  // Millimetres to points, as the border is drawn.
  const unit = pageWidth / 210;
  const sectionGap = 16;

  const tableWidth = Math.min(pageWidth - Math.round(19 * unit) * 2, contentMaxWidth);
  const tableContentWidth = tableWidth - rowPadding * 2;
  const margin = (pageWidth - tableWidth) / 2;

  const columnWidths: ColumnWidths = [
    (tableContentWidth * columnWidthPercentages[0]) / 100,
    (tableContentWidth * columnWidthPercentages[1]) / 100,
    (tableContentWidth * columnWidthPercentages[2]) / 100,
  ];

  const headerTop = Math.round(17 * unit);
  const headerHeight = renderProKeyHeader({ width: tableWidth, verification, i18n }).getClientRect().height;
  const contentTop = headerTop + headerHeight + sectionGap;

  const footerY = pageHeight - Math.round(15 * unit) - textXs;
  const contentBottom = footerY - 12;

  const verificationGroup = await renderVerification({ verification, width: tableWidth, i18n });
  const verificationHeight = verificationGroup.getClientRect().height;

  const maxTableHeight = contentBottom - contentTop;

  const groupedRows = groupRowsIntoPages({
    recipients,
    maxHeight: maxTableHeight,
    firstPageMaxHeight: maxTableHeight - verificationHeight - sectionGap,
    columnWidths,
    i18n,
    envelopeOwner,
    timeZone: verification.timeZone,
  });

  const tables = renderTables({ groupedRows, columnWidths, i18n, filled: true });
  const microtext = i18n._(msg`PROKEY · VERIFIABLE SIGNATURE`);

  let stage: Konva.Stage | null = new Konva.Stage({ width: pageWidth, height: pageHeight });
  const pages: Uint8Array[] = [];

  for (const [index, table] of tables.entries()) {
    stage.destroyChildren();
    const page = new Konva.Layer();

    page.add(renderSecurityBackground({ pageWidth, pageHeight, microtext }));

    const header = renderProKeyHeader({ width: tableWidth, verification, i18n });
    header.setAttrs({ x: margin, y: headerTop } satisfies Partial<Konva.GroupConfig>);
    page.add(header);

    let y = contentTop;

    if (index === 0) {
      verificationGroup.setAttrs({ x: margin, y } satisfies Partial<Konva.GroupConfig>);
      page.add(verificationGroup);
      y += verificationHeight + sectionGap;
    }

    table.setAttrs({ x: margin, y } satisfies Partial<Konva.GroupConfig>);
    page.add(table);

    page.add(renderProKeyFooter({ x: margin, y: footerY, width: tableWidth, envelopeId, i18n }));

    stage.add(page);

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const canvas = page.canvas._canvas as unknown as Canvas;
    const buffer = await canvas.toBuffer('pdf');
    pages.push(new Uint8Array(buffer));
  }

  stage.destroy();
  stage = null;

  return pages;
};

export async function renderCertificate({
  recipients,
  envelopeId,
  qrToken,
  verification,
  hidePoweredBy,
  i18n,
  envelopeOwner,
  pageWidth,
  pageHeight,
}: GenerateCertificateOptions) {
  ensureFontLibrary();

  if (verification) {
    return await renderProKeyCertificate({
      recipients,
      envelopeId,
      verification,
      i18n,
      envelopeOwner,
      pageWidth,
      pageHeight,
    });
  }

  const minimumMargin = 10;

  const tableWidth = Math.min(pageWidth - minimumMargin * 2, contentMaxWidth);
  const tableContentWidth = tableWidth - rowPadding * 2;
  const margin = (pageWidth - tableWidth) / 2;

  const columnOneWidth = (tableContentWidth * columnWidthPercentages[0]) / 100;
  const columnTwoWidth = (tableContentWidth * columnWidthPercentages[1]) / 100;
  const columnThreeWidth = (tableContentWidth * columnWidthPercentages[2]) / 100;

  const columnWidths: ColumnWidths = [columnOneWidth, columnTwoWidth, columnThreeWidth];

  // Helper to render a Konva stage to a PNG buffer
  let stage: Konva.Stage | null = new Konva.Stage({ width: pageWidth, height: pageHeight });

  const maxTableHeight = pageHeight - pageTopMargin - pageBottomMargin;

  const groupedRows = groupRowsIntoPages({
    recipients,
    maxHeight: maxTableHeight,
    columnWidths,
    i18n,
    envelopeOwner,
  });

  const tables = renderTables({ groupedRows, columnWidths, i18n });

  const brandingGroup = await renderBranding({ qrToken, i18n });
  const showBrandingGroup = !hidePoweredBy;
  const brandingRect = brandingGroup.getClientRect();
  const brandingTopPadding = 24;

  const pages: Uint8Array[] = [];

  let isQrPlaced = false;

  // Add a table to each page.
  for (const [index, table] of tables.entries()) {
    stage.destroyChildren();
    const page = new Konva.Layer();

    const group = new Konva.Group();

    const titleText = new Konva.Text({
      x: margin,
      y: 0,
      height: pageTopMargin,
      verticalAlign: 'middle',
      text: i18n._(msg`Signing Certificate`),
      fontFamily: 'Inter',
      fontSize: titleFontSize,
      fontStyle: '700',
    });

    table.setAttrs({
      x: margin,
      y: pageTopMargin,
    } satisfies Partial<Konva.GroupConfig>);

    group.add(titleText);
    group.add(table);

    // Add QR code and branding on the last page if there is space.
    if (index === tables.length - 1 && showBrandingGroup) {
      const remainingHeight = pageHeight - group.getClientRect().height - pageBottomMargin;

      if (brandingRect.height + brandingTopPadding <= remainingHeight) {
        brandingGroup.setAttrs({
          x: pageWidth - brandingRect.width - margin,
          y: group.getClientRect().height + brandingTopPadding,
        } satisfies Partial<Konva.GroupConfig>);

        page.add(brandingGroup);
        isQrPlaced = true;
      }
    }

    const footerText = new Konva.Text({
      x: margin,
      y: pageHeight - textXs - 10,
      text: `${i18n._(msg`Envelope ID`)}: ${envelopeId}`,
      fontFamily: 'Inter',
      fontSize: textXs,
      fill: textMutedForegroundLight,
    });
    page.add(footerText);

    page.add(group);
    stage.add(page);

    // Export the page and save it.
    const canvas = page.canvas._canvas as unknown as Canvas; // eslint-disable-line @typescript-eslint/consistent-type-assertions
    const buffer = await canvas.toBuffer('pdf');
    pages.push(new Uint8Array(buffer));
  }

  // Need to create an empty page for the QR code if it hasn't been placed yet.
  if (showBrandingGroup && !isQrPlaced) {
    const page = new Konva.Layer();

    brandingGroup.setAttrs({
      x: pageWidth - brandingRect.width - margin,
      y: pageTopMargin / 2, // Less padding since there's nothing else on this page.
    } satisfies Partial<Konva.GroupConfig>);

    const overflowFooterText = new Konva.Text({
      x: margin,
      y: pageHeight - textXs - 10,
      text: `${i18n._(msg`Envelope ID`)}: ${envelopeId}`,
      fontFamily: 'Inter',
      fontSize: textXs,
      fill: textMutedForegroundLight,
    });
    page.add(overflowFooterText);

    page.add(brandingGroup);
    stage.add(page);

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const canvas = page.canvas._canvas as unknown as Canvas;
    const buffer = await canvas.toBuffer('pdf');

    pages.push(new Uint8Array(buffer));
  }

  stage.destroy();
  stage = null;

  return pages;
}
