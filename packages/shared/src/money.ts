/**
 * Money helpers. All monetary values are stored and passed as INTEGER PAISE
 * (₹1 = 100 paise) server-side; formatting to ₹ happens only at the view layer.
 */

export const PAISE_PER_RUPEE = 100;

export function paiseToRupees(paise: number): number {
  return paise / PAISE_PER_RUPEE;
}

/**
 * The price actually charged: the discount price when it is set (> 0) and
 * lower than the list price, otherwise the list price. 0 means free.
 */
export function effectivePricePaise(
  price: number,
  discountPrice: number,
): number {
  return discountPrice > 0 && discountPrice < price ? discountPrice : price;
}

export function isFree(price: number, discountPrice: number): boolean {
  return effectivePricePaise(price, discountPrice) <= 0;
}

/** Format paise as an INR currency string, e.g. 129900 -> "₹1,299". */
export function formatINR(paise: number): string {
  const rupees = paiseToRupees(paise);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    // Whole rupees show no decimals; fractional amounts show 2.
    minimumFractionDigits: rupees % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/** Alias kept for the contract naming in the spec. */
export const formatPaise = formatINR;
