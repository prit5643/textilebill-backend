import { Injectable } from '@nestjs/common';
import PdfPrinter from 'pdfmake/js/Printer';
import * as fs from 'fs';

import * as path from 'path';

type TDocumentDefinitions = Record<string, unknown>;
type TableCell = Record<string, unknown>;

function resolvePdfFontPath(fileName: string): string {
  const candidates = [
    path.join(process.cwd(), 'node_modules/pdfmake/fonts/Roboto', fileName),
    path.join(
      path.dirname(require.resolve('pdfmake/package.json')),
      'fonts/Roboto',
      fileName,
    ),
    path.join(
      __dirname,
      '../../../../node_modules/pdfmake/fonts/Roboto',
      fileName,
    ),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to locate pdfmake font file: ${fileName}`);
}

const fonts = {
  Roboto: {
    normal: resolvePdfFontPath('Roboto-Regular.ttf'),
    bold: resolvePdfFontPath('Roboto-Medium.ttf'),
    italics: resolvePdfFontPath('Roboto-Italic.ttf'),
    bolditalics: resolvePdfFontPath('Roboto-MediumItalic.ttf'),
  },
};

function fmt(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtQty(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  // Don't format with 2 decimals if it's an integer or requires fewer decimals,
  // but for consistency with the image, let's keep it clean.
  // The image shows "600 MTR", so no decimal places needed if it's a whole number.
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}

// Convert numbers to Indian words
function numberToWords(num: number): string {
  if (!Number.isFinite(num) || isNaN(num) || num < 0) return '';
  if (num === 0) return 'Zero';

  const a = [
    '',
    'One ',
    'Two ',
    'Three ',
    'Four ',
    'Five ',
    'Six ',
    'Seven ',
    'Eight ',
    'Nine ',
    'Ten ',
    'Eleven ',
    'Twelve ',
    'Thirteen ',
    'Fourteen ',
    'Fifteen ',
    'Sixteen ',
    'Seventeen ',
    'Eighteen ',
    'Nineteen ',
  ];
  const b = [
    '',
    '',
    'Twenty',
    'Thirty',
    'Forty',
    'Fifty',
    'Sixty',
    'Seventy',
    'Eighty',
    'Ninety',
  ];

  function convertInt(n: number): string {
    if (n < 20) return a[n];
    if (n < 100)
      return b[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + a[n % 10] : '');
    if (n < 1000)
      return (
        a[Math.floor(n / 100)] +
        'Hundred ' +
        (n % 100 !== 0 ? 'And ' + convertInt(n % 100) : '')
      );
    if (n < 100000)
      return (
        convertInt(Math.floor(n / 1000)) +
        'Thousand ' +
        (n % 1000 !== 0 ? convertInt(n % 1000) : '')
      );
    if (n < 10000000)
      return (
        convertInt(Math.floor(n / 100000)) +
        'Lakh ' +
        (n % 100000 !== 0 ? convertInt(n % 100000) : '')
      );
    return (
      convertInt(Math.floor(n / 10000000)) +
      'Crore ' +
      (n % 10000000 !== 0 ? convertInt(n % 10000000) : '')
    );
  }

  const intPart = Math.floor(num);
  const words = convertInt(intPart);
  return words.trim() + ' Rupees';
}

@Injectable()
export class PdfService {
  async generateInvoicePdf(invoice: any, company: any): Promise<Buffer> {
    const asNumber = (value: unknown): number => {
      const parsed = Number(value ?? 0);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const account = invoice?.account?.party
      ? {
          ...invoice.account.party,
          name: invoice.account.party.name,
          gstin: invoice.account.party.gstin,
          phone: invoice.account.party.phone,
          address: invoice.account.party.address,
        }
      : (invoice?.account ?? {});

    const normalizedItems = (invoice.items || []).map((item: any) => {
      const amount = asNumber(item.totalAmount ?? item.amount);
      const taxRate = asNumber(item.gstRate ?? item.taxRate);
      const taxAmount = asNumber(item.taxAmount);
      const taxableAmount = asNumber(
        item.taxableAmount ?? Math.max(0, amount - taxAmount),
      );

      return {
        ...item,
        quantity: asNumber(item.quantity),
        rate: asNumber(item.rate),
        amount,
        totalAmount: amount,
        gstRate: taxRate,
        taxableAmount,
        cgstAmount: asNumber(item.cgstAmount ?? taxAmount / 2),
        sgstAmount: asNumber(item.sgstAmount ?? taxAmount / 2),
        igstAmount: asNumber(item.igstAmount ?? 0),
      };
    });

    const subtotal = asNumber(
      invoice.subtotal ??
        invoice.subTotal ??
        normalizedItems.reduce(
          (sum: number, item: any) => sum + item.amount,
          0,
        ),
    );
    const totalDiscount = asNumber(
      invoice.totalDiscount ?? invoice.discountAmount,
    );
    const taxableAmount = asNumber(
      invoice.taxableAmount ?? Math.max(0, subtotal - totalDiscount),
    );
    const totalCgst = asNumber(
      invoice.totalCgst ??
        normalizedItems.reduce(
          (sum: number, item: any) => sum + item.cgstAmount,
          0,
        ),
    );
    const totalSgst = asNumber(
      invoice.totalSgst ??
        normalizedItems.reduce(
          (sum: number, item: any) => sum + item.sgstAmount,
          0,
        ),
    );
    const totalIgst = asNumber(
      invoice.totalIgst ??
        normalizedItems.reduce(
          (sum: number, item: any) => sum + item.igstAmount,
          0,
        ),
    );
    const totalTax = asNumber(
      invoice.totalTax ??
        invoice.taxAmount ??
        totalCgst + totalSgst + totalIgst,
    );
    const grandTotal = asNumber(
      invoice.grandTotal ?? invoice.totalAmount ?? taxableAmount + totalTax,
    );
    const roundOff = asNumber(
      invoice.roundOff ??
        Number((grandTotal - (taxableAmount + totalTax)).toFixed(2)),
    );

    // --- 1. Items Calculation ---
    let totalQty = 0;

    const itemRows: TableCell[][] = normalizedItems.map(
      (item: any, idx: number) => {
        totalQty += Number(item.quantity);
        const uom = item.product?.uom?.name || item.product?.unit || 'MTR';
        return [
          { text: String(idx + 1), alignment: 'center' },
          {
            text: `${item.product?.name || item.productId} - ${item.description || ''}`,
            bold: true,
          },
          {
            text: `${fmtQty(item.quantity)} ${uom}`,
            alignment: 'center',
            bold: true,
          },
          { text: fmt(item.rate), alignment: 'right' },
          { text: fmt(item.totalAmount), alignment: 'right', bold: true },
        ];
      },
    );

    // Add empty rows to maintain minimum height of the items table
    const MIN_ROWS = 12; // Adjust based on how much visual space you want
    const fillRowsCount = Math.max(0, MIN_ROWS - itemRows.length);
    for (let i = 0; i < fillRowsCount; i++) {
      itemRows.push([
        { text: '\n', border: [true, false, true, false] },
        { text: '', border: [true, false, true, false] },
        { text: '', border: [true, false, true, false] },
        { text: '', border: [true, false, true, false] },
        { text: '', border: [true, false, true, false] },
      ]);
    }

    // Fix bottom borders for the last row
    if (itemRows.length > 0) {
      const lastRow = itemRows[itemRows.length - 1];
      for (let j = 0; j < lastRow.length; j++) {
        const cell = lastRow[j] as any;
        if (cell.border) {
          cell.border = [true, false, true, true];
        }
      }
    }

    // --- 2. Build the PDF Document ---
    const cgstPercent = normalizedItems[0]?.gstRate
      ? Number(normalizedItems[0].gstRate) / 2
      : 2.5;
    const sgstPercent = cgstPercent;
    const igstPercent = normalizedItems[0]?.gstRate
      ? Number(normalizedItems[0].gstRate)
      : 0;

    const hasIgst = totalIgst > 0;

    const docDef: TDocumentDefinitions = {
      pageSize: 'A4',
      pageMargins: [20, 20, 20, 20],
      defaultStyle: {
        fontSize: 9,
        font: 'Roboto',
      },
      content: [
        // ---------- COMPANY HEADER ----------
        {
          table: {
            widths: ['*'],
            body: [
              [
                {
                  stack: [
                    {
                      text: company?.name?.toUpperCase() || 'COMPANY NAME',
                      fontSize: 22,
                      bold: true,
                      alignment: 'center',
                      margin: [0, 5, 0, 5],
                    },
                    {
                      text: company?.address || '',
                      alignment: 'center',
                      fontSize: 10,
                    },
                    {
                      text: company?.phone
                        ? `Tel/M : ${company.phone}`
                        : 'Tel/M : ',
                      alignment: 'center',
                      fontSize: 10,
                    },
                    {
                      text: `GSTIN : ${company?.gstin || ''}`,
                      alignment: 'center',
                      fontSize: 10,
                      margin: [0, 0, 0, 5],
                    },
                  ],
                  border: [true, true, true, true],
                },
              ],
            ],
          },
          layout: {
            // We'll manage borders via adjacent tables to look continuous
            hLineWidth: () => 1,
            vLineWidth: () => 1,
          },
        },

        // ---------- TAX INVOICE STRIP ----------
        {
          table: {
            widths: ['*', 'auto'],
            body: [
              [
                {
                  text: 'TAX INVOICE',
                  fontSize: 13,
                  bold: true,
                  alignment: 'center',
                  margin: [120, 2, 0, 2],
                },
                {
                  text: '[ ] Original [ ] Duplicate [ ] Transporter',
                  fontSize: 8,
                  alignment: 'right',
                  margin: [0, 5, 5, 0],
                },
              ],
            ],
          },
          layout: {
            hLineWidth: (i: number) => (i === 0 ? 0 : 1), // Suppress top border to merge with header
            vLineWidth: () => 1,
          },
        },

        // ---------- PARTY & INVOICE DETAILS ----------
        {
          table: {
            widths: ['*', 200],
            body: [
              [
                // Left Column: Party Details
                {
                  stack: [
                    { text: 'To ,', margin: [0, 0, 0, 2] },
                    {
                      text: account?.name?.toUpperCase() || '',
                      bold: true,
                      fontSize: 10,
                      margin: [0, 0, 0, 4],
                    },
                    {
                      text: `Address : ${account?.address || ''}`,
                      margin: [0, 0, 0, 2],
                    },
                    {
                      text: [account?.city, account?.state, account?.pincode]
                        .filter(Boolean)
                        .join(', '),
                      margin: [0, 0, 0, 2],
                    },
                    {
                      text: [
                        { text: `State : `, bold: false },
                        {
                          text: `${account?.state || 'Gujarat'}`,
                          bold: true,
                        },
                        { text: `    State Code : `, bold: false },
                        { text: `24`, bold: true },
                      ],
                      margin: [0, 0, 0, 2],
                    },
                    {
                      text: [
                        { text: `GSTIN : `, bold: false },
                        { text: `${account?.gstin || ''}`, bold: true },
                        { text: `   PAN NO : `, bold: false },
                        {
                          text: `${account?.pan || account?.gstin?.substring(2, 12) || ''}`,
                          bold: true,
                        },
                      ],
                      margin: [0, 0, 0, 2],
                    },
                  ],
                  border: [true, false, true, true],
                  margin: [5, 5, 5, 5],
                },
                // Right Column: Invoice Details
                {
                  stack: [
                    {
                      columns: [
                        { text: 'Invoice No.', width: 65 },
                        { text: `: ${invoice.invoiceNumber}`, bold: true },
                      ],
                      margin: [0, 0, 0, 2],
                    },
                    {
                      columns: [
                        { text: 'Date', width: 65 },
                        {
                          text: `: ${new Date(invoice.invoiceDate).toLocaleDateString('en-GB').replace(/\//g, '-')}`,
                          bold: true,
                        },
                      ],
                      margin: [0, 0, 0, 2],
                    },
                    {
                      columns: [
                        { text: 'Co.Challan', width: 65 },
                        { text: `: ${invoice.coChallanNo || '...'}` },
                      ],
                      margin: [0, 0, 0, 2],
                    },
                    {
                      columns: [
                        { text: 'Party\nChallan', width: 65 },
                        { text: `: ${invoice.partyChallanNo || '...'}` },
                      ],
                      margin: [0, 0, 0, 2],
                    },
                    {
                      columns: [
                        { text: 'HSN Code', width: 65 },
                        {
                          text: `: ${invoice.hsnCodeHeader || normalizedItems[0]?.product?.hsnCode || ''}`,
                        },
                      ],
                      margin: [0, 0, 0, 2],
                    },
                  ],
                  border: [false, false, true, true],
                  margin: [5, 5, 5, 5],
                },
              ],
            ],
          },
          layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
          },
        },

        // ---------- ITEMS TABLE ----------
        {
          table: {
            headerRows: 1,
            widths: [20, '*', 100, 60, 80],
            body: [
              // Header Row
              [
                {
                  text: 'SR',
                  alignment: 'center',
                  border: [true, false, true, true],
                },
                {
                  text: 'Description Of Goods',
                  alignment: 'center',
                  border: [true, false, true, true],
                },
                {
                  text: 'Quantity',
                  alignment: 'center',
                  border: [true, false, true, true],
                },
                {
                  text: 'Rate',
                  alignment: 'center',
                  border: [true, false, true, true],
                },
                {
                  text: 'Sub Total',
                  alignment: 'center',
                  border: [true, false, true, true],
                },
              ],
              // Items
              ...itemRows,
              // Total Row
              [
                { text: '', border: [true, false, false, true] },
                {
                  text: 'TOTAL',
                  alignment: 'right',
                  bold: true,
                  border: [false, false, true, true],
                },
                {
                  text: `${fmtQty(totalQty)}`,
                  alignment: 'center',
                  bold: true,
                  border: [true, false, true, true],
                },
                { text: '', border: [true, false, false, true] },
                { text: '', border: [false, false, true, true] },
              ],
            ],
          },
          layout: {
            hLineWidth: (i: number) => (i === 0 ? 0 : 1), // Merge top line
            vLineWidth: () => 1,
          },
        },

        // ---------- BANK DETAILS & TAX SUMMARY ----------
        {
          table: {
            widths: ['*', 196],
            body: [
              [
                // Left Column: Bank Details
                {
                  stack: [
                    {
                      text: "Company's Bank Details",
                      bold: true,
                      margin: [0, 0, 0, 4],
                    },
                    {
                      columns: [
                        { text: 'Name', width: 60 },
                        { text: `: ${company?.bankName || ''}` },
                      ],
                      margin: [0, 0, 0, 2],
                    },
                    {
                      columns: [
                        { text: 'A/C. No', width: 60 },
                        { text: `: ${company?.bankAccountNo || ''}` },
                      ],
                      margin: [0, 0, 0, 2],
                    },
                    {
                      columns: [
                        { text: 'IFSC Code', width: 60 },
                        { text: `: ${company?.bankIfsc || ''}` },
                      ],
                      margin: [0, 0, 0, 2],
                    },
                    {
                      columns: [
                        { text: 'Branch', width: 60 },
                        { text: `: ${company?.bankBranch || ''}` },
                      ],
                      margin: [0, 0, 0, 2],
                    },
                  ],
                  border: [true, false, true, true],
                  margin: [2, 2, 2, 2],
                },
                // Right Column: Tax Summary Table
                {
                  table: {
                    widths: ['*', 76],
                    body: [
                      [
                        {
                          text: 'Sub Total',
                          alignment: 'right',
                          border: [false, false, true, true],
                        },
                        {
                          text: fmt(subtotal),
                          alignment: 'right',
                          bold: true,
                          border: [false, false, false, true],
                        },
                      ],
                      [
                        {
                          text: `Discount (0.0%)`,
                          alignment: 'right',
                          border: [false, false, true, true],
                        },
                        {
                          text: fmt(totalDiscount),
                          alignment: 'right',
                          bold: true,
                          border: [false, false, false, true],
                        },
                      ],
                      [
                        {
                          text: 'Sub Total',
                          alignment: 'right',
                          border: [false, false, true, true],
                        },
                        {
                          text: fmt(taxableAmount),
                          alignment: 'right',
                          bold: true,
                          border: [false, false, false, true],
                        },
                      ],
                      [
                        {
                          text: `CGST(${hasIgst ? '0.0' : cgstPercent}%)`,
                          alignment: 'right',
                          border: [false, false, true, true],
                        },
                        {
                          text: fmt(totalCgst),
                          alignment: 'right',
                          bold: true,
                          border: [false, false, false, true],
                        },
                      ],
                      [
                        {
                          text: `SGST(${hasIgst ? '0.0' : sgstPercent}%)`,
                          alignment: 'right',
                          border: [false, false, true, true],
                        },
                        {
                          text: fmt(totalSgst),
                          alignment: 'right',
                          bold: true,
                          border: [false, false, false, true],
                        },
                      ],
                      [
                        {
                          text: `IGST(${hasIgst ? igstPercent : '0.0'}%)`,
                          alignment: 'right',
                          border: [false, false, true, true],
                        },
                        {
                          text: fmt(totalIgst),
                          alignment: 'right',
                          bold: true,
                          border: [false, false, false, true],
                        },
                      ],
                      [
                        {
                          text: 'Round Off',
                          alignment: 'right',
                          border: [false, false, true, true],
                        },
                        {
                          text: fmt(roundOff),
                          alignment: 'right',
                          bold: true,
                          border: [false, false, false, true],
                        },
                      ],
                      [
                        {
                          text: 'Total',
                          alignment: 'right',
                          border: [false, false, true, true],
                        },
                        {
                          text: fmt(grandTotal),
                          alignment: 'right',
                          bold: true,
                          border: [false, false, false, true],
                        },
                      ],
                      [
                        {
                          text: 'TDS %',
                          alignment: 'right',
                          border: [false, false, true, true],
                        },
                        {
                          text: '',
                          alignment: 'right',
                          border: [false, false, false, true],
                        },
                      ],
                      [
                        {
                          text: 'Total Amount',
                          alignment: 'right',
                          border: [false, false, true, false],
                        },
                        {
                          text: '',
                          alignment: 'right',
                          border: [false, false, false, false],
                        },
                      ],
                    ],
                  },
                  layout: {
                    hLineWidth: () => 1,
                    vLineWidth: () => 1,
                  },
                  margin: [0, 0, 0, 0],
                  border: [false, false, true, true],
                },
              ],
            ],
          },
          layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
          },
        },

        // ---------- AMOUNT IN WORDS ----------
        {
          table: {
            widths: ['*'],
            body: [
              [
                {
                  columns: [
                    { text: 'Amt. Chargeable (words) ', width: 'auto' },
                    {
                      text: numberToWords(grandTotal),
                      bold: true,
                      width: '*',
                    },
                    {
                      text: 'E. & OE.',
                      alignment: 'right',
                      width: 'auto',
                      bold: true,
                    },
                  ],
                },
              ],
              [{ text: 'Only', bold: true, margin: [0, -2, 0, 0] }],
            ],
          },
          layout: {
            hLineWidth: (i: number) => (i === 0 ? 0 : 1), // Merge top
            vLineWidth: () => 1,
            paddingTop: () => 4,
            paddingBottom: () => 2,
          },
        },

        // ---------- FOOTER: TERMS & SIGNATURE ----------
        {
          table: {
            widths: ['*', 196],
            body: [
              [
                // Terms
                {
                  stack: [
                    { text: 'Terms and Condition:', bold: true, fontSize: 8 },
                    {
                      text:
                        invoice.termsAndConditions ||
                        'payment amount due date 45 days',
                      fontSize: 7,
                    },
                  ],
                  border: [true, false, true, true],
                  margin: [2, 2, 2, 2],
                },
                // Signature
                {
                  stack: [
                    {
                      text: `For, ${company?.name?.toUpperCase() || 'COMPANY NAME'}`,
                      bold: true,
                    },
                    { text: '', margin: [0, 40, 0, 0] }, // Signature space
                    {
                      text: 'Authorised Signatory',
                      alignment: 'left',
                      fontSize: 8,
                    },
                  ],
                  border: [false, false, true, true],
                  margin: [2, 2, 2, 2],
                },
              ],
            ],
          },
          layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
          },
        },
      ],
    };

    return new Promise<Buffer>(async (resolve, reject) => {
      try {
        const printer = new (PdfPrinter as any)(fonts);
        const doc = await printer.createPdfKitDocument(docDef);
        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}
