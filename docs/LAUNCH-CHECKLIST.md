# Launch checklist

Facts and open questions only; nothing here is legal or tax advice.

## Legal
- [ ] Lawyer review of the AGPL-3.0 obligations (LICENSE, NOTICE.md, the in-app "Source code" link, the "Licensed AGPL-3.0." line in the website footer).
- [ ] Terms of Service: missing.
- [ ] Privacy Policy: missing (who is Data Fiduciary / Processor; see COMPLIANCE-INDIA.md).
- [ ] Refund and cancellation policy for subscriptions: missing.

## Tax (questions for the CA)
- [ ] Sales invoice series: one per branch prefix and financial year is built; is a separate series per device (offline billing) allowed?
- [ ] Can a bill issued offline be uploaded later under the same number?
- [ ] Cancelled bills, and credit notes for refunds (refunds today keep the invoice number; no credit note document exists).
- [ ] Tax invoice vs bill of supply for restaurants on 5% without input tax credit.
- [ ] E-invoice threshold and when it applies.
- [ ] Financial-year rollover rules for the invoice series.
- [ ] SAC code and GST rate for UDYOG's own subscription invoices.

## Keys and settings to fill (.env.production)
- [ ] Razorpay live key id, key secret, webhook secret; webhook URL and events (docs/DEPLOY.md step 8).
- [ ] COMPANY_NAME, COMPANY_GSTIN, COMPANY_ADDRESS, SUBSCRIPTION_SAC, GST_RATE_PERCENT.
- [ ] SMTP_URL and SMTP_FROM.
- [ ] All secrets generated fresh for production (not copied from staging).

## Product
- [ ] Pricing decided; plans created in /platform/plans.
- [ ] TRIAL_DAYS decided; ALLOW_SIGNUP set.
- [ ] Support email set (NEXT_PUBLIC_SUPPORT_EMAIL repository variable).

## Windows app
- [ ] Test checklist in windows/README.md done on a real Windows PC with real printers.
- [ ] Decision: Microsoft Store identity or code-signing certificate.

## Ops
- [ ] Backup run and a restore tested on a scratch copy.
- [ ] Uptime monitor on /api/health with alerts.
- [ ] Rollback tested on staging (scripts/rollback.sh and the production workflow with `tag`).
- [ ] EBS snapshot routine before each release.

## Smoke tests (staging, then production)
1. https://<domain> loads with a valid certificate.
2. /api/health answers {"status":"ok"}.
3. Sign up a restaurant (or log in) and log out.
4. Create a menu category and an item with HSN/SAC.
5. Create a table; open its QR menu on a phone.
6. POS: place a dine-in order; it appears on the kitchen display.
7. Take a cash payment; the receipt shows the invoice number (INDIA_GST branch).
8. Print the receipt from the browser print dialog.
9. Reports: sales report for today shows the order; invoice register CSV downloads.
10. Staff: add a user with a role; that user can log in and sees only allowed pages.
11. Realtime: a second browser sees the new order without reload.
12. Upload a menu image; it shows on the POS.
13. Platform admin: /platform lists the restaurant; suspend and unsuspend it.
14. Billing page loads; a test subscription checkout works on staging.
15. Run a backup and see it in the bucket.

## Known gaps
- Offline billing (no internet) is not built yet.
- No email verification at sign-up.
- KDS "reprint" button calls server printing, which answers 409 in cloud mode.
- No credit note document for refunds; refunds keep the invoice number.
- No plan change/upgrade flow; refunds of subscriptions not handled.
- Subscription invoices are HTML only (print to PDF).
- Rate limits are in memory (one backend only).
- Windows app: no Store identity or signing yet; C# is not unit-tested.
