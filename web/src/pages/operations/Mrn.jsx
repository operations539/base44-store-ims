import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Badge, DataTable, EmptyState, Icon, Spinner, StatusBadge, fmtDate, qty } from '../../ui.jsx';

const STAGES = ['Pending', 'Approved', 'Partial', 'Dispatched', 'Delivered', 'Returned', 'Rejected'];

export default function Mrn() {
  const { has } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('All');
  const [stage, setStage] = useState('');

  useEffect(() => {
    get('/mrn')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    let list = data.mrns;
    if (tab === 'Queue') list = list.filter((m) => m.status === 'Pending');
    if (stage) list = list.filter((m) => m.stage === stage);
    return list;
  }, [data, tab, stage]);

  if (error) return <div className="page"><div className="alert alert-red">{error}</div></div>;
  if (!data) return <Spinner label="Loading material requests…" />;

  const pendingCount = data.mrns.filter((m) => m.status === 'Pending').length;

  const columns = [
    {
      key: 'mrn_no',
      label: 'MRN no',
      render: (r) => (
        <Link to={`/mrn/${r.id}`} className="mono" style={{ color: 'var(--primary-600)', fontWeight: 600 }}>
          {r.mrn_no}
        </Link>
      ),
    },
    { key: 'mrn_date', label: 'Raised', render: (r) => fmtDate(r.mrn_date) },
    {
      key: 'site_project_id',
      label: 'Site',
      render: (r) => (
        <div>
          <div>{r.site_project_id}</div>
          <div className="small faint">{r.client_project_name}</div>
        </div>
      ),
    },
    {
      key: 'priority',
      label: 'Priority',
      render: (r) => <Badge tone={r.priority === 'Urgent' ? 'red' : r.priority === 'Low' ? 'neutral' : 'blue'}>{r.priority}</Badge>,
    },
    { key: 'line_count', label: 'Items', align: 'right' },
    {
      key: 'requested_qty',
      label: 'Requested',
      align: 'right',
      render: (r) => qty(r.requested_qty),
    },
    {
      key: 'dispatched_qty',
      label: 'Dispatched',
      align: 'right',
      render: (r) => (
        <span className={r.dispatched_qty > 0 ? '' : 'faint'}>{qty(r.dispatched_qty)}</span>
      ),
    },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
    { key: 'stage', label: 'Tracking', render: (r) => <StatusBadge value={r.stage} /> },
    {
      key: 'open',
      label: '',
      sortable: false,
      searchable: false,
      render: (r) => (
        <Link className="btn btn-sm" to={`/mrn/${r.id}`}>
          Open <Icon name="chevron" size={13} />
        </Link>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{data.canApprove ? 'Material requests' : 'My site tracking'}</h1>
          <p>
            {data.canApprove
              ? 'Approve, part-approve or reject site requests with live store stock beside every line.'
              : 'Every request raised for your sites, with its live dispatch stage. Pricing is never shown.'}
          </p>
        </div>
        <div className="actions">
          {has('mrn.create') ? (
            <Link className="btn btn-primary" to="/mrn/new">
              <Icon name="plus" size={15} /> Raise MRN
            </Link>
          ) : null}
        </div>
      </div>

      <div className="filter-bar">
        {data.canApprove ? (
          <button
            type="button"
            className={`btn ${tab === 'Queue' ? 'btn-primary' : ''}`}
            onClick={() => setTab('Queue')}
          >
            Approval queue
            <span className="badge badge-amber" style={{ marginLeft: 4 }}>{pendingCount}</span>
          </button>
        ) : null}
        <button
          type="button"
          className={`btn ${tab === 'All' ? 'btn-primary' : ''}`}
          onClick={() => setTab('All')}
        >
          All requests
          <span className="badge badge-neutral" style={{ marginLeft: 4 }}>{data.mrns.length}</span>
        </button>
        <span className="spacer" />
        <select className="select" style={{ maxWidth: 200 }} value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">Every tracking stage</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        exportName="material-requests"
        initialSort={{ key: 'mrn_date', dir: 'desc' }}
        empty={
          <EmptyState
            icon="file"
            title="No material requests here"
            description={
              tab === 'Queue'
                ? 'Nothing is waiting for approval right now.'
                : 'Raise an MRN from the button above to start the store → site flow.'
            }
          />
        }
      />
    </div>
  );
}
