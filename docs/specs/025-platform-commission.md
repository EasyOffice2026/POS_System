# Spec 025: Platform commission

**Status:** Built, API and web. Asked by the client on 20 October 2026. It adds a commission rate to each way to pay of [spec 009](009-settings.md), keeps it on each payment of [spec 007](007-payments.md) and refund of [spec 011](011-refunds.md), and shows it in the sales report of [spec 020](020-sales-reports.md).

## Goal

Talabat, Keeta and Jahez keep a share of every order they bring, and that share is renegotiated from time to time. Their orders are typed in at the till and paid with that platform as the way to pay (the platforms are not connected; a restaurant that needs it later can connect them through an integrator such as Grubtech). The owner wants to see, for any period, what each platform took and what is left.

## Who can do what

| Action                 | Who                                      |
| ---------------------- | ---------------------------------------- |
| Set a commission rate  | `settings:write`, on the Settings screen |
| See commission figures | `reports:read`, in the sales report      |

No new permission.

## Rules

1. **Each way to pay has a commission rate**, a percentage from 0 to 100 with up to two decimals, 0 when not set. Cash has none. KNET and Link usually stay at 0; a bank fee can be entered the same way.
2. **The rate is kept on the payment** when it is taken, with the commission it comes to: the paid amount times the rate, rounded to the fil. A rate changed later applies to new payments only, so a report of a past month keeps the rates of that month.
3. **A refund gives back commission** in proportion: a refund made through a way to pay is charged the rate kept on the order's payment with that way, so a refund of the whole platform part cancels its commission. A refund in cash, or of an order not paid that way, gives none back.
4. **The sales report** shows, for each way to pay, the payments, the amount, the refunds, the commission (charged less given back) and the net (amount less refunds less commission); the summary shows the commission of the period. The CSV of the report has the same columns.
5. Payments and refunds made before this spec have no commission.

## API

| Route                      | Change                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `PUT /brands/:id/settings` | Each payment method takes `commissionRate` ("0.00" to "100.00", optional, "0.00" when left out) |
| `GET /reports/sales`       | Each row of `payments` has `commission` and `net`; `summary` has `commissions`                  |

## Data

`payments.commission_rate` (numeric 5,2) and `payments.commission` (numeric 15,3), `refunds.commission` (numeric 15,3), all 0 by default and never below 0. Migration `20261020090000_platform_commission`.

## Acceptance criteria

1. Talabat at 18%: a 10.000 order paid by Talabat shows a commission of 1.800 and a net of 8.200 in the report.
2. The rate is changed to 20%; the next 10.000 Talabat order has 2.000; the report of both days shows 3.800, and the first day alone still 1.800.
3. Half of the first order is refunded through Talabat: its commission goes down by 0.900.
4. A cash payment never has commission.
