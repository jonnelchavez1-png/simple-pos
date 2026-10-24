# Simple POS

A free, installable point-of-sale and money tracker for any kind of business. It tracks **sales, expenses, tax, discounts and profit**, works **offline**, and copies everything to **your own Google Sheet**. It runs from a normal web address (GitHub Pages), so nothing needs to be downloaded or paid for.

- **One app, many business types:** general, retail, food, services, wholesale (pick in the setup wizard; add more in one file).
- **Many businesses on one device:** each has its own separate books and settings.
- **Free to run:** static files on GitHub Pages + a Google Sheet + a small Google Apps Script. No server, no database bill.
- **Easy to modify:** small files, one job each, 54 automated tests, plain JavaScript with no build step and no dependencies.

## What it does

| Area | Features |
|---|---|
| Selling | Item grid with search and groups, custom items, quantity (including weights such as 1.25), line and order discounts (% or fixed), cash change calculator, receipt to print, share or copy, numbered receipts |
| Tax | Any number of rates, **added on top** or **already included**, worked out per line after discounts, shown on the receipt |
| Expenses | Category, vendor, tax paid, payment method, notes; imports your Telegram receipt bot's rows without retyping |
| Reports | Profit, takings, net sales, expenses, discounts, tax collected, estimated tax to pay, top items, payment methods, expense categories, tax by rate, day-by-day chart, any period, CSV download |
| History | Reopen any past receipt, void mistakes (kept in history, removed from totals) |
| Safety | Works offline, saves on the device first, sends to Google when online without duplicates, backup and restore file, nothing leaves the device unless sync is set up |

## Try it in two minutes

```
node tools/serve.js        # then open http://localhost:8080
node --test                # run the automated tests
```

To publish it for real, follow **`docs/WORKFLOW.md`**. To change it, see **`docs/CUSTOMIZING.md`**.

## Folder map

```
web/                  the app (this folder is what gets published)
  index.html, styles.css, manifest.webmanifest, sw.js (offline), icons/
  src/
    money.js          whole-number money, parsing, formatting
    pricing.js        discounts and tax rules
    reports.js        profit and tax summaries, periods, CSV
    presets.js        business types: wording, categories, payment methods
    services.js       record a sale, void, expenses, backup and restore
    store.js          on-device database, list of businesses
    sync.js           Google Sheets sync and Telegram receipt import
    receipt.js        receipt text
    config.js         app name, auto-sync switch
    ui/               one file per screen
backend/Code.gs       paste into Google Apps Script (the Sheets connection)
tests/                54 unit tests (node --test)
tests-browser/        optional full-app browser test (Playwright)
tools/                local server, icon generator
.github/workflows/    run tests on every push; publish to GitHub Pages
docs/                 WORKFLOW.md, CUSTOMIZING.md
```

## Known limits (read before promising a client anything)

1. **Data lives on each device first.** Reports on a phone show what was recorded on that phone (plus imported Telegram receipts). If two cashiers use two phones, both send sales to the same Sheet, which holds the combined total, but each phone's own Reports screen shows only its own sales. Combining them inside the app is the most valuable next feature.
2. **No logins or staff roles.** Anyone holding the phone can use the app. Protect devices with a screen lock. Roles and PIN codes are a reasonable next step.
3. **Products and settings are not synced between devices.** Set up each device, or restore the same backup file on each.
4. **No inventory or stock counts yet.**
5. **Records payments, does not process them.** Card and e-wallet are just labels for how the customer paid; no payment terminal is connected.
6. **Printing uses the browser's print dialog,** which works with ordinary printers and many Bluetooth receipt printers that appear as system printers. Direct thermal-printer commands are not included.
7. **Google Sheets is fine for small and medium shops,** not for very high volume. The data layer is separate from the screens so a real database can replace it later.
8. **Tax figures are estimates** built from what was entered. Tax rules differ by country and change; confirm with an accountant before filing. Nothing is hard-coded.
9. **The Google script link plus its secret is the only protection** for the Sheet connection. Keep both private; change the secret if it leaks.
10. **GitHub Pages on the free plan needs a public repository** (the repo contains only code, never client data).
11. **iPhone:** installing to the home screen works from Safari; iOS can clear web data for sites unused for weeks unless the app is installed, so keep backups.

## Tests

- `node --test`: 54 tests covering money rounding, discounts, tax (added and included), reports, receipts, backups, offline sync, duplicates, and the Telegram import. One test runs hundreds of random carts and checks that the totals always add up exactly.
- `tests-browser/smoke.cjs`: drives the real app through setup, a sale, an expense, reports, voiding, offline use and a second business (34 checks).

The Google Apps Script file is syntax-checked but can only be exercised against a real Google Sheet, so test sync once with the go-live checklist.
