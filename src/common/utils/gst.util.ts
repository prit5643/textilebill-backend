/**
 * GST Calculation Utilities for Indian Tax System
 *
 * Supports: CGST + SGST (intra-state), IGST (inter-state)
 * GST Slabs: 0%, 0.1%, 0.25%, 1%, 1.5%, 3%, 5%, 7.5%, 12%, 18%, 28%, 40%
 */

export interface GstBreakdown {
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  totalAmount: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
}

export const GST_SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 7.5, 12, 18, 28, 40];

/**
 * Calculate GST breakdown for a given amount and rate.
 * @param taxableAmount - Amount before tax
 * @param gstRate - GST rate percentage (e.g., 18 for 18%)
 * @param isInterState - true for IGST, false for CGST+SGST
 */
export function calculateGst(
  taxableAmount: number,
  gstRate: number,
  isInterState: boolean,
): GstBreakdown {
  const totalTax = roundToTwo(taxableAmount * (gstRate / 100));

  if (isInterState) {
    return {
      taxableAmount: roundToTwo(taxableAmount),
      cgst: 0,
      sgst: 0,
      igst: totalTax,
      totalTax,
      totalAmount: roundToTwo(taxableAmount + totalTax),
      cgstRate: 0,
      sgstRate: 0,
      igstRate: gstRate,
    };
  }

  const halfRate = gstRate / 2;
  const cgst = roundToTwo(taxableAmount * (halfRate / 100));
  const sgst = roundToTwo(taxableAmount * (halfRate / 100));

  return {
    taxableAmount: roundToTwo(taxableAmount),
    cgst,
    sgst,
    igst: 0,
    totalTax: roundToTwo(cgst + sgst),
    totalAmount: roundToTwo(taxableAmount + cgst + sgst),
    cgstRate: halfRate,
    sgstRate: halfRate,
    igstRate: 0,
  };
}

/**
 * Back-calculate taxable amount from tax-inclusive price.
 * @param inclusiveAmount - Amount including tax
 * @param gstRate - GST rate percentage
 */
export function calculateTaxableFromInclusive(
  inclusiveAmount: number,
  gstRate: number,
): number {
  return roundToTwo(inclusiveAmount / (1 + gstRate / 100));
}

/**
 * Standard Indian rounding: round to nearest rupee.
 * If decimal >= 0.50, round up; otherwise round down.
 */
export function roundOff(amount: number): {
  rounded: number;
  roundOff: number;
} {
  const rounded = Math.round(amount);
  const roundOffAmt = roundToTwo(rounded - amount);
  return { rounded, roundOff: roundOffAmt };
}

/**
 * Round to 2 decimal places.
 */
function roundToTwo(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}
