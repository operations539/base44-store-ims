import { useEffect, useState } from 'react';
import { get } from '../../api.js';
import { Badge, Card, DataTable, Spinner, StatusBadge, fmtDate, fmtDateTime, qty } from '../../ui.jsx';
import { printTable } from '../../export.js';
import Tip from '../../components/Tip.jsx';

const COLUMNS = [
  { key: 'challan_code', label: 'Return', render: (r) => <strong>{r.challan_code}</strong> },
  { key: 'site_project_id', label: 'Site', render: (r) => r.site_project_id || r.vendor_name || '—' },
  { key: 'flow_type', label: 'Flow' },
  { key: 'stage', label: 'Stage', render: (r) => <StatusBadge value={r.status} />, csv: (r) => r.status },
  { key: 'sent_qty', label: 'Sent', align: 'right', render: (r) => qty(r.sent_qty), csv: (r) => r.sent_qty },
  { key: 'usable_qty', label: 'Usable', align: 'right', render: (r) => qty(r.usable_qty), csv: (r) => r.usable_qty },
  { key: 'scrap_qty', label: 'Scrap', align: 'right', render: (r) => qty(r.scrap_qty), csv: (r) => r.scrap_qty },
  {
    key: 'short_qty',
    label: 'Short',
    align: 'right',
    render: (r) => (Number(r.short_qty) > 0 ? <strong style={{ color: 'var(--red)' }}>{qty(r.short_qty)}</strong> : qty(r.short_qty)),
    csv: (r) => r.short_qty,
  },
  { key: 'return_raised_at', label: 'Raised', render: (r) => fmtDateTime(r.return_raised_at), csv: (r) => fmtDateTime(r.return_raised_at) },
  { key: 'pickup_assigned_at', label: 'Pickup', render: (r) => fmtDateTime(r.pickup_assigned_at), csv: (r) => fmtDateTime(r.pickup_assigned_at) },
  { key: 'picked_up_at', label: 'Picked up', render: (r) => fmtDateTime(r.picked_up_at), csv: (r) => fmtDateTime(r.picked_up_at) },
  { key: 'store_received_at', label: 'Received', render: (r) => fmtDateTime(r.store_received_at), csv: (r) => fmtDateTime(r.store_received_at) },
  { key: 'system_posted_at', label: 'Posted', render: (r) => fmtDateTime(r.system_posted_at), csv: (r) => fmtDateTime(r.system_posted_at) },
  { key: 'hours_open', label: 'Hrs open', align: 'right' },
  {
    key: 'delay_reason',
    label: 'Delay reason',
    render: (r) => (r.overdue && !r.delay_reason ? <Badge tone="red">Mandatory</Badge> : r.delay_reason || <span className="faint">—</span>),
    csv: (r) => r.delay_reason || '',
  },
  {
    key: 'short_missing_remarks',
    label: 'Short / missing remarks',
    render: (r) => (r.short_missing_flagged ? <span style={{ color: 'var(--red)' }}>{r.short_missing_remarks}</span> : <span className="faint">—</span>),
    csv: (r) => r.short_missing_remarks || '',
  },
];

export default function ReturnMonitor() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/dashboards/returns')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!data) return <Spinner label="Loading return monitor…" />;

  const { rows, totals } = data;

  return (
    <Card
      title={
        <>
          Material return &amp; 48-hr delay monitor
          <Tip text="Every return moves through five stages. Over 48 hours open, the store must record a delay reason before posting. Short or missing quantities raise a red flag to Owners & VP." />
        </>
      }
      subtitle="Five-stage turnaround timestamps, open pickups, delay reasons and red flags"
      actions={
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            printTable({
              title: 'Material Return & 48-Hour Delay Monitor',
              subtitle: `${totals.open} open · ${totals.overdue} overdue · ${totals.short_missing} short/missing`,
              columns: COLUMNS,
              rows,
            })
          }
        >
          PDF
        </button>
      }
    >
      <div className="stat-strip">
        <div className="stat-chip"><span className="lbl">Open returns</span><span className="val">{totals.open}</span></div>
        <div className="stat-chip amber"><span className="lbl">Open pickups</span><span className="val">{totals.open_pickups}</span></div>
        <div className="stat-chip red"><span className="lbl">Past 48h</span><span className="val">{totals.overdue}</span></div>
        <div className="stat-chip red"><span className="lbl">Short / missing</span><span className="val">{totals.short_missing}</span></div>
      </div>
      <DataTable columns={COLUMNS} rows={rows} exportName="return-monitor" rowKey={(r) => r.id} />
    </Card>
  );
}
