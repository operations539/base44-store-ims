/**
 * One-click "PDF" export: renders the current view as a clean A4 table in a
 * print window, so the browser's Save-as-PDF produces the document.
 */
const esc = (v) =>
  String(v === null || v === undefined ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function printTable({ title, subtitle, columns, rows, footer }) {
  const win = window.open('', '_blank', 'width=1100,height=820');
  if (!win) return false;

  const head = columns.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const body = rows
    .map(
      (row) =>
        `<tr>${columns
          .map((c) => `<td class="${c.align === 'right' ? 'num' : ''}">${esc(c.pdf ? c.pdf(row) : row[c.key])}</td>`)
          .join('')}</tr>`
    )
    .join('');

  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1f2937; margin: 0; padding: 8px; }
  h1 { font-size: 16px; margin: 0 0 2px; color: #1e3a8a; }
  .sub { color: #64748b; font-size: 11px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em; color: #475569;
       border-bottom: 1.5px solid #94a3b8; padding: 5px 6px; }
  td { padding: 5px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr:nth-child(even) td { background: #f8fafc; }
  .foot { margin-top: 10px; font-size: 9.5px; color: #94a3b8; }
</style></head><body>
<h1>${esc(title)}</h1>
<div class="sub">${esc(subtitle || '')} · Generated ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</div>
<table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${columns.length}">No records.</td></tr>`}</tbody></table>
<div class="foot">${esc(footer || 'Kool Mart India · Store IMS')}</div>
<script>window.onload = function () { window.print(); };<\/script>
</body></html>`);
  win.document.close();
  return true;
}
