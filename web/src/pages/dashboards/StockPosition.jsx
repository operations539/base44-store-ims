import { useEffect, useState } from 'react';
import { get } from '../../api.js';
import { Badge, Card, DataTable, Spinner, inr, qty } from '../../ui.jsx';
import { printTable } from '../../export.js';
import Tip from '../../components/Tip.jsx';

const ITEM_COLUMNS = [
  { key: 'item_code', label: 'Code', render: (r) => <strong>{r.item_code}</strong> },
  { key: 'item_name', label: 'Item' },
  { key: 'category', label: 'Side', render: (r) => <Badge tone={r.category === 'High Side' ? 'navy' : 'blue'}>{r.category}</Badge>, csv: (r) => r.category },
  { key: 'unit', label: 'UOM' },
  { key: 'store_physical_stock', label: 'Store stock', align: 'right', render: (r) => <span style={{ color: r.minus ? 'var(--amber)' : undefined, fontWeight: r.minus ? 700 : 500 }}>{qty(r.store_physical_stock)}</span>, csv: (r) => r.store_physical_stock },
  { key: 'min_qty_alert', label: 'Min qty', align: 'right', render: (r) => qty(r.min_qty_alert), csv: (r) => r.min_qty_alert },
  { key: 'scrap_qty', label: 'Scrap', align: 'right', render: (r) => qty(r.scrap_qty), csv: (r) => r.scrap_qty },
  {
    key: 'flags',
    label: 'Flags',
    render: (r) => (
      <>
        {r.minus ? <Badge tone="amber">Minus stock</Badge> : null}
        {r.below_min ? <Badge tone="red">Below min</Badge> : null}
        {!r.minus && !r.below_min ? <span className="faint">—</span> : null}
      </>
    ),
    csv: (r) => [r.minus ? 'Minus stock' : '', r.below_min ? 'Below min' : ''].filter(Boolean).join(' / '),
  },
];

const LEDGER_COLUMNS = [
  { key: 'site_project_id', label: 'Site' },
  { key: 'client_project_name', label: 'Project' },
  { key: 'item_code', label: 'Item code' },
  { key: 'item_name', label: 'Item' },
  { key: 'unit', label: 'UOM' },
  { key: 'issued_qty', label: 'Issued', align: 'right', render: (r) => qty(r.issued_qty), csv: (r) => r.issued_qty },
  { key: 'returned_qty', label: 'Returned', align: 'right', render: (r) => qty(r.returned_qty), csv: (r) => r.returned_qty },
  { key: 'net_qty', label: 'Net at site', align: 'right', render: (r) => qty(r.net_qty), csv: (r) => r.net_qty },
];

export default function StockPosition() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/dashboards/stock')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!data) return <Spinner label="Loading stock position…" />;

  const { rows, unitTotals, siteLedger, pricingVisible, totals } = data;
  const itemColumns = pricingVisible
    ? [...ITEM_COLUMNS, { key: 'latest_rate', label: 'Latest rate', align: 'right', render: (r) => inr(r.latest_rate), csv: (r) => r.latest_rate }]
    : ITEM_COLUMNS;

  return (
    <div className="stack">
      <Card
        title={
          <>
            Live high side &amp; low side store stock
            <Tip text="Balances are signed: a minus figure means material was dispatched before purchase was posted. Min-qty alerts show items at or below their reorder level." />
          </>
        }
        subtitle="Signed balances, amber minus-stock flags and min-qty reorder alerts"
        actions={
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              printTable({
                title: 'Live Store Stock Position',
                subtitle: `${totals.minus} minus-stock · ${totals.below_min} below minimum`,
                columns: itemColumns,
                rows,
              })
            }
          >
            PDF
          </button>
        }
      >
        <div className="stat-strip">
          {unitTotals.map((u) => (
            <div className="stat-chip" key={u.unit}>
              <span className="lbl">{u.unit} · {u.items} items</span>
              <span className="val">{qty(u.stock)}</span>
            </div>
          ))}
          <div className="stat-chip amber"><span className="lbl">Minus stock</span><span className="val">{totals.minus}</span></div>
          <div className="stat-chip red"><span className="lbl">Below min</span><span className="val">{totals.below_min}</span></div>
        </div>
        <DataTable columns={itemColumns} rows={rows} exportName="store-stock" rowKey={(r) => r.id} />
      </Card>

      <Card
        title="Site material ledger"
        subtitle="Issued minus returned, derived from the immutable movement ledger"
        actions={
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              printTable({ title: 'Site Material Ledger', subtitle: 'Derived two-ledger position', columns: LEDGER_COLUMNS, rows: siteLedger })
            }
          >
            PDF
          </button>
        }
      >
        <DataTable columns={LEDGER_COLUMNS} rows={siteLedger} exportName="site-material-ledger" rowKey={(r, i) => `${r.site_project_id}-${r.item_code}-${i}`} />
      </Card>
    </div>
  );
}
