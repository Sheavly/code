import { applyDiscount } from './discount.mjs';

export function cartTotal(order) {
  const { subtotal, discountPercent, shipping, taxPercent } = order;

  return (applyDiscount(subtotal, discountPercent / 100) + shipping) * (1 + taxPercent / 100);
}
