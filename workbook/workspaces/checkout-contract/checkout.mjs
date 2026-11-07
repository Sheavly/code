import { cartTotal } from './cart.mjs';

export function receiptFor(order) {
  return {
    currency: order.currency,
    total: Math.round(cartTotal(order) * 100) / 100,
  };
}
