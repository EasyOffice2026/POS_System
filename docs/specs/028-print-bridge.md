# Spec 028: Printing without the browser (the print bridge)

**Status:** Built, API, web and bridge. Asked by the client on 31 October 2026: the till on the Sunmi handheld prints (its built-in printer is known to Android), the till on the iPad does not (an iPad prints only to AirPrint printers, and receipt printers are not). The client wants every till to print the same way. It changes how [spec 027](027-kitchen-screen-and-slip.md)'s slip and [spec 007](007-payments.md)'s receipt reach paper.

## Goal

A till is a web page, and a web page can only print through the browser's print dialog, to the printers the device knows. A tablet knows none. So printing moves off the device: the till draws the receipt or the slip as a picture and leaves it on the server; a small program in the shop, the **print bridge**, takes it and sends it to the printer over the network. Any device then prints, with no dialog, and the kitchen slip prints by itself.

## Who can do what

| Action                                     | Who                                   |
| ------------------------------------------ | ------------------------------------- |
| Leave a receipt, bill or slip for printing | `orders:write`, on the till           |
| See whether it printed                     | `orders:read`                         |
| Make the key of a branch's bridge          | `branches:write`, on the Printers tab |
| Take jobs and report on them               | The bridge, with its branch's key     |

No new permission.

## Rules

1. **The printers are the branch's printers** (Branches → Printers: a name, a kind, an address and a port). A till prints receipts and bills on the first printer of kind "Receipts" and kitchen slips on the first of kind "Kitchen tickets". A branch without a printer of the kind needed prints through the browser, as before (spec 027, rule 5).
2. **The till draws the page.** The receipt and the slip are built once, as lines (`print-document.ts`), and drawn on the screen, in the browser's print and on a canvas for the printer. The picture is a PNG, 576 dots wide (the paper of an 80 mm printer), black on white, so Arabic is shaped by the browser and prints the same on every printer. It goes to the API as a **print job**: branch, printer, kind (receipt, bill, kitchen), order number and picture.
3. **The bridge** runs on one computer in the branch's network, all day. It signs in with the branch's key, asks the API for the next job (the API holds the request up to `PRINT_BRIDGE_WAIT_SECONDS`, 8 by default, so the bridge need not ask every second), turns the picture into ESC/POS raster bands, sends them to the printer's address over TCP (port 9100 by default), feeds and cuts, and reports the job done. A printer it cannot reach is tried three times, three seconds apart, then the job is reported failed with the reason. A job a bridge took and never finished (the bridge was stopped) is offered again after 60 seconds, three times at most. Jobs of a printer that was removed are failed. Finished jobs are thrown away after a week.
4. **The key** is made on the Printers tab by whoever may change the branch; it is shown once, only its hash is kept, and making a new one stops the old one at once. The bridge keeps it in its `.env` as `PRINT_BRIDGE_KEY`. A key of a branch that was made inactive is refused.
5. **The cashier is told.** Under the receipt: "Sending to…", "Printing on…", "Printed on…", or "Not printed on …: <why>", with a button to print from this device instead. A job nobody took within 30 seconds is "not printed: the print bridge did not answer". A kitchen slip that did not print says so in the till's message bar, with the same button.
6. **Nothing is printed twice.** Two bridges of one branch cannot take the same job; a job reported done is not offered again.

## API

| Route                                 | Who     | What                                                                |
| ------------------------------------- | ------- | ------------------------------------------------------------------- |
| `POST /print-jobs`                    | till    | `{ branchId, printerId, kind, orderNumber?, image }` → the job, 201 |
| `GET /print-jobs/:id`                 | till    | The job: status `queued`, `printing`, `done` or `failed`, `error`   |
| `GET /branches/:id/print-bridge-key`  | manager | `{ createdAt }` (null without a key)                                |
| `POST /branches/:id/print-bridge-key` | manager | `{ key, createdAt }`, shown once, 201                               |
| `GET /print-bridge`                   | bridge  | Its branch and printers                                             |
| `POST /print-bridge/jobs/claim`       | bridge  | The next job with its picture and printer address, or 204           |
| `POST /print-bridge/jobs/:id/done`    | bridge  | 204                                                                 |
| `POST /print-bridge/jobs/:id/failed`  | bridge  | `{ error }` → 204                                                   |
| `GET /menu?branchId=`                 | till    | Also answers `printers: [{ id, name, kind }]`                       |

The bridge sends `Authorization: Bearer pb_…`. A picture is at most 400 KB; a request to `/print-jobs` may be 1 MB.

Migration `20261101090000_print_bridge`: tables `print_jobs` and `print_bridge_keys`.

## Acceptance criteria

1. A branch with a receipt printer and the bridge running: the cashier taps Print on a receipt; the receipt comes out of the printer, the till says "Printed on …", and no print dialog opens, on a PC, on the Sunmi and on the iPad alike.
2. The same branch with a kitchen printer and the kitchen slip on: sending an order prints the slip by itself.
3. The bridge stopped: within 30 seconds the till says the bridge did not answer and offers to print from this device; that prints through the browser.
4. The printer switched off: the till says it could not be reached, and the same button works.
5. A branch without printers: nothing changes, the browser prints.
6. A new key on the Printers tab: the bridge with the old key logs that it was refused; with the new one it prints again.
