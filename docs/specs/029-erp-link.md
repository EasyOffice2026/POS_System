# 029 — Link with the ERP (nexera-erp)

The POS is one part of a single platform whose accounting, purchases, expenses, payments, HR,
documents and contracts live in nexera-erp. The POS keeps its own code and database. The ERP
reads the accounting figures of the POS, and signs people into the POS without a second login.

## Rules

1. **Integration keys.** A group administrator makes a key (`POST /api/v1/integration-keys`,
   name required). The key (`posk_…`) is shown once; only its SHA-256 is kept. Keys are listed
   (never the key itself, with the time last used) and revoked (`DELETE /:id`). A revoked key
   stops working at once.
2. **Accounting figures** (read only, bearer integration key, every brand):
   - `GET /api/v1/accounting/structure`: brands, their branches, and their ways of payment
     (cash first, then the brand's methods), for the ERP to map to its companies and accounts.
   - `GET /api/v1/accounting/days?from&to`: one entry per branch and business day with activity:
     paid orders, gross (subtotal), discounts (manual + promotion + points), net, payments by
     way of payment with platform commission, refunds by way of payment with commission, cash
     over (+) or short (−) of the shifts closed that day, and the cost (at ingredient cost) of
     stock sold, wasted and found missing at counts. Refunds, shift closes and stock movements
     count on the business day of their branch (time zone and day end). Each entry has a stable
     id `day:<branchId>:<date>`; its figures may change while the day is still being worked, so
     the ERP compares and re-posts.
   - `GET /api/v1/accounting/goods-receipts?from&to`: each received purchase order (id
     `grn:<id>`) with supplier, invoice number, received total and business date.
   - A range covers at most 31 days and may not end before it starts (400).
3. **Single sign-on.** When `SSO_ISSUER` is set, `POST /api/v1/auth/sso {ticket}` takes a JWT
   the ERP signed with EdDSA (its public keys at `SSO_JWKS_URL`, default
   `<issuer>/api/v1/sso/jwks.json`), for audience `SSO_AUDIENCE`, at most 2 minutes old, with
   `email` and `jti`. It signs in the active password user with that email, like a login (session
   - refresh cookie). A ticket is used once; a wrong, old, reused ticket, or one for nobody
     known, is 401 and written to the audit log (`auth.sso.failed`). The web app's `/sso#ticket=…`
     page posts the ticket and opens the back office.
