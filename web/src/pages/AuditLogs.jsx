import { useEffect, useState } from 'react';
import { get } from '../api.js';
import { Badge, DataTable, Spinner, fmtDateTime } from '../ui.jsx';

const MODULES = ['', 'Admin', 'Masters', 'Dispatch', 'Returns', 'MRN', 'Purchase'];

export default function AuditLogs() {
  const [logs, setLogs] = useState(null);
  const [module, setModule] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const query = module ? `?module=${encodeURIComponent(module)}` : '';
    get(`/audit${query}`)
      .then((d) => setLogs(d.logs))
      .catch((err) => setError(err.message));
  }, [module]);

  if (error) return <div className="page"><div className="alert alert-red">{error}</div></div>;
  if (!logs) return <Spinner label="Loading audit trail…" />;

  const columns = [
    { key: 'ts', label: 'Timestamp (IST)', render: (r) => <span className="nowrap mono small">{fmtDateTime(r.ts)}</span> },
    {
      key: 'actor_name',
      label: 'Actor',
      render: (r) => (
        <div>
          <div>{r.actor_name || 'System'}</div>
          <div className="small muted">{r.actor_role || ''}</div>
        </div>
      ),
    },
    {
      key: 'emulated',
      label: 'Emulated as',
      render: (r) => (r.emulated ? <Badge tone="amber">{r.effective_name || 'user'}</Badge> : <span className="faint">—</span>),
    },
    { key: 'module', label: 'Module', render: (r) => <Badge tone="neutral">{r.module}</Badge> },
    { key: 'action', label: 'Action', render: (r) => <span className="mono small">{r.action}</span> },
    { key: 'record_id', label: 'Record', render: (r) => <span className="mono small">{r.record_id || '—'}</span> },
    { key: 'remarks', label: 'Remarks', render: (r) => <span className="small">{r.remarks || '—'}</span> },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Audit logs</h1>
          <p>
            Append-only trail. Entries cannot be edited or deleted, and every emulated action records the real
            administrator alongside the emulated user.
          </p>
        </div>
        <div className="actions">
          <select className="select" style={{ minWidth: 170 }} value={module} onChange={(e) => setModule(e.target.value)}>
            {MODULES.map((m) => (
              <option key={m || 'all'} value={m}>
                {m || 'All modules'}
              </option>
            ))}
          </select>
        </div>
      </div>

      <DataTable columns={columns} rows={logs} exportName="audit-logs" searchKeys={['action', 'remarks', 'actor_name', 'record_id']} />
    </div>
  );
}
