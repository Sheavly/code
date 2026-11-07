export function invoiceTotal(params) {
  const { subtotal, discountPercent } = params;

  return subtotal * (1 + discountPercent / 100);
}
