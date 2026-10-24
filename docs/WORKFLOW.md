# Workflow: from nothing to a client using the app

This is the whole path, in order. Phases 1 to 3 are done once. Phases 4 to 8 repeat for each new client.
Everything uses free tools: GitHub, GitHub Pages and Google Sheets.

| Phase | What happens | Time |
|---|---|---|
| 1. Prepare accounts | GitHub and Google accounts, secured | 15 min, once |
| 2. Publish the app | Code goes on GitHub, the app goes live on GitHub Pages | 15 min, once |
| 3. Check it works | Run the tests, open the live app | 10 min, once |
| 4. Discovery | Ask the client the questions below | 20 min per client |
| 5. Connect their Google Sheet | Paste the script, deploy, copy the link | 10 min per client |
| 6. Set up on their devices | Open the link, install, run the wizard | 10 min per device |
| 7. Go-live checklist | Test sale, test expense, test sync, backup | 15 min per client |
| 8. Run and maintain | Daily use, updates, backups | ongoing |

---

## Phase 1: Prepare accounts

1. Create a GitHub account at github.com. Turn on two-factor login (Settings > Password and authentication) and save the recovery codes offline.
2. Use a Google account for the business data. For a client, prefer **the client's own Google account**, so they own their sheet and you are not holding their records.
3. Install Node.js 22 or newer on your computer (only needed if you want to run tests or the app locally). The app itself needs nothing installed.

## Phase 2: Publish the app (free)

1. Create a new repository on GitHub, for example `simple-pos`.
   - GitHub Pages on the free plan needs a **public** repository. This is fine here: the repository holds only the app code. **Client data never goes into it** (it stays on the devices and in the client's own Google Sheet). Never commit passwords, secrets or links to a client's script.
2. Upload the contents of this folder to the repository (drag and drop on the GitHub website works, or use `git push`). Keep the `.github` folder; it holds the automatic test and publish steps.
3. In the repository open **Settings > Pages**. Under "Build and deployment" set **Source** to **GitHub Actions**.
4. Open the **Actions** tab. The "Publish the app" run starts by itself. When it turns green, the address appears in Settings > Pages, like `https://YOUR-NAME.github.io/simple-pos/`.

If you want a private repository, Cloudflare Pages and Netlify also host static sites free from private repositories. Point them at the `web` folder; there is no build step.

## Phase 3: Check it works

On your computer, in this folder:

```
node --test                  # 54 automated tests of the money, tax and sync logic
node tools/serve.js          # try the app at http://localhost:8080
```

Then open the live address on your phone and tap **Install app** (Android Chrome) or **Share > Add to Home Screen** (iPhone Safari).

## Phase 4: Discovery (ask the client)

Write the answers down; they decide the settings.

- What does the business sell: products, menu items, services, or bulk orders? (Picks the starting preset.)
- Which currency? Are prices **with tax included** or is tax **added at checkout**? Which tax rates apply? Is the business registered for tax? (Tax rates are set by their country and tax office. Ask their accountant. The app does not decide this for them.)
- Which payment methods are used? Which discount types (staff, loyalty, bulk)?
- What are the main expense categories? Does their accountant want specific ones?
- How many devices and people will take sales? (Important: see "Known limits" in the README.)
- Do they already have a Google Sheet or the Telegram receipt bot? Which tab does it write to, and what are its column headings?
- What should appear on receipts: address, phone, tax number, thank-you message?

## Phase 5: Connect their Google Sheet

Do this signed in to the client's Google account.

1. Open the Google Sheet (create a new one, or use the one the Telegram bot writes to).
2. **Extensions > Apps Script**. Delete the sample code and paste all of `backend/Code.gs`. Save.
3. **Project Settings (gear icon) > Script properties > Add script property**:
   - `SECRET` = a long random phrase (20 or more characters). Use a password manager to generate it.
   - Optional: `RECEIPTS_SHEET` = the exact tab name the Telegram bot writes to (default is `Receipts`).
4. In the editor choose the function **setup** and press **Run**. Google asks for permission. Because this is your own script, you will see "Google hasn't verified this app": choose **Advanced > Go to (project name)** and allow. This creates the `Sales`, `SaleItems` and `Expenses` tabs.
5. **Deploy > New deployment > Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Deploy and copy the **Web app URL**.
   - "Anyone" means anyone holding both the link and the secret. Keep both private.
6. Keep the URL and the secret for phase 6. If you later change the script, use **Deploy > Manage deployments > Edit > New version**. The link stays the same.

**Telegram receipts:** the importer needs a date column and an amount (or total) column on the receipts tab. It recognises these headings (any capitalisation): date; vendor, merchant, store, shop, supplier, name; amount, total, price, cost; category, type; note, description, items; and optionally id. Rows are identified by their row number, so **do not sort or delete rows** in that tab. Rename a heading if the importer reports that it cannot find one. The Telegram bot itself is not changed.

## Phase 6: Set up on their devices

1. Open the app address on the device and install it to the home screen.
2. The setup wizard asks for business name, type, currency and tax. Choose carefully: **the currency cannot be changed afterwards** (so past amounts stay correct). Everything else can be changed in Settings.
3. Go to **Settings** and fill in:
   - Tax rates, quick discounts, payment methods and expense categories from the discovery answers.
   - Receipt header (address, phone, tax number) and footer.
   - **Google Sheets sync**: paste the Web app link and the secret, then **Save settings**.
4. Press **Send to Sheets**. Open the Google Sheet to confirm the tabs fill in.
5. Press **Import Telegram receipts** if they use the bot. The count of new, existing and skipped rows is shown.
6. In **Items** add or edit the products, menu or services with prices and the right tax rate.

## Phase 7: Go-live checklist

- [ ] Make a test sale with a discount. Check the receipt total and tax against a calculator.
- [ ] Switch airplane mode on, make another sale, switch it off. The badge should change from "Offline" to "Synced" and both sales appear in the Sheet.
- [ ] Void the test sales (Reports > Sales in this period > Void), then confirm the totals drop to zero.
- [ ] Add a test expense with tax, check it appears in Reports and in the Sheet.
- [ ] **Download a backup** (Settings > Backup) and check the file opens.
- [ ] Show the client Reports: profit, takings, tax, discounts, CSV download.
- [ ] Explain the three rules below.

Three rules to teach the client:
1. **Your data lives on this phone first.** Do not clear the browser's data or uninstall the app without a backup.
2. **Sync when you have internet.** The badge at the top shows what is waiting.
3. **Download a backup weekly** and keep it outside the phone.

## Phase 8: Run and maintain

**Daily:** sell, record expenses, glance at the sync badge.
**Month end:** Reports > pick the month > download the CSV files and send them to the accountant. Check tax figures with the accountant; they are estimates from the data entered.
**Updating the app for everyone:** change the code, push to `main`. The tests run first; only if they pass the new version is published. Phones pick the update up the next time the app is opened and closed.
**Requests from a client:** see `CUSTOMIZING.md`. Most changes (taxes, categories, payment methods, wording, receipt text) are settings, not code.
**If a phone is lost:** the Sheet holds every synced sale and expense. Install the app on a new phone, run the wizard, restore the latest backup file, and import the Telegram receipts again.
**If sync stops:** the badge shows how many records are waiting; nothing is lost. The usual causes are no internet, a changed secret, or the script deployment link having changed.
