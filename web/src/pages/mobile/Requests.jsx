import { useEffect, useState } from 'react';
import { get } from '../../api.js';
import MrnForm from '../../components/MrnForm.jsx';
import { Badge, EmptyState, Icon, Modal, Spinner, StatusBadge, fmtDate, qty } from '../../ui.jsx';

export default function Requests() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = () =>
    get('/mobile/requests')
      .then((d) => setRows(d.requests))
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!rows) return <Spinner label="Loading your requests…" />;

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 17 }}>Material requests</h2>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          Scoped to the sites assigned to you. No pricing is ever shown.
        </p>
        <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 10 }} onClick={() => setFormOpen(true)}>
          <Icon name="plus" size={15} /> Raise MRN
        </button>
      </div>

      {!rows.length ? (
        <EmptyState
          icon="list"
          title="No requests yet"
          description="Raise a material request and it will appear here with its live status."
        />
      ) : null}

      {rows.map((m) => {
        const lines = Array.isArray(m.line_items) ? m.line_items : [];
        const expanded = open === m.id;
        return (
          <div className="mobile-card" key={m.id}>
            <div className="row">
              <div>
                <h3>{m.site_project_id}</h3>
                <div className="code">{m.mrn_no}</div>
              </div>
              <span className="spacer" />
              <StatusBadge value={m.stage || m.status} />
            </div>

            <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
              {m.priority !== 'Normal' ? <Badge tone="red">{m.priority}</Badge> : null}
              {m.routing_type ? <Badge tone="blue">{m.routing_type}</Badge> : null}
              <span className="small muted">
                Raised {fmtDate(m.mrn_date)}
                {m.required_date ? ` · needed ${fmtDate(m.required_date)}` : ''}
              </span>
            </div>

            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              <span className="small muted">
                Dispatched {qty(m.dispatched_qty || 0)} of {qty(m.approved_qty || m.requested_qty || 0)}
              </span>
            </div>

            <button
              type="button"
              className="btn btn-sm btn-block"
              style={{ marginTop: 10 }}
              onClick={() => setOpen(expanded ? null : m.id)}
            >
              <Icon name={expanded ? 'chevron' : 'list'} size={14} />
              {expanded ? 'Hide items' : `${lines.length} item${lines.length === 1 ? '' : 's'}`}
            </button>

            {expanded ? (
              <div className="mobile-lines">
                {lines.map((l, i) => (
                  <div className="mobile-line" key={`${m.id}-${i}`}>
                    <span>
                      {l.item_name}
                      <span className="faint"> · {l.item_code}</span>
                    </span>
                    <span className="qty">
                      {qty(l.qty)} {l.unit}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      {formOpen ? (
        <Modal
          title="Raise a material request"
          subtitle="Only your assigned sites are listed."
          onClose={() => setFormOpen(false)}
        >
          <MrnForm
            onDone={() => {
              setFormOpen(false);
              load();
            }}
            onCancel={() => setFormOpen(false)}
          />
        </Modal>
      ) : null}
    </>
  );
}
