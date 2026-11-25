import { useEffect, useState } from 'react';
import { get } from '../../api.js';
import { Badge, EmptyState, Spinner, StatusBadge, fmtDate, qty } from '../../ui.jsx';

const STEPS = ['Pending', 'Approved', 'Partial', 'Dispatched', 'Delivered', 'Returned'];

function stageIndex(stage) {
  const idx = STEPS.indexOf(stage);
  if (idx >= 0) return idx;
  return stage === 'Rejected' ? 0 : 0;
}

export default function Tracking() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/mobile/tracking')
      .then((d) => setRows(d.tracking))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!rows) return <Spinner label="Loading tracking…" />;

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 17 }}>Live tracking</h2>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          Pending → Approved → Partial → Dispatched → Delivered → Returned.
        </p>
      </div>

      {!rows.length ? (
        <EmptyState
          icon="truck"
          title="Nothing in the pipeline"
          description="Requests raised for your sites will show their progress here."
        />
      ) : null}

      {rows.map((m) => {
        const idx = stageIndex(m.stage || m.status);
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

            <div className="stage-track">
              {STEPS.map((s, i) => (
                <span key={s} className={`stage ${i <= idx ? 'done' : ''}`} />
              ))}
            </div>

            <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
              <span className="small muted">
                {m.stage || m.status} · raised {fmtDate(m.mrn_date)}
              </span>
              <span className="spacer" />
              <Badge tone={m.dispatched_qty > 0 ? 'blue' : 'neutral'}>
                {qty(m.dispatched_qty || 0)} / {qty(m.approved_qty || m.requested_qty || 0)} dispatched
              </Badge>
            </div>

            <div className="row" style={{ marginTop: 6, gap: 6 }}>
              {m.challan_count > 0 ? (
                <Badge tone={m.signed_count === m.challan_count ? 'green' : 'amber'}>
                  {m.signed_count}/{m.challan_count} signed
                </Badge>
              ) : (
                <Badge tone="neutral">No challan yet</Badge>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
