import assert from 'node:assert/strict';
import { invoiceTotal } from './invoice.mjs';

assert.equal(invoiceTotal({ subtotal: 100, discountPercent: 10 }), 90);
assert.equal(invoiceTotal({ subtotal: 100, discountPercent: 0 }), 100);
assert.equal(invoiceTotal({ subtotal: 80, discountPercent: 25 }), 60);
console.log('INVOICE_CHECK_OK');
