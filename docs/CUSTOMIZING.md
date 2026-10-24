# Customizing the app

Rule of thumb: **change settings in the app first, change code only when the app cannot do it.**
The code is small and split by job, so each change touches one or two files.

## Without touching code (Settings screen)

| I want to change | Where |
|---|---|
| Tax rates, tax added vs included | Settings > Tax and discounts |
| Quick discount buttons | Settings > Tax and discounts |
| Payment methods | Settings > Lists |
| Expense categories | Settings > Lists |
| Receipt header, footer, number prefix | Settings > Receipt |
| Products, menu items, services, prices | Items tab |
| Business name | Settings > Business |

## With a small code change

| I want to change | File | What to do |
|---|---|---|
| Add a **new type of business** (pharmacy, salon, hardware...) | `web/src/presets.js` | Copy one entry in `PRESETS`, change the label, wording, payment methods, expense categories, discounts and sample items. It appears in the setup wizard automatically. |
| Colours | `web/styles.css` | Edit the variables at the top (`--brand`, `--bg`...). Dark mode has its own set just below. |
| App name | `web/src/config.js`, `web/index.html` (the `<title>`) and `web/manifest.webmanifest` | Change `appName` in the config and the two names in the manifest. |
| Logo and home-screen icon | `web/icons/` | Replace the three PNG files, keeping sizes 192, 512 and a 512 "maskable" with extra margin. |
| Turn off automatic sync | `web/src/config.js` | Set `autoSync: false`. People then sync with the badge button. |
| Receipt layout (width, lines) | `web/src/receipt.js` | One function builds the text for the screen, print and share. |
| How discounts and tax are worked out | `web/src/pricing.js` | Rules are written at the top of the file. **Run `node --test` after any change** and update `tests/pricing.test.js` if the rule really changed. |
| Profit and tax definitions | `web/src/reports.js` | Definitions are at the top of the file. |
| Add a report or a column | `web/src/ui/reports.js` | `summarize()` in `reports.js` computes numbers; the screen only displays them. |
| Sheet columns | `backend/Code.gs` | Change the `*_HEAD` lists and the row-building code in `push_`, then deploy a **new version** of the script. |

## Example: add a new business preset

In `web/src/presets.js`, add inside `PRESETS`:

```js
pharmacy: {
  label: 'Pharmacy / health shop',
  labels: { item: 'Product', items: 'Products', sale: 'Sale' },
  paymentMethods: ['Cash', 'Card', 'E-wallet'],
  discountPresets: [{ label: 'Senior 20%', type: 'percent', value: 20 }],
  expenseCategories: ['Stock purchase', 'Rent', 'Utilities', 'Salaries & wages', 'Licences', 'Other'],
  samples: [{ name: 'Sample product', price: 4.5, category: 'General' }],
},
```

Run `node --test` (a test checks every preset), push, and it is live.

## Example: add a field to expenses (say "invoice number")

1. `web/src/services.js`: in `addExpense`, add `invoiceNo: String(e.invoiceNo || '').slice(0, 60)`.
2. `web/src/ui/expenses.js`: add an input, include it in the `addExpense(...)` call, show it in the list row.
3. `backend/Code.gs`: add `'invoice no'` to `EXPENSES_HEAD` **at the end**, and the value at the end of the row built in `push_`. Add the column header by hand to existing sheets, then deploy a new script version.
4. Add a line to `tests/services.test.js`, run `node --test`.

Old records without the field keep working, because everything reads fields defensively.

## Changing a rule safely

1. Make the change.
2. `node --test` (about a second). Fix or update tests until green.
3. Optional full check: `tests-browser/smoke.cjs` drives the real app in a browser (setup in its header comment).
4. Push to `main`. The publish workflow runs the tests again and only publishes if they pass.

## Changing stored data (advanced)

Data lives in each phone's browser database. If a change needs new stored fields:
- Old records must keep working (read with defaults, as `app.js` does for settings).
- If the change is not backwards compatible, raise `SCHEMA_VERSION` in `presets.js` and write a small conversion in `importBackup` so old backup files can still be restored.
- Never rename existing fields without a conversion.

## Money rules (do not break these)

- Amounts are **whole numbers of the smallest unit** (cents). Never use decimals for money; use `parseMoney`, `formatMoney`, `divRound` in `money.js`.
- Text from users is only ever shown with `h()` or text nodes, never as HTML.
- Past sales keep their own copy of prices, tax mode and currency, so changing settings never rewrites history.
