import { useEffect, useState } from 'react';
import { get } from '../../api.js';
import { Card, DataTable, Spinner, StatusBadge, fmtDate, qty } from '../../ui.jsx';
import { printTable } from '../../export.js';

const COLUMNS = [
  { key: 'mrn_no', label: 'MRN', render: (r) => <strong>{r.mrn_no}</strong> },
  { key: 'mrn_date', label: 'Date', render: (r) => fmtDate(r.mrn_date), csv: (r) => fmtDate(r.mrn_date) },
  { key: 'site_project_id', label: 'Site' },
  { key: 'client_project_name', label: 'Project' },
  { key: 'priority', label: 'Priority', render: (r) => <StatusBadge value={r.priority} />, csv: (r) => r.priority },
  { key: 'routing_type', label: 'Routing' },
  { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} />, csv: (r) => r.status },
  { key: 'stage', label: 'Delivery stage', render: (r) => <StatusBadge value={r.stage} />, csv: (r) => r.stage },
  { key: 'requested_qty', label: 'Requested', align: 'right', render: (r) => qty(r.requested_qty), csv: (r) => r.requested_qty },
  { key: 'approved_qty', label: 'Approved', align: 'right', render: (r) => qty(r.approved_qty), csv: (r) => r.approved_qty },
  { key: 'dispatched_qty', label: 'Dispatched', align: 'right', render: (r) => qty(r.dispatched_qty), csv: (r) => r.dispatched_qty },
  { key: 'aging_days', label: 'Age (days)', align: 'right', render: (r) => (Number(r.aging_days) > 7 ? <strong>{r.aging_days}</strong> : r.aging_days) },
];

export default function MrnTracker() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/dashboards/mrn-tracker')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!data) return <Spinner label="Loading MRN tracker…" />;

  const { rows, totals } = data;

  return (
    <Card
      title="MRN-to-delivery tracker"
      subtitle="Open, partial and fulfilled requests by site, with aging"
      actions={
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            printTable({
              title: 'MRN-to-Delivery Tracker',
              subtitle: `${totals.open} open · ${totals.partial} partial · ${totals.fulfilled} fulfilled`,
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
        <div className="stat-chip"><span className="lbl">Open</span><span className="val">{totals.open}</span></div>
        <div className="stat-chip amber"><span className="lbl">Partial</span><span className="val">{totals.partial}</span></div>
        <div className="stat-chip"><span className="lbl">Fulfilled</span><span className="val">{totals.fulfilled}</span></div>
      </div>
      <DataTable columns={COLUMNS} rows={rows} exportName="mrn-tracker" rowKey={(r) => r.id} />
    </Card>
  );
}
