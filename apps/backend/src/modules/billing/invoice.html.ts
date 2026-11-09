import type { InvoiceSnapshot } from './billing-invoice';

// Print-friendly tax invoice page, same plain style as the order receipt.

function esc(value: string | number | null | undefined): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
const day = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })
    : '';

export function buildSubscriptionInvoiceHtml(invoice: {
  invoiceNumber: string;
  issuedAt: Date;
  snapshot: InvoiceSnapshot;
}): string {
  const s = invoice.snapshot;
  const lines = s.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.description)}${
          s.period.start && s.period.end
            ? `<div class="sub">${esc(day(s.period.start))} to ${esc(day(s.period.end))}</div>`
            : ''
        }</td><td>${esc(l.sac)}</td><td class="num">${rupees(l.taxableValuePaise)}</td></tr>`,
    )
    .join('');
  const taxRows = s.taxLines
    .map((t) => {
      const rate = t.label === 'IGST' ? s.gstRatePercent : s.gstRatePercent / 2;
      return `<tr><td>${t.label} @ ${esc(rate)}%</td><td class="num">${rupees(t.amountPaise)}</td></tr>`;
    })
    .join('');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(invoice.invoiceNumber)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; padding: 12mm; color: #111; background: #fff; }
  .doc { max-width: 190mm; margin: 0 auto; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  .meta, .party { font-size: 12px; line-height: 1.5; }
  .row { display: flex; justify-content: space-between; gap: 16px; margin: 12px 0; }
  .party { width: 50%; border: 1px solid #999; padding: 8px; }
  .party h2 { font-size: 11px; text-transform: uppercase; color: #555; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
  th, td { border: 1px solid #999; padding: 6px; text-align: left; vertical-align: top; }
  th { background: #eee; }
  .num { text-align: right; white-space: nowrap; }
  .sub { font-size: 11px; color: #555; }
  .totals { width: 50%; margin-left: auto; }
  .grand td { font-weight: 700; }
  @page { size: A4; margin: 10mm; }
</style>
</head>
<body>
  <div class="doc">
    <h1>Tax invoice</h1>
    <div class="meta">
      Invoice number: <strong>${esc(invoice.invoiceNumber)}</strong><br>
      Invoice date: ${esc(day(invoice.issuedAt.toISOString()))}
    </div>
    <div class="row">
      <div class="party">
        <h2>Seller</h2>
        <strong>${esc(s.seller.name)}</strong><br>
        ${esc(s.seller.address)}<br>
        GSTIN: ${esc(s.seller.gstin)}
      </div>
      <div class="party">
        <h2>Buyer</h2>
        <strong>${esc(s.buyer.name)}</strong>
        ${s.buyer.branchName ? `<br>${esc(s.buyer.branchName)}` : ''}
        ${s.buyer.address ? `<br>${esc(s.buyer.address)}` : ''}
        ${s.buyer.gstin ? `<br>GSTIN: ${esc(s.buyer.gstin)}` : ''}
      </div>
    </div>
    <table>
      <thead><tr><th>Description</th><th>SAC</th><th class="num">Taxable value</th></tr></thead>
      <tbody>${lines}</tbody>
    </table>
    <table class="totals">
      <tr><td>Taxable value</td><td class="num">${rupees(s.taxableValuePaise)}</td></tr>
      ${taxRows}
      <tr class="grand"><td>Total</td><td class="num">${rupees(s.totalPaise)}</td></tr>
    </table>
  </div>
</body>
</html>`;
}
