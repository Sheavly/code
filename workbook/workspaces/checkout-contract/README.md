# Checkout calculation

`checkout.mjs` exposes receipts, `cart.mjs` combines discounted merchandise, shipping and tax,
and `discount.mjs` owns the discount calculation. All percentages use percentage points:
10 means ten percent, not 0.1.

Use `node check.mjs` to check receipts and the discount helper's public contract.
