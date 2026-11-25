import { useEffect, useState } from 'react';
import { get } from '../../api.js';
import { Badge, Card, DataTable, Spinner, fmtDate, fmtDateTime, inr, qty } from '../../ui.jsx';
import { printTable } from '../../export.js';
import Tip from '../../components/Tip.jsx';

const SCRAP_COLUMNS = [
  { key: 'item_code', label: 'Code', render: (r) => <strong>{r.item_code}</strong> },
  { key: 'item_name', label: 'Item' },
  { key: 'category', label: 'Side' },
  { key: 'unit', label: 'UOM' },
  { key: 'scrap_qty', label: 'Scrap qty', align: 'right', render: (r) => qty(r.scrap_qty), csv: (r) => r.scrap_qty },
];

const SHORT_COLUMNS = [
  { key: 'challan_code', label: 'Return', render: (r) => <strong>{r.challan_code}</strong> },
  { key: 'site_project_id', label: 'Site' },
  { key: 'short_qty', label: 'Short / missing', align: 'right', render: (r) => <span style={{ color: 'var(--red)', fontWeight: 700 }}>{qty(r.short_qty)}</span>, csv: (r) => r.short_qty },
  { key: 'short_missing_remarks', label: 'Remarks' },
  { key: 'system_posted_at', label: 'Posted', render: (r) => fmtDateTime(r.system_posted_at), csv: (r) => fmtDateTime(r.system_posted_at) },
];

const BILL_COLUMNS = [
  { key: 'purchase_id', label: 'Purchase', render: (r) => <strong>{r.purchase_id}</strong> },
  { key: 'entry_date', label: 'Date', render: (r) => fmtDate(r.entry_date), csv: (r) => fmtDate(r.entry_date) },
  { key: 'vendor_name', label: 'Vendor' },
  { key: 'item_code', label: 'Item' },
  { key: 'qty', label: 'Qty', align: 'right', render: (r) => `${qty(r.qty)} ${r.unit}`, csv: (r) => r.qty },
  {
    key: 'bill_status',
    label: 'Bill',
    render: (r) => (r.bill_status === 'Pending' ? <Badge tone="amber">Bill pending</Badge> : <Badge tone="green">Received</Badge>),
    csv: (r) => r.bill_status,
  },
  { key: 'rate', label: 'Rate', align: 'right', render: (r) => (Number(r.rate) === 0 ? <Badge tone="red">Rate 0</Badge> : inr(r.rate)), csv: (r) => r.rate },
  { key: 'po_code', label: 'PO' },
];

export default function ScrapBills() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/dashboards/scrap-bills')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!data) return <Spinner label="Loading scrap and bills…" />;

  const { rows, shortReturns, bills, pricingVisible, totals } = data;
  const billColumns = pricingVisible ? BILL_COLUMNS : BILL_COLUMNS.filter((c) => c.key !== 'rate');

  return (
    <div className="stack">
      <div className="stat-strip">
        <div className="stat-chip amber"><span className="lbl">Scrap items</span><span className="val">{totals.scrap_items}</span></div>
        <div className="stat-chip red"><span className="lbl">Short / missing returns</span><span className="val">{totals.short_returns}</span></div>
        <div className="stat-chip"><span className="lbl">Pending bills</span><span className="val">{totals.pending_bills}</span></div>
      </div>

      <Card
        title="Damaged / scrap material"
        subtitle="Scrap bucket totals from posted returns"
        actions={
          <button type="button" className="btn btn-sm" onClick={() => printTable({ title: 'Damaged / Scrap Material', subtitle: 'Scrap bucket by item', columns: SCRAP_COLUMNS, rows })}>
            PDF
          </button>
        }
      >
        <DataTable columns={SCRAP_COLUMNS} rows={rows} exportName="scrap-material" rowKey={(r, i) => `${r.item_code}-${i}`} />
      </Card>

      <Card
        title="Short / missing material red flags"
        subtitle="Returns where sent quantity was not fully accounted for"
        actions={
          <button type="button" className="btn btn-sm" onClick={() => printTable({ title: 'Short / Missing Material', subtitle: 'Red-flagged returns', columns: SHORT_COLUMNS, rows: shortReturns })}>
            PDF
          </button>
        }
      >
        <DataTable columns={SHORT_COLUMNS} rows={shortReturns} exportName="short-missing" rowKey={(r) => r.id} />
      </Card>

      <Card
        title={
          <>
            Pending vendor bills
            <Tip text="A purchase can be received at a zero rate and billed later. These entries stay open until the vendor bill arrives." />
          </>
        }
        subtitle="Bill pending or received at ₹0 rate"
        actions={
          <button type="button" className="btn btn-sm" onClick={() => printTable({ title: 'Pending Vendor Bills', subtitle: 'Rate = 0 or bill pending', columns: billColumns, rows: bills })}>
            PDF
          </button>
        }
      >
        <DataTable columns={billColumns} rows={bills} exportName="pending-vendor-bills" rowKey={(r) => r.purchase_id} />
      </Card>
    </div>
  );
}
