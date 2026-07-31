import { formatINR } from "@codeapt/shared";

import { cn } from "../../lib/cn.js";

/**
 * Renders a course price from paise: "Free", a plain price, or a discounted
 * price with the original struck through.
 */
export function PriceTag({
  price,
  discountPrice,
  effectivePrice,
  isFree,
  className,
}: {
  price: number;
  discountPrice: number;
  effectivePrice: number;
  isFree: boolean;
  className?: string;
}) {
  if (isFree) {
    return (
      <span className={cn("font-semibold text-success-fg", className)}>
        Free
      </span>
    );
  }
  const discounted = discountPrice > 0 && discountPrice < price;
  return (
    <span className={cn("flex items-baseline gap-2 font-mono", className)}>
      <span className="font-semibold text-ink">
        {formatINR(effectivePrice)}
      </span>
      {discounted ? (
        <span className="text-sm text-ink-muted line-through">
          {formatINR(price)}
        </span>
      ) : null}
    </span>
  );
}
