/** Parse a user-entered dollar amount ("$165", "165.50", "1,250") to positive integer cents. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(parseFloat(cleaned) * 100);
  return cents > 0 ? cents : null;
}

/** Format integer cents as USD for display: 66000 -> "$660", 66050 -> "$660.50". */
export function formatCents(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
