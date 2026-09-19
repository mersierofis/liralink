# Open Questions

Things the docs do not specify. The mocks do **not** invent fields for these; where a mock had to
pick a behaviour, the assumption is listed. Answer here, then update `docs/00-PROJECT.md` first.

## merchant-web

1. **Link detail → settlement timeline.** `GET /links/:id` returns no settlement, and neither
   `/settlements` nor `/payments` can be filtered by link. How does link detail get the settlement
   of one link? Needs `settlement` on `PaymentLink`, or a `linkId` filter. *Mock assumption: none
   yet; the screen has to scan `/payments` pages.*
2. **Dashboard "Links open / paid this week".** No stats endpoint and no date filter on `/links`.
   Only `status` is filterable, so "paid this week" is not derivable without fetching everything.
3. **Auto-payout history.** `03-MERCHANT-WEB.md` shows "the payout history" on `/withdrawals` in
   `auto_payout` mode. Is that `/settlements` (completed, `netTRY`)? `/withdrawals` is `409` for
   creation in that mode; does the list return empty?
4. **Pagination.** Is `page` 0- or 1-based, and what are the default and maximum `limit`?
   *Mock: 1-based, default 20, no maximum.*
5. **`Settlement.amountUSDC` with auto-save.** Is it the full payment or only the part sent to the
   anchor? `netTRY = amountTRY × (amountUSDC − feeUSDC) / amountUSDC` only makes sense for the
   converted part. *Mock: `amountUSDC = quotedUSDC − savedUSDC`.*
6. **`fxRate` decimal places.** Money has 2 dp (TRY) and 7 dp (USDC); the rate has none stated.
   *Mock: 2 dp, `"34.00"`.*
7. **Rounding of `quotedUSDC`.** Floor or round-half-up to 7 dp? *Mock: floor.*
8. **Register.** Password rules on `POST /auth/register` (only `newPassword ≥ 8` is stated) and the
   status for an email that already exists. *Mock: any non-empty password, `409`.*
9. **Validation error shape.** `ApiError.message` is a `string`; NestJS validation usually sends
   `string[]`. Which one will the API return for `400`?
10. **`expiresInHours` limits.** Minimum and maximum are not stated.
11. **Mock demo password.** The doc says `DEMO_PASSWORD` is a placeholder. *Mock: the literal
    string `DEMO_PASSWORD`; no env variable, since none is in the `VITE_*` table.*
12. **IBAN display.** The doc writes the demo IBAN with spaces (`TR00 0000 …`) but the API regex is
    `^TR\d{24}$`. *Mock: stored without spaces; the UI groups it for display.*
13. **Pay URL in mock mode.** `payUrl = PAY_WEB_BASE_URL + '/' + code` is a backend variable. What
    should the mock use for pay-web in dev? *Mock: `http://localhost:5174/pay/<code>`.*

## pay-web

_Yunus: add your questions below this heading, numbered from 1. Do not edit the merchant-web section._
