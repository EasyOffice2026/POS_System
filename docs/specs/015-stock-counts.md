# Spec 015: Stock counts

**Status:** Built, API and web. This is the fourth epic of Phase 3. It checks the stock of [spec 012](012-ingredients-and-stock.md) against what is really on the shelves, and corrects it with the movement kind that spec reserved (`count`).

## Goal

Once a week, or every night for the expensive things, a branch counts what it has. The manager starts a count, staff type what they find, and when it is finished the system shows what was lost or found, in quantity and in KWD, and sets the stock to what was counted. The losses of a branch become visible instead of hiding in the stock.

## Who can do what

| Action                                       | Who                                                          |
| -------------------------------------------- | ------------------------------------------------------------ |
| Start, fill in, finish or cancel a count     | `inventory:write` at the branch (its manager, its purchaser) |
| See the counts of a branch and their results | `inventory:read` at the branch                               |

A brand manager and the group admin can do all of it at every branch of the brand. No new permission; a cashier and the kitchen do not count.

## What is stored

- **Count** (`stock_counts`): a number, the brand and the branch; the status (`open`, `finished`, `cancelled`); a note; who started it and when; who finished it and when; who cancelled it, when and why.
- **Count line** (`stock_count_lines`): the ingredient; the quantity the system expected; the quantity counted (empty until typed); and, once finished, the cost of a unit at that moment, so the value of the difference stays what it was.
- **Stock movements** (spec 012): one `count` movement per ingredient whose counted quantity differs from the stock, referring to the count.

## Rules

1. **One open count per branch.** Starting a second answers `COUNT_ALREADY_OPEN`. The branch must be active.
2. **What is counted.** A count covers the ingredients chosen when it starts, or every active ingredient of the brand when none are chosen (a full count). At most 500 lines. An ingredient is on a count once.
3. **Typing the counts.** While the count is open, the counted quantity of any line can be typed, changed or cleared, as often as needed and by several people; each save sends the lines it changes. Quantities are 0 or more with 3 decimals. A count that is not open answers `COUNT_NOT_OPEN`.
4. **Finishing** needs at least one counted line (`COUNT_EMPTY`). For each counted line, the difference is the counted quantity minus the stock **at the moment of finishing**, so what was sold during the count is not taken as a loss; the expected quantity on the line is updated to that stock. The stock is set to what was counted with a `count` movement (note `Count N`), in one transaction. Lines left empty change nothing and are shown as not counted.
5. **The value of the difference** is the difference times the ingredient's cost at finishing. The count shows the total lost (negative) and found (positive).
6. **Cancelling** an open count needs a reason and changes no stock.
7. **The audit log** records `inventory.count.started`, `inventory.count.finished` (with the value of the difference) and `inventory.count.cancelled`.

## API

| Method and path                         | What it does                                                                           | Needs             |
| --------------------------------------- | -------------------------------------------------------------------------------------- | ----------------- |
| `GET /inventory/counts?branchId&status` | The counts of a branch, open first, then newest first, with their totals (cursor page) | `inventory:read`  |
| `GET /inventory/counts/:id`             | One count with its lines                                                               | `inventory:read`  |
| `POST /inventory/counts`                | `{ branchId, ingredientIds?, note? }`. Starts a count                                  | `inventory:write` |
| `PUT /inventory/counts/:id/lines`       | `{ lines: [{ ingredientId, counted }] }` (`counted` null clears it). Saves             | `inventory:write` |
| `POST /inventory/counts/:id/finish`     | Applies the counted quantities to the stock                                            | `inventory:write` |
| `POST /inventory/counts/:id/cancel`     | `{ reason }`                                                                           | `inventory:write` |

A count in every answer: `id, number, branchId, status, note, lineCount, countedCount, lostValue, foundValue, startedByName, startedAt, finishedByName, finishedAt, cancelledByName, cancelledAt, cancelReason`, and with `GET /:id` and the writes, `lines [{ ingredient, expected, counted, difference, value }]` (`difference` and `value` are null until the line is counted).

## Screens

- **Inventory**, a new **Counts** tab: the counts of the chosen branch with their status, how many lines are counted, and what was lost or found. **New count** asks for everything or a choice of ingredients, and a note.
- **A count** opens on its own page: a table of the ingredients with the expected quantity and a box for the counted one, the difference as it is typed (in red when lost), **Save**, **Finish** (after a confirmation that shows the totals) and **Cancel count**. A finished count shows the result, read only.

## Acceptance criteria

1. **Given** the Mall with 10 kg of flour and 4 kg of mozzarella, **when** a full count is started, **then** it has a line for every active ingredient, expecting 10 and 4.
2. **Given** that count, **when** 9.5 kg of flour and 4 kg of mozzarella are typed and the count is finished, **then** the flour is 9.500 with a `count` movement of −0.500 naming the count, the mozzarella has no movement, and the count shows a loss of 0.200 KWD (flour at 0.400 per kg).
3. **Given** an open count expecting 10 kg of flour, **when** 2 kg are sold during it and 7 kg are counted, **then** the movement is −1.000, not −3.000.
4. **Given** an open count at the Mall, **when** another is started there, **then** the answer is `COUNT_ALREADY_OPEN`; a count at Downtown can still be started.
5. **Given** an open count with nothing typed, **when** it is finished, **then** the answer is `COUNT_EMPTY`; **when** it is cancelled with a reason, **then** no stock changes, and saving to it afterwards answers `COUNT_NOT_OPEN`.
6. **Given** the Mall's purchaser, **then** they can count at the Mall but not at Downtown; a cashier cannot see counts.

## Not in this version

- Counting by storage place (fridge, dry store) or by several units (boxes and pieces).
- Blind counts that hide the expected quantity from the counter.
- Approval of a large difference by a manager before it is applied.

## Open questions

1. Should cashiers or kitchen staff be able to type counts, with only a manager finishing them?
2. Should the expected quantity be hidden from the person counting, so they count what is there and not what the screen says?
