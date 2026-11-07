import assert from 'node:assert/strict';
import { applyDiscount } from './discount.mjs';
import { receiptFor } from './checkout.mjs';

assert.equal(applyDiscount(100, 10), 90);
assert.equal(applyDiscount(100, 0), 100);
assert.equal(applyDiscount(80, 25), 60);
assert.deepEqual(
  receiptFor({
    subtotal: 100,
    discountPercent: 10,
    shipping: 5,
    taxPercent: 20,
    currency: 'EUR',
  }),
  { currency: 'EUR', total: 114 },
);
assert.deepEqual(
  receiptFor({
    subtotal: 100,
    discountPercent: 0,
    shipping: 5,
    taxPercent: 20,
    currency: 'EUR',
  }),
  { currency: 'EUR', total: 126 },
);
assert.deepEqual(
  receiptFor({
    subtotal: 80,
    discountPercent: 25,
    shipping: 10,
    taxPercent: 10,
    currency: 'USD',
  }),
  { currency: 'USD', total: 77 },
);
assert.deepEqual(
  receiptFor({
    subtotal: 19.99,
    discountPercent: 10,
    shipping: 4.5,
    taxPercent: 25,
    currency: 'EUR',
  }),
  { currency: 'EUR', total: 28.11 },
);
assert.deepEqual(
  receiptFor({
    subtotal: 10.005,
    discountPercent: 0,
    shipping: 0,
    taxPercent: 0,
    currency: 'EUR',
  }),
  { currency: 'EUR', total: 10.01 },
);
console.log('CHECKOUT_CONTRACT_OK');
