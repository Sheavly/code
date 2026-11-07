export function applyDiscount(subtotal, discountPercent) {
  return subtotal * (1 - discountPercent / 100);
}
