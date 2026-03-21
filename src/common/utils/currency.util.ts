const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = [
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

function convertHundreds(num: number): string {
  let result = '';
  if (num >= 100) {
    result += ONES[Math.floor(num / 100)] + ' Hundred';
    num %= 100;
    if (num > 0) result += ' and ';
  }
  if (num >= 20) {
    result += TENS[Math.floor(num / 10)];
    num %= 10;
    if (num > 0) result += ' ' + ONES[num];
  } else if (num > 0) {
    result += ONES[num];
  }
  return result;
}

/**
 * Convert amount to Indian currency words.
 * E.g., 12345.50 → "Twelve Thousand Three Hundred and Forty Five Rupees and Fifty Paise Only"
 */
export function amountToWords(amount: number): string {
  if (amount === 0) return 'Zero Rupees Only';

  const isNegative = amount < 0;
  amount = Math.abs(amount);

  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);

  let result = '';

  if (rupees > 0) {
    // Indian numbering: Crore, Lakh, Thousand, Hundred
    const crore = Math.floor(rupees / 10000000);
    const lakh = Math.floor((rupees % 10000000) / 100000);
    const thousand = Math.floor((rupees % 100000) / 1000);
    const remaining = rupees % 1000;

    if (crore > 0) result += convertHundreds(crore) + ' Crore ';
    if (lakh > 0) result += convertHundreds(lakh) + ' Lakh ';
    if (thousand > 0) result += convertHundreds(thousand) + ' Thousand ';
    if (remaining > 0) result += convertHundreds(remaining);

    result = result.trim() + ' Rupees';
  }

  if (paise > 0) {
    if (rupees > 0) result += ' and ';
    result += convertHundreds(paise) + ' Paise';
  }

  result += ' Only';

  if (isNegative) result = 'Minus ' + result;

  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Format amount as Indian currency string.
 * E.g., 1234567.89 → "₹12,34,567.89"
 */
export function formatCurrency(amount: number, symbol: string = '₹'): string {
  const [intPart, decPart] = Math.abs(amount).toFixed(2).split('.');
  const sign = amount < 0 ? '-' : '';

  // Indian grouping: last 3 digits, then groups of 2
  let formatted = '';
  const len = intPart.length;

  if (len <= 3) {
    formatted = intPart;
  } else {
    formatted = intPart.slice(-3);
    let remaining = intPart.slice(0, -3);
    while (remaining.length > 2) {
      formatted = remaining.slice(-2) + ',' + formatted;
      remaining = remaining.slice(0, -2);
    }
    if (remaining.length > 0) {
      formatted = remaining + ',' + formatted;
    }
  }

  return `${sign}${symbol}${formatted}.${decPart}`;
}
