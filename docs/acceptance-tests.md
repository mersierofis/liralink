# Acceptance Tests

A manual test suite for LiraLink. A judge or a new team member can run it by hand with a browser, a
phone and a Stellar **testnet** wallet. It needs no code and no automation.

The scenarios are derived from [`00-PROJECT.md`](00-PROJECT.md) (product, domain model, API contract)
and [`api.types.ts`](api.types.ts), with the behaviour details taken from
[`01-BACKEND.md`](01-BACKEND.md), [`02-PAY-WEB.md`](02-PAY-WEB.md), [`03-MERCHANT-WEB.md`](03-MERCHANT-WEB.md)
and [`anchor.md`](anchor.md). If a scenario disagrees with those documents, the documents win: fix the
scenario.

**The deployed demo runs Mode B; Mode A is for local development only.** Mode B is the SEP-6 anchor with
auto-payout to the IBAN, and Mode A is the in-process mock anchor with a withdrawable balance (see
[section 2.1](#21-which-mode-is-the-backend-in)). Run the `[Mode B]` scenarios against the deployed demo.

All merchant names and IBANs are fictional test data. Everything runs on **Stellar testnet** and no
real money moves.

## Contents

1. [How to use this suite](#1-how-to-use-this-suite)
2. [Test environment and setup](#2-test-environment-and-setup)
3. [Merchant accounts](#3-merchant-accounts) — scenarios 1–5
4. [Payment links and the locked quote](#4-payment-links-and-the-locked-quote) — scenarios 6–11
5. [Paying a link](#5-paying-a-link) — scenarios 12–20
6. [Payments that must not credit a link](#6-payments-that-must-not-credit-a-link) — scenarios 21–26
7. [Settlement](#7-settlement) — scenarios 27–31
8. [Withdrawals](#8-withdrawals) — scenarios 32–37
9. [Privacy](#9-privacy) — scenario 38
10. [Not covered](#10-not-covered)
11. [Results sheet](#11-results-sheet)

---

## 1. How to use this suite

Every scenario has the same three parts: **Preconditions**, **Steps** and **Expected result**. A scenario
passes only if **every** line of its expected result holds. Write down what you saw when it does not.

- Run the scenarios in order the first time. Later scenarios reuse the merchant, the wallets and the
  balances from earlier ones, and each scenario says what it needs.
- **Scenario tags.** `[Mode A]` runs only against a backend in *balance* mode. `[Mode B]` runs only in
  *auto-payout* mode. Scenarios without a tag run in both. See [section 2.1](#21-which-mode-is-the-backend-in).
- **Optional** scenarios need something that may not be deployed (the Soroban contract, a way to
  change a link's expiry). They are marked, and a skipped optional scenario is not a failure.
- Money is a decimal string everywhere: TRY has 2 decimals, USDC has 7. When a scenario says "the exact
  USDC amount", read it from the API as described in [section 2.4](#24-reading-exact-values), not from a
  rounded figure on screen.
- The payer page shows USDC to 2 decimals, but the transaction carries all 7. Compare the exact value
  wherever a scenario says "exactly".

## 2. Test environment and setup

### 2.1 Which mode is the backend in

Open `<API_URL>/health` in a browser (`<API_URL>` is the API base ending in `/api`). It returns:

| Field | What it tells you |
|---|---|
| `ok`, `horizon`, `listener` | All of `ok: true`, `horizon: "up"`, `listener: "running"` are required before you start. If not, stop and report it. |
| `anchor` | `mock`, `sep6` or `sep24` |
| `settlementMode` | `balance` (anchor `mock`) → run the **[Mode A]** scenarios. `auto_payout` (anchor `sep6` or `sep24`) → run the **[Mode B]** scenarios |
| `platformAccount` | The `G…` address that receives every payment. Note it down as `<PLATFORM>` |

In **balance** mode the TRY accrues to the merchant's balance and the merchant withdraws it. In
**auto-payout** mode the anchor pays the merchant's IBAN as soon as the settlement completes, and
there is nothing to withdraw. The settlement provider is the one the settlement was created with.

### 2.2 Addresses and URLs you need

| Placeholder | Meaning |
|---|---|
| `<API_URL>` | API base, for example `https://…/api` |
| `<MERCHANT_URL>` | The merchant web app (desktop browser) |
| `<PAY_URL>` | The payer web app. A link is `<PAY_URL>/p/<CODE>` (`payUrl` in the merchant app) |
| `<PLATFORM>` | The platform account from `/health` |
| `<EXPLORER>` | `https://stellar.expert/explorer/testnet` — transactions at `/tx/<hash>`, accounts at `/account/<address>` |
| USDC issuer | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (Circle testnet USDC, code `USDC`) |

### 2.3 Wallets and tools

You need a desktop browser for the merchant and a phone for the payer. The phone flow is the one the
demo uses, but a desktop browser with the Freighter extension also works.

1. **Payer wallet ("Payer").** Freighter (or another wallet supported by Stellar Wallets Kit) set to
   **Testnet**.
   - Fund it with XLM using Friendbot (Stellar Lab → Testnet → Friendbot).
   - Add a **USDC trustline** for the issuer above (Stellar Lab → Change Trust).
   - Get at least **60 testnet USDC** from `faucet.circle.com` (Stellar network). Several scenarios
     spend USDC, so top up when the balance drops below 20.
2. **Merchant wallet ("Merchant wallet").** A second funded testnet account that already has the USDC
   trustline. Used as the destination of the USDC withdrawals in section 8.
3. **Spoof issuer ("Fake issuer").** Two more funded testnet accounts, used only in scenario 24:
   - an account "Fake issuer" that will issue a token also called `USDC`, and
   - a "Fake holder" account that trusts that token. The simplest way is Stellar Lab: build a
     Change Trust operation on Fake holder for asset code `USDC` with Fake issuer as the issuer, then a
     Payment from Fake issuer to Fake holder of 100 of that asset.
4. **Sending a payment by hand.** Scenarios that pay less than the quote, or pay a link the page
   refuses to pay, use the wallet's plain **Send** screen (or Stellar Lab → Build Transaction →
   Payment). Send to `<PLATFORM>`, choose the asset, set the amount and set **Memo type = Text** with
   the link code as the memo. The memo must be the code exactly as shown (uppercase).
5. **An explorer tab** open on `<EXPLORER>`.

### 2.4 Reading exact values

- **Exact USDC due for a link.** Open `<API_URL>/pay/<CODE>` in a browser. `amountUSDC` is the exact
  amount due (7 decimals). `rails.memo.destination` is `<PLATFORM>` and `rails.memo.memo` is the code.
- **Progress of a link.** Open `<API_URL>/pay/<CODE>/status`. It shows `status`, `receivedUSDC` and
  `shortfallUSDC` while the link is underpaid.
- **Full precision in the merchant app.** Hover over a USDC amount: the tooltip shows all 7 decimals.

### 2.5 The merchant used in this suite

Scenario 1 creates the merchant. Use these values so every tester's results look alike:

| Field | Value |
|---|---|
| Email | a fresh address you control, for example `tester+<date>@example.com` |
| Password | a password of at least 8 characters |
| Business name | `Acceptance Test Trading` |
| IBAN | `TR330006100519786457841326` (24 digits after `TR`, no spaces) |

Payment links used below are titled `AT-<scenario number> …` so you can find them again.

---

## 3. Merchant accounts

### Scenario 1 — Register a merchant

**Preconditions:** a browser at `<MERCHANT_URL>`, signed out. An email address that has never been used.

**Steps**
1. Open `<MERCHANT_URL>`. Open the Register page from the sign-in page.
2. Enter the email, the password and the business name from section 2.5. Submit.

**Expected result**
- You are signed in and land on the dashboard. The top bar shows the business name.
- The dashboard is in an empty state ("No links yet — create your first one" or similar), not a blank
  or broken screen.
- The balance card shows zero TRY (available and pending in balance mode, paid-out in auto-payout
  mode). Saved USDC and Unallocated USDC are not shown while they are zero.
- Reloading the page keeps you signed in. Closing the tab and opening a new one signs you out (the
  session lives in `sessionStorage`).

### Scenario 2 — Registration is validated

**Preconditions:** signed out.

**Steps**
1. On the Register page submit with an empty business name.
2. Submit with an email that is not an email address (`not-an-email`).
3. Submit with the email from scenario 1 again.

**Expected result**
- Steps 1 and 2: the form refuses the input with a readable message next to the field, and no account is
  created.
- Step 3: registration is refused with an error message and no second account is created. (The design
  docs do not fix the status code or the password rules for registration; only that the request fails
  cleanly.)

### Scenario 3 — Sign in, sign out and protected pages

**Preconditions:** the merchant from scenario 1 exists.

**Steps**
1. Sign out from the top bar.
2. Without signing in, open `<MERCHANT_URL>/links` directly.
3. On the sign-in page enter the right email and a wrong password. Submit.
4. Enter the right email and the right password. Submit.

**Expected result**
- Step 1: you return to the sign-in page.
- Step 2: you are redirected to the sign-in page. No merchant data is shown.
- Step 3: an "invalid credentials" style error is shown. You stay signed out.
- Step 4: you are signed in and land on the dashboard. Signing in while already signed in redirects
  away from the sign-in page to the dashboard.

### Scenario 4 — Settings: business name, IBAN and auto-save

**Preconditions:** signed in as the merchant.

**Steps**
1. Open Settings. Enter the IBAN from section 2.5 with a space in it (`TR33 0006 …`). Save.
2. Enter an IBAN with the wrong length (`TR12345`). Save.
3. Enter the IBAN from section 2.5 with no spaces. Save.
4. Set the business name to `Acceptance Test Trading` and save.
5. Move the **Auto-save** slider to its maximum, then try to go past it. Then set it back to `0` and
   save.
6. Reload the page.

**Expected result**
- Steps 1 and 2: the IBAN is refused with a message. The rule is `TR` followed by exactly 24 digits.
  The stored IBAN does not change.
- Step 3: the IBAN is saved and a confirmation toast appears.
- Step 5: the slider goes from 0 to 50 and no further. Auto-save is `0` after step 5.
- Step 6: the business name, the IBAN (shown in full: this is the merchant's own profile) and auto-save
  `0` are still there.

### Scenario 5 — Change the password

**Preconditions:** signed in as the merchant.

**Steps**
1. In Settings open the password change. Enter a wrong current password and a valid new password
   (8 or more characters). Submit.
2. Enter the right current password and a new password of only 5 characters. Submit.
3. Enter the right current password and a valid new password. Submit.
4. Sign out. Sign in with the **old** password, then with the **new** one.

**Expected result**
- Step 1: an error is shown **inline next to the form**, and you are **not** signed out.
- Step 2: the new password is refused (minimum 8 characters). Nothing changes.
- Step 3: a success toast is shown.
- Step 4: the old password no longer works. The new one does.

---

## 4. Payment links and the locked quote

### Scenario 6 — Create a payment link

**Preconditions:** signed in as the merchant. `amountTRY` for this scenario is `5000.00`.

**Steps**
1. Open Links → **Create link**.
2. Enter the title `AT-6 Lemon order`, an optional description, the amount `5000.00`, and leave the
   expiry at its default (24 hours). Submit. Creating a link can take a few seconds while the
   on-chain invoice is created: a spinner is shown.
3. In the confirmation dialog note the URL, the QR code and the **Share on WhatsApp** action. Copy the
   URL.
4. Open the link's detail page.

**Expected result**
- The link is created with status **open**. The confirmation shows the pay URL with a copy button, a QR
  code and a WhatsApp share action.
- The link has an 8-character code made of uppercase letters and digits. The URL ends with that code.
- The detail page shows: amount `5.000,00 ₺`, the quoted USDC (2 decimals, full 7 decimals in a tooltip),
  received `0.00 USDC`, the locked exchange rate with the time it was fetched, and the expiry about
  24 hours from now.
- "Payments" says no payments yet, and "Settlement" says there is nothing to settle.
- The link appears in the Links list with status open.

Note the exact USDC due from `<API_URL>/pay/<CODE>` (section 2.4). Call it `<DUE>` from now on.

### Scenario 7 — Amount validation on link creation

**Preconditions:** signed in as the merchant.

**Steps**
1. Try to create links with the amounts `0.99`, `0`, `-5.00`, `abc`, `10.005` and `1000000.01`.
2. Create a link with the amount `1.00` and title `AT-7 minimum`.
3. Create a link with the amount `1000000.00` and title `AT-7 maximum`.

**Expected result**
- Step 1: every one of these is refused with a message. The valid range is 1.00 to 1,000,000.00, with at
  most 2 decimals.
- Steps 2 and 3: both links are created (open).
- If the API response is inspected, TRY amounts have exactly 2 decimals.

### Scenario 8 — The quote is locked and never re-quoted

**Preconditions:** the link from scenario 6, still open. Note down its exact `<DUE>`, its exchange rate
and the "rate fetched" time from the detail page.

**Steps**
1. Open `<PAY_URL>/p/<CODE>` on the phone (or in a second browser). Note the TRY amount, the USDC amount,
   the rate and the countdown.
2. Wait at least 2 minutes. Reload the payer page three times. Reload the merchant's link detail page.
3. Open `<API_URL>/fx` and note the current rate and its `fetchedAt`.
4. Create a second link (`AT-8 second`, `5000.00`). Compare its rate and USDC amount with the first one.
5. Open the first link again on both apps.

**Expected result**
- The first link shows the **same** TRY amount, USDC amount (all 7 decimals), rate and rate timestamp
  every time, however long you wait and however often you reload. The payer page never shows a new
  price for an existing link.
- The quote expires at the same moment as the link: the countdown on the payer page and the expiry on the
  merchant page agree.
- The second link may have a different rate if the rate source moved. That does not change the first
  link. (If the rate source is a fixed mock rate, both links are identical.)
- The USDC amount equals the TRY amount divided by the rate, rounded **up** at the 7th decimal, so a
  payer can never underpay by rounding.

### Scenario 9 — The payer page for an open link

**Preconditions:** the link from scenario 6.

**Steps**
1. On the phone open `<PAY_URL>/p/<CODE>`. Then open the same URL with the code in lowercase.
2. Read the page without connecting a wallet.
3. Open `<PAY_URL>/p/DOESNOTEXIST`.
4. Open `<PAY_URL>/` (no code).

**Expected result**
- Step 1: both spellings show the same link (codes are case-insensitive).
- Step 2: the page shows the merchant's business name, the title, `5.000,00 ₺` (or `5,000.00 TRY`), about
  `147 USDC` at a rate near 34 (the exact figure follows the link's rate), the rate, a quote countdown
  and a **Connect wallet** button. There is **no IBAN** anywhere on the page.
- Step 3: a clear "link not found" state, not a blank page.
- Step 4: a short explainer that a payment link is needed.

### Scenario 10 — Cancel a link

**Preconditions:** signed in. A new open link `AT-10 to cancel` (`100.00`) that nobody has paid.

**Steps**
1. In the Links list use **Cancel** on the link and confirm.
2. Open the payer page for that link.
3. Try to cancel the same link again, if the button is still there.

**Expected result**
- Step 1: the link becomes **cancelled** and a toast confirms it. Only an open link can be cancelled.
- Step 2: the payer page shows a "cancelled" state and offers no way to pay.
- Step 3: the button is gone, or the second attempt is refused. The link stays cancelled.

### Scenario 11 — Retry the on-chain invoice (optional)

**Preconditions:** the Soroban invoice contract is configured. A link whose detail page says "No
on-chain invoice yet". This happens when the invoice call failed at creation. If every link already has
an invoice, skip this scenario.

**Steps**
1. On the link detail page use **Retry on-chain**.
2. Reload the page.
3. On a link that already has an invoice, or a link that already received a payment, look for the button.

**Expected result**
- Step 1: the "On-chain invoice" card shows a contract id, an invoice code equal to the link code and a
  deadline ledger. The price does not change: the existing quote is reused.
- Step 2: the invoice is still there.
- Step 3: the button is not offered (only an open link with nothing received can get an invoice).

---

## 5. Paying a link

Use the **Payer** wallet from section 2.3. For scenarios 12–18 the merchant should be signed in on the
desktop in another tab, on the link's detail page, so you can watch the link change.

### Scenario 12 — Pay exactly, memo rail

**Preconditions:** the link from scenario 6 (`AT-6 Lemon order`, 5,000.00 TRY), open. The Payer wallet has
enough USDC. Auto-save is `0` (scenario 4).

**Steps**
1. On the phone open `<PAY_URL>/p/<CODE>` and tap **Connect wallet**. Choose your wallet.
2. Read the "Ready" state: the short wallet address and the wallet's USDC balance.
3. Tap **Pay <amount> USDC** and approve the transaction in the wallet.
4. Watch the page while it confirms ("Confirming on Stellar…").
5. Meanwhile watch the link detail page in the merchant app.
6. On the payer page open the explorer link. On the explorer, open the transaction.

**Expected result**
- Step 2: the address is shown shortened (`GABC…XYZ`). If the wallet has no USDC trustline or no USDC, a
  warning links to `faucet.circle.com` instead of a pay button.
- Step 3: the transaction is one USDC payment to `<PLATFORM>` with a **text memo equal to the link
  code**, for exactly `<DUE>`.
- Step 4: the page goes to the paid state within about 10 seconds of the transaction being confirmed:
  a check mark, "Paid to Acceptance Test Trading", the amount, the transaction hash with a copy button,
  a **View on Stellar.Expert** link and a **Share receipt** action. The receipt also shows the rate, when
  it was fetched and the spread.
- Step 5: without reloading, the link flips **open → paid**, a "Payment received · 5.000,00 ₺" toast
  appears, received equals the quoted USDC, and the payment is listed with rail **Classic (memo)**, the
  transaction hash, the payer address and the ledger.
- Step 6: the explorer shows the payment to `<PLATFORM>`, asset USDC with the issuer from section 2.2, the
  right amount and the memo.
- The same transaction hash is shown on the payer page, the merchant page and the explorer.

### Scenario 13 — A paid link cannot be paid again from the page

**Preconditions:** the link from scenario 12, now paid.

**Steps**
1. Open the payer page for that link again, in a fresh tab.

**Expected result**
- The page shows the **paid receipt** (amount, transaction hash, explorer link), not a payment form.

### Scenario 14 — Pay exactly through the contract (optional)

**Preconditions:** the Soroban invoice contract is configured and a new open link `AT-14 contract`
(`200.00`) exists that has an on-chain invoice (its detail page shows the contract card). If no contract
is deployed, skip this scenario.

**Steps**
1. Open the payer page. After connecting the wallet you see two buttons: the normal pay button and
   **Pay via contract**.
2. Tap **Pay via contract** and approve in the wallet.
3. Watch the payer page and the merchant's link detail page.

**Expected result**
- The wallet asks for a contract invocation. There is no amount to type, and the amount moved is exactly
  the invoice amount.
- The link becomes **paid** and the payment is listed with rail **On-chain (contract)**.
- The link's status and the settlement behave exactly as in scenario 12.

### Scenario 15 — Pay with XLM through a path payment (optional, advanced)

**Preconditions:** a new open link `AT-15 path` (`150.00`). Payer wallet with XLM. Stellar Lab.

**Steps**
1. In Stellar Lab build a **Path Payment Strict Receive**: source = Payer, destination = `<PLATFORM>`, send
   asset = XLM, destination asset = USDC with the issuer from section 2.2, destination amount = the
   exact `<DUE>` for this link, a generous send maximum, **Memo = Text with the link code**.
2. Sign and submit.

**Expected result**
- The link becomes **paid**. The payment is listed with the full USDC amount received.
- The wallet paid in XLM, but the platform received USDC. Path payments are credited like normal payments.

### Scenario 16 — Underpay, then complete the link

**Preconditions:** a new open link `AT-16 underpay` (`1000.00`). Note `<DUE>` from the API. The Payer
wallet has enough USDC. Watch the merchant's detail page and the payer page.

**Steps**
1. From the wallet's plain **Send** screen send **60 % of `<DUE>`** (rounded down to 7 decimals) in USDC to
   `<PLATFORM>` with the text memo = the link code.
2. Wait about 10 seconds. Reload the payer page.
3. Open `<API_URL>/pay/<CODE>/status`.
4. On the payer page pay the remainder (use the page's pay button; it offers the shortfall).
5. Watch the merchant page.

**Expected result**
- Step 2: the link status becomes **underpaid**, not paid. The link stays open for another payment. The
  payer page shows the amount still missing (the shortfall) and lets you pay it. The merchant page shows
  "Shortfall" with the missing USDC instead of "Received".
- Step 3: `status` is `underpaid`, `receivedUSDC` is the amount you sent, `shortfallUSDC` is
  `<DUE>` minus `receivedUSDC` (7 decimals).
- Step 4: the payer is asked for the shortfall (the remainder), not the full price again.
- Step 5: after the second payment the link becomes **paid**. It lists **two payments**, both with
  their own hash. `receivedUSDC` equals `<DUE>`. A single settlement is created (see scenario 27), for the
  link's TRY amount `1.000,00 ₺`, not a sum of two conversions.

### Scenario 17 — Underpay, then top up with more than is missing

**Preconditions:** a new open link `AT-17 overtopup` (`1000.00`). Note `<DUE>`.

**Steps**
1. Send **50 % of `<DUE>`** by hand to `<PLATFORM>` with the memo. Wait until the link is underpaid.
2. Send **70 % of `<DUE>`** by hand with the same memo (that is 20 % more than what is missing).
3. Open the merchant's Dashboard and the **Unallocated USDC** panel.

**Expected result**
- After step 1 the link is underpaid. After step 2 the link is **paid**.
- The excess (20 % of `<DUE>`) is credited to the merchant's **Unallocated USDC**. The panel lists one
  credit with source **overpaid** and the transaction hash of the second payment.
- The link's TRY amount is unchanged: it is never recalculated from what was received.

### Scenario 18 — Overpay in a single payment

**Preconditions:** a new open link `AT-18 overpay` (`1000.00`). Note `<DUE>`. Note the merchant's current
Unallocated USDC (`U0`, zero if this is the first time).

**Steps**
1. Send `<DUE>` **plus 5.0000000 USDC** by hand to `<PLATFORM>` with the memo.
2. Watch the link, the Dashboard and the Unallocated panel.
3. Look at the link's settlement (scenario 27 has the details).

**Expected result**
- The link becomes **paid** (an overpayment still pays the link).
- Unallocated USDC rises by exactly **5.0000000 USDC** (to `U0` + 5). The panel lists a credit with
  source **overpaid**, and its transaction hash matches your payment.
- The excess is **not** converted to TRY automatically. The settlement's TRY amount is exactly the
  link's `1.000,00 ₺` (minus auto-save, if set), not more.

### Scenario 19 — Pay a link that has expired (optional)

**Preconditions:** a link whose expiry has passed. To get one, create a link with the shortest expiry the
form allows (for example 1 hour) and wait for it to lapse, or ask the operator to lapse one. (The design
docs do not fix the minimum or maximum expiry.) If neither is possible, skip this scenario. Note the
merchant's Unallocated USDC (`U0`).

**Steps**
1. Open the expired link on the payer page.
2. In the merchant app open the Links list and filter by status.
3. From the wallet's plain **Send** screen send **10 USDC** to `<PLATFORM>` with the text memo = the
   expired link's code.
4. Watch the Unallocated USDC panel.

**Expected result**
- Step 1: the page says "This link has expired — ask the merchant for a new one." It offers no way to pay
  and **never shows a new price**.
- Step 2: the link is listed as **expired**, not open.
- Steps 3 and 4: the link stays **expired** (it does not become paid). The 10 USDC is credited **in full**
  to the merchant's Unallocated USDC (`U0` + 10). The panel lists a credit with source **stray** and a
  reason that says the link was not payable, with your transaction hash. The payment is never
  dropped silently.

### Scenario 20 — Pay a link that was cancelled

**Preconditions:** the cancelled link `AT-10 to cancel` from scenario 10. Note the merchant's Unallocated
USDC (`U0`).

**Steps**
1. Open the payer page of the cancelled link.
2. Send **10 USDC** by hand to `<PLATFORM>` with the memo = the cancelled link's code.
3. Watch the link and the Unallocated USDC panel.

**Expected result**
- Step 1: a "cancelled" state with no way to pay.
- Steps 2 and 3: the link stays **cancelled**. The 10 USDC is credited in full to Unallocated USDC as a
  **stray** credit (`U0` + 10), with your transaction hash.

---

## 6. Payments that must not credit a link

For scenarios 21–26 the platform must **never silently drop** a payment, and it must never credit a link
or merchant it should not. The design keeps a record of every rejected payment (a *payment attempt*),
but no screen or endpoint shows those records. What you can verify by hand is that the link and the
merchant's balances **do not change**, and what the explorer shows. Operators can check the attempt row
and its reason in the database.

Before each scenario note, for a fresh open link `AT-<n>` (`500.00`): its status (open), `receivedUSDC`
(`0.0000000`) and the merchant's Unallocated USDC (`U0`) and Available/Pending TRY.

### Scenario 21 — Wrong asset: XLM instead of USDC

**Preconditions:** a fresh open link `AT-21 wrong asset` (`500.00`).

**Steps**
1. Send **5 XLM** to `<PLATFORM>` with the text memo = the link code.
2. Wait 30 seconds. Check the link on both apps, the status endpoint and the balances.

**Expected result**
- The link is still **open** with `receivedUSDC` `0.0000000`. No payment is listed.
- The merchant's Unallocated USDC and TRY balances are unchanged. **No** merchant is credited for a
  wrong-asset payment.
- The XLM stays in the platform account and is resolved by hand. *(Operator check: a payment attempt
  with the reason `wrong_asset` exists.)*

### Scenario 22 — Wrong asset: another token is refused by the network

**Preconditions:** the same link as scenario 21, and a wallet holding some other testnet asset (not XLM, not
Circle's USDC). If you have none, skip this scenario.

**Steps**
1. Try to send a small amount of that other asset to `<PLATFORM>` with the link code as text memo.
2. Check the link and the balances.

**Expected result**
- The platform account only trusts Circle's USDC (and holds XLM), so the network itself refuses a payment
  in any other asset: the wallet or Stellar Lab reports a failed transaction (`op_no_trust`) and nothing
  reaches the platform account.
- The link stays open and no balance changes. The only wrong asset that can arrive is XLM, which is
  scenario 21.

### Scenario 23 — No memo, or a memo that is not a link code

**Preconditions:** the link from scenario 21, still open. Payer wallet with USDC.

**Steps**
1. Send **1 USDC** to `<PLATFORM>` **without any memo**.
2. Send **1 USDC** to `<PLATFORM>` with the text memo `NOSUCHCODE`.
3. Check the link and the merchant's balances.

**Expected result**
- The link is still **open**, with `receivedUSDC` `0.0000000`. No merchant's balance changed.
- Both payments sit in the platform account and are resolved by hand. *(Operator check: attempts with the
  reasons `unmatched_memo` (step 1) and `link_not_found` (step 2) exist.)*
- A memo of a different type (for example a numeric ID memo) does not match either.

### Scenario 24 — Spoofed USDC: a token called "USDC" from another issuer

Anyone can issue a token whose code is `USDC`. LiraLink accepts a payment only when the asset code **and**
the issuer both match Circle's USDC. The code alone proves nothing.

**Preconditions:** the link from scenario 21, still open. The Fake issuer and Fake holder accounts from
section 2.3, with Fake holder holding some of the fake `USDC`.

**Steps**
1. From Fake holder send **10 `USDC`** (issuer = **Fake issuer**, not the Circle issuer) to `<PLATFORM>` with
   the text memo = the link code.
2. Look at the result of the transaction in the wallet or in Stellar Lab, and on the explorer if it was
   submitted.
3. Check the link and the balances on both apps.

**Expected result**
- The platform account has no trustline for the fake token, so the network refuses the payment
  (`op_no_trust`). Nothing arrives, and the fake token is never treated as USDC.
- The link stays **open** with `receivedUSDC` `0.0000000`, there is no payment in the merchant's list, and
  no balance changes.
- *(Operator check, on a test deployment only: to exercise the matcher itself, give the platform account a
  trustline for the fake issuer and repeat step 1. The payment then arrives on the ledger, the link must
  still stay open, and a `wrong_asset` attempt with `assetCode` `USDC` and the other issuer must be
  recorded. Remove that trustline afterwards.)*

### Scenario 25 — The wrong network is blocked

**Preconditions:** the payer page on the phone and a wallet that can switch to mainnet (Freighter).

**Steps**
1. Switch the wallet to **Mainnet (Public)** and open the payer page for an open link. Connect the wallet.

**Expected result**
- The page blocks the payment with a clear message that the wallet is on the wrong network. No
  transaction can be built. Switching the wallet back to testnet restores the normal flow.

### Scenario 26 — Payer problems that must be explained

**Preconditions:** an open link. Three wallets, or a wallet you can reset: one that is not funded with
XLM, one with XLM but **no USDC trustline**, and the Payer wallet.

**Steps**
1. Connect the unfunded wallet on the payer page.
2. Connect the wallet without a USDC trustline.
3. Connect the Payer wallet, tap pay, and **reject** the transaction in the wallet.
4. Connect a wallet whose USDC balance is lower than the amount due.

**Expected result**
- Step 1: a message says the account is not funded on testnet yet (with a Friendbot hint).
- Step 2: a message says there is no USDC trustline, with a link to `faucet.circle.com`. The page does
  **not** add a trustline for the user.
- Step 3: the page says the signature was rejected and lets you try again. No blank screen, and the link
  is unchanged.
- Step 4: a message says how much USDC is needed and how much the wallet has.
- The page never leaves the user on a blank or endlessly spinning screen.

---

## 7. Settlement

When a link becomes paid the API creates one **settlement** for it, and an anchor converts the USDC to
TRY. The settlement's gross TRY amount is always the **link's** `amountTRY` (less the auto-save share),
never the received USDC times a rate.

### Scenario 27 — Settlement of a paid link `[Mode A]`

**Preconditions:** balance mode (section 2.1). The paid link from scenario 12 (`5000.00`, auto-save `0`).
Note the balance card before paying a new link if you repeat this with a new one.

**Steps**
1. On the link's detail page watch the **Settlement** card right after the payment.
2. Open the Payments page and find the payment.
3. Open the Dashboard.

**Expected result**
- Step 1: the settlement steps go **Queued → Converting → Credited** (pending → processing → completed).
  When it is complete you see the credited TRY, the anchor fee and the completion time.
- The settlement's TRY amount is exactly **5.000,00 ₺** (the link's amount).
- Credited TRY (`netTRY`) equals the TRY amount times (USDC sent minus fee) divided by USDC sent, rounded
  down to the kuruş. When the anchor fee is `0.0000000` USDC, the credited TRY equals 5.000,00 ₺.
- Step 2: the payment row shows the date, link, USDC received, the rate, the TRY credited, the settlement
  status and the explorer link.
- Step 3: while the settlement is pending or processing, the amount shows as **Pending TRY**. Once it is
  completed the amount moves to **Available TRY**. The balance card refreshes about every 5 seconds.

### Scenario 28 — Settlement and payout to the IBAN `[Mode B]`

**Preconditions:** auto-payout mode (section 2.1). The merchant's IBAN is **saved** (scenario 4). A new open
link `AT-28 payout` for **`5000.00`**. The Payer wallet has enough USDC. (The anchor has a minimum
withdrawal of about 1 USDC, so the link must be big enough. Scenario 30 covers a small one.)

**Steps**
1. Pay the link exactly, as in scenario 12.
2. Watch the Settlement card on the link detail page.
3. Open the Dashboard, the Payments page and the Payouts page.

**Expected result**
- Step 2: the settlement goes Queued → Converting → Credited. It may stay in "Converting" for up to a
  couple of minutes while the anchor pays out. With the anchor used in the hackathon this needs no
  human step. If the settlement shows **Verification needed** with a button, the anchor is an
  interactive one: follow the button, complete the anchor's form, and the settlement then continues.
- On completion the credited TRY is the amount the anchor reports it **actually paid** to the IBAN,
  already net of the anchor's own fee (with the hackathon anchor the fee is about 0.25 TRY), and the
  USDC fee shows `0.00 USDC`.
- Step 3: the Dashboard shows **Paid out TRY** (not "Available TRY"), and it grows by that amount. The
  Payouts page says the anchor pays each completed settlement to the IBAN and that there is nothing to
  withdraw. Nothing is added to **Available TRY**, because the anchor has already paid the bank.
- Once the settlement is complete the IBAN is never shown in full on the Payments page or in the payout
  history (see scenario 38).

### Scenario 29 — A payout waits for the IBAN `[Mode B]`

**Preconditions:** auto-payout mode. A merchant with **no IBAN saved**. Register a second merchant
(`Acceptance Test Trading 2`) and skip the IBAN. One open link `AT-29 no iban` (`5000.00`).

**Steps**
1. Pay the link exactly.
2. Wait a few minutes. Look at the settlement.
3. Save an IBAN in Settings. Wait a few minutes.

**Expected result**
- Step 2: the link is **paid**, but the settlement stays **pending** (Queued). It is **not** failed and it
  does not disappear. The merchant's Pending TRY includes the gross amount.
- Step 3: after the IBAN is saved, the settlement resumes on its own, goes on to completed, and Paid out
  TRY is credited.

### Scenario 30 — A payment below the anchor's minimum `[Mode B]`

**Preconditions:** auto-payout mode with the hackathon anchor and an IBAN saved. A new open link `AT-30 small`
for an amount that comes to **less than 1 USDC** at the link's rate (for example `10.00` TRY at a rate above
10). Read `<DUE>` to check it is below 1.

**Steps**
1. Pay the link exactly.
2. Wait a few minutes. Look at the link and the settlement.

**Expected result**
- The link is **paid** (the payer's payment is valid). The settlement stays **pending**, not failed.
  Money is not lost or marked as failed because of a limit. It stays waiting until the anchor's limits
  allow it. *(Operator check: the settlement carries the block reason `outside_anchor_limits`; it is
  never exposed by the API.)*

### Scenario 31 — Auto-save keeps a share in USDC

**Preconditions:** the merchant from scenario 1. A new open link `AT-31 autosave` (`1000.00`). Note `<DUE>`.

**Steps**
1. In Settings set **Auto-save** to `20` and save.
2. Pay the link exactly.
3. Open the link's Settlement card and the Dashboard.

**Expected result**
- The settlement converts only **80 %** of the link: the gross TRY amount is `800,00 ₺` (`1000.00` × 80 %).
- **20 % of the quoted USDC** (`<DUE>` × 20 %) is kept as **Saved USDC** on the balance card, which now
  shows a Saved USDC amount.
- The 20 % is not converted to TRY. The USDC sent to the anchor is the remaining 80 %.
- Set Auto-save back to `0` after this scenario if you want the following scenarios to match their numbers.

---

## 8. Withdrawals

### Scenario 32 — Withdraw TRY to an IBAN `[Mode A]`

**Preconditions:** balance mode. **Available TRY** is above zero (scenario 27 completed). The IBAN is saved.
Note the available balance `A0`.

**Steps**
1. Open Withdrawals. Note that the IBAN is prefilled from the profile.
2. Request a withdrawal of `100.00` to that IBAN.
3. Look at the history and at the balance.

**Expected result**
- The withdrawal appears in the history with status **Requested**, later moving on to processing and
  completed. The amount is **reserved immediately**: Available TRY drops by 100.00 at once (to `A0` − 100.00).
- The IBAN shown in the history is **masked** in the form `TR33 **** **** **** **** **** 26` (first 4 and
  last 2 characters visible). The full IBAN is not shown there.
- A success toast is shown.

### Scenario 33 — Withdrawals that must be refused `[Mode A]`

**Preconditions:** balance mode. Available TRY `A`.

**Steps**
1. Try to withdraw an amount **higher than Available TRY** (for example `A + 1.00`).
2. Try to withdraw `0` and `-5`.
3. Try an IBAN with the wrong format (`TR12`).
4. Use a merchant **without an IBAN** in the profile (scenario 29's second merchant) and leave the IBAN
   field empty.

**Expected result**
- Step 1: refused with a message that it exceeds the available balance. The balance is unchanged.
- Step 2: refused (the amount must be positive).
- Step 3: refused (`TR` followed by 24 digits).
- Step 4: refused because there is no IBAN in the request or in the profile.
- In every case no withdrawal is created and no balance changes.

### Scenario 34 — No TRY withdrawals in auto-payout mode `[Mode B]`

**Preconditions:** auto-payout mode.

**Steps**
1. Open the Withdrawals page (labelled **Payouts** in this mode).

**Expected result**
- There is no **Withdraw** button. The page says payouts are automatic and shows the total paid out. If the
  API is asked to create a TRY withdrawal anyway, it answers that payouts are automatic in this mode
  (`409`).

### Scenario 35 — Withdraw USDC to your own wallet

**Preconditions:** the merchant has **Saved USDC** (scenario 31) or **Unallocated USDC** (scenarios 17–20)
above zero. The Merchant wallet exists, is funded and has the USDC trustline. Note the balances
(`S0` saved, `U0` unallocated) and the Merchant wallet's USDC balance on the explorer (`W0`).

**Steps**
1. Open Withdrawals → **USDC to your wallet** → **Withdraw USDC**.
2. Choose the source (**Saved** or **Unallocated**), enter `2.0000000` USDC and the Merchant wallet's `G…`
   address. Submit.
3. Watch the history for about 30 seconds.
4. Open the transaction from the history on the explorer, and check the Merchant wallet's balance.
5. Repeat with the other source.

**Expected result**
- The request is accepted with status **Submitted**, and the transaction hash is present **from the first
  response**. Usually within about 5 seconds it becomes **Completed**. (If the network is slow it stays
  Submitted and is retried until it lands. It is never sent twice.)
- The chosen balance drops by exactly `2.0000000` at once (`S0` − 2 or `U0` − 2).
- The explorer shows a USDC payment from `<PLATFORM>` to the Merchant wallet for exactly 2 USDC, and the
  Merchant wallet's balance rises by 2 (`W0` + 2).
- The Unallocated panel's summary shows the withdrawn amount and the remaining amount, and the remaining
  amount equals the Unallocated USDC on the balance card.

### Scenario 36 — USDC withdrawals that must be refused

**Preconditions:** as in scenario 35.

**Steps**
1. Ask for more USDC than the chosen source holds.
2. Enter an address that is not a Stellar `G…` address (`hello`).
3. Enter a `G…` address for an account that **does not exist** on testnet (a freshly generated one that is
   not funded).
4. Enter a funded account that has **no USDC trustline**.
5. Enter `<PLATFORM>` as the destination.
6. Enter `0` as the amount.

**Expected result**
- Step 1: refused with an "insufficient balance" message. No balance changes.
- Steps 2 and 6: refused as invalid input.
- Steps 3, 4 and 5: refused, because the destination must exist, must trust USDC and must not be the
  platform account.
- In every case the balances do not change and no USDC leaves the platform account.

### Scenario 37 — Withdrawn amounts are not double-counted

**Preconditions:** scenario 35 done. Record the merchant's balances.

**Steps**
1. Reload the Dashboard and the Unallocated panel.
2. Compare Saved USDC and Unallocated USDC with the numbers before scenario 35 minus what you withdrew.

**Expected result**
- Saved USDC and Unallocated USDC show exactly the earlier value minus the withdrawn amounts, and the same
  value in every place they are shown. A completed USDC withdrawal is never added back and never subtracted
  twice.

---

## 9. Privacy

### Scenario 38 — IBAN visibility

**Preconditions:** the merchant with the saved IBAN, at least one paid link, and (in balance mode) one TRY
withdrawal.

**Steps**
1. In Settings look at the IBAN.
2. On the Withdrawals page look at the IBAN in the history.
3. On the payer page and in the JSON of `<API_URL>/pay/<CODE>`, search for any part of the IBAN.
4. Open the Payments and Links pages and search them for the IBAN.

**Expected result**
- Only the merchant's own profile (Settings) shows the full IBAN.
- Every other place shows it masked as `TR33 **** **** **** **** **** 26`, or not at all.
- **Nothing the payer can see contains the IBAN**, neither on the page nor in the public API response.

---

## 10. Not covered

These parts of the design need more than a browser and a wallet:

- **The x402 agent route** (`GET /pay/:code/agent`) needs the command-line agent client. It is an
  experimental, testnet-only stretch feature.
- **Backend restarts and Horizon reconnects.** They need access to the server: verify that a restart
  neither replays nor skips a payment (the listener resumes from its saved cursor).
- **Rejected payment attempts.** No screen shows them. Scenarios 21–24 verify the visible effect only.
- **Failed settlements** (`unexpected_fee_asset`, `invalid_fee`, `anchor_status`, `amount_mismatch`) and
  **failed USDC withdrawals** (`failed_on_ledger`, `expired_unsubmitted`) need a misbehaving anchor or
  network. A failed USDC withdrawal returns the amount to its source.
- **Interactive anchor (sep24) KYC** happens on the anchor's own page and is outside this app.

## 11. Results sheet

Copy this table and fill in the result for the run you did: date, tester, environment (API URL, mode) and
the commit that was deployed.

| # | Scenario | Mode | Result (Pass / Fail / Skipped) | Notes |
|---|---|---|---|---|
| 1 | Register a merchant | Both | | |
| 2 | Registration is validated | Both | | |
| 3 | Sign in, sign out and protected pages | Both | | |
| 4 | Settings: business name, IBAN and auto-save | Both | | |
| 5 | Change the password | Both | | |
| 6 | Create a payment link | Both | | |
| 7 | Amount validation on link creation | Both | | |
| 8 | The quote is locked and never re-quoted | Both | | |
| 9 | The payer page for an open link | Both | | |
| 10 | Cancel a link | Both | | |
| 11 | Retry the on-chain invoice (optional) | Both | | |
| 12 | Pay exactly, memo rail | Both | | |
| 13 | A paid link cannot be paid again from the page | Both | | |
| 14 | Pay exactly through the contract (optional) | Both | | |
| 15 | Pay with XLM through a path payment (optional) | Both | | |
| 16 | Underpay, then complete the link | Both | | |
| 17 | Underpay, then top up with more than is missing | Both | | |
| 18 | Overpay in a single payment | Both | | |
| 19 | Pay a link that has expired (optional) | Both | | |
| 20 | Pay a link that was cancelled | Both | | |
| 21 | Wrong asset: XLM instead of USDC | Both | | |
| 22 | Wrong asset: another token | Both | | |
| 23 | No memo, or a memo that is not a link code | Both | | |
| 24 | Spoofed USDC from another issuer | Both | | |
| 25 | The wrong network is blocked | Both | | |
| 26 | Payer problems that must be explained | Both | | |
| 27 | Settlement of a paid link | A | | |
| 28 | Settlement and payout to the IBAN | B | | |
| 29 | A payout waits for the IBAN | B | | |
| 30 | A payment below the anchor's minimum | B | | |
| 31 | Auto-save keeps a share in USDC | Both | | |
| 32 | Withdraw TRY to an IBAN | A | | |
| 33 | Withdrawals that must be refused | A | | |
| 34 | No TRY withdrawals in auto-payout mode | B | | |
| 35 | Withdraw USDC to your own wallet | Both | | |
| 36 | USDC withdrawals that must be refused | Both | | |
| 37 | Withdrawn amounts are not double-counted | Both | | |
| 38 | IBAN visibility | Both | | |
