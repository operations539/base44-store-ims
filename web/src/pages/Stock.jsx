import { useEffect, useMemo, useState } from 'react';
import { get } from '../api.js';
import { Badge, Card, DataTable, EmptyState, Icon, Spinner, inr, qty } from '../ui.jsx';

export default function Stock() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('High Side');

  useEffect(() => {
    get('/stock')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  const items = useMemo(
    () => (data ? data.items.filter((i) => i.category === tab) : []),
    [data, tab]
  );

  if (error) return <div className="page"><div className="alert alert-red">{error}</div></div>;
  if (!data) return <Spinner label="Loading live stock…" />;

  const columns = [
    {
      key: 'item_code',
      label: 'Item code',
      render: (r) => <span className="mono">{r.item_code}</span>,
    },
    { key: 'item_name', label: 'Item' },
    { key: 'model_no', label: 'Model / Serial series', render: (r) => r.model_no || <span className="faint">—</span> },
    { key: 'unit', label: 'UOM' },
    {
      key: 'store_physical_stock',
      label: 'Store stock',
      align: 'right',
      render: (r) => (
        <span className={r.store_physical_stock < 0 ? 'negative' : ''}>
          {qty(r.store_physical_stock)} {r.unit}
        </span>
      ),
    },
    { key: 'min_qty_alert', label: 'Min alert', align: 'right', render: (r) => qty(r.min_qty_alert) },
    { key: 'scrap_qty', label: 'Scrap', align: 'right', render: (r) => qty(r.scrap_qty) },
    ...(data.pricingVisible
      ? [{ key: 'latest_rate', label: 'Latest rate', align: 'right', render: (r) => inr(r.latest_rate) }]
      : []),
    {
      key: 'flags',
      label: 'Flags',
      sortable: false,
      searchable: false,
      render: (r) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {r.is_negative ? <Badge tone="amber">Minus stock</Badge> : null}
          {r.below_min ? <Badge tone="red">Below min</Badge> : null}
          {!r.is_negative && !r.below_min ? <Badge tone="green">OK</Badge> : null}
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Live stock</h1>
          <p>
            Store physical stock is a signed balance — negative values are allowed and flagged in amber, never
            blocked. {data.pricingVisible ? 'Rates are visible for your role.' : 'Rates are hidden for your role.'}
          </p>
        </div>
        <div className="actions">
          <span className="chip">
            <Icon name="box" size={14} /> {data.summary.highSide} High Side
          </span>
          <span className="chip">
            <Icon name="box" size={14} /> {data.summary.lowSide} Low Side
          </span>
        </div>
      </div>

      {(data.summary.negative > 0 || data.summary.belowMin > 0) && (
        <div className="alert alert-amber" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={16} />
          <div>
            {data.summary.negative > 0 ? (
              <div>
                <strong>{data.summary.negative}</strong> item(s) in minus stock — urgent dispatches were authorised
                and recorded in the audit trail.
              </div>
            ) : null}
            {data.summary.belowMin > 0 ? (
              <div>
                <strong>{data.summary.belowMin}</strong> item(s) below the minimum alert quantity.
              </div>
            ) : null}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {['High Side', 'Low Side'].map((name) => (
          <button
            key={name}
            type="button"
            className={`btn ${tab === name ? 'btn-primary' : ''}`}
            onClick={() => setTab(name)}
          >
            {name}
            <span className="badge badge-neutral" style={{ marginLeft: 4 }}>
              {data.items.filter((i) => i.category === name).length}
            </span>
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        rows={items}
        exportName={`stock-${tab.toLowerCase().replace(' ', '-')}`}
        initialSort={{ key: 'item_name', dir: 'asc' }}
        empty={
          <EmptyState
            icon="box"
            title={`No ${tab} items yet`}
            description="Add items from the Items Master or import them from CSV."
          />
        }
      />

      <p className="small muted" style={{ marginTop: 12 }}>
        Serial numbers are captured on the challan lines for High Side items; Low Side items track quantity by
        their own unit (nos, pcs, feet, mtr, sqft, kg, roll, box).
      </p>
    </div>
  );
}
