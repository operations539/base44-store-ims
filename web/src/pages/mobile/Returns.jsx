import { useEffect, useState } from 'react';
import { get } from '../../api.js';
import { Badge, EmptyState, Icon, Spinner, StatusBadge, fmtDate, fmtDateTime, qty } from '../../ui.jsx';

const STAGES = [
  ['return_raised_at', 'Raised'],
  ['pickup_assigned_at', 'Pickup assigned'],
  ['picked_up_at', 'Picked up'],
  ['store_received_at', 'Store received'],
  ['system_posted_at', 'Posted'],
];

export default function Returns() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/mobile/returns')
      .then((d) => setRows(d.returns))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!rows) return <Spinner label="Loading returns…" />;

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 17 }}>Material returns</h2>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          Five-stage tracking — nothing leaves or re-enters the ledger without a handover.
        </p>
      </div>

      {!rows.length ? (
        <EmptyState
          icon="return"
          title="No open returns"
          description="Returns raised from your sites will be tracked here stage by stage."
        />
      ) : null}

      {rows.map((r) => {
        const done = STAGES.filter(([key]) => r[key]).length;
        const current = STAGES[Math.min(done, STAGES.length - 1)];
        return (
          <div className="mobile-card" key={r.id}>
            <div className="row">
              <div>
                <h3>{r.site_project_id || 'Vendor return'}</h3>
                <div className="code">{r.challan_code}</div>
              </div>
              <span className="spacer" />
              <StatusBadge value={r.status} />
            </div>

            <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
              <Badge tone="neutral">{r.flow_type}</Badge>
              {r.short_missing_flagged ? <Badge tone="red">Short / missing</Badge> : null}
              {r.signed_return_dc_photo_url ? <Badge tone="green">Signed DC in</Badge> : null}
            </div>

            <div className="stage-track" aria-label={`Stage ${done} of 5`}>
              {STAGES.map(([key]) => (
                <span key={key} className={`stage ${r[key] ? 'done' : ''}`} />
              ))}
            </div>

            <div className="small muted" style={{ marginTop: 8 }}>
              Stage {done}/5 · {current[1]}
              {r.picked_up_at ? ` · picked up ${fmtDateTime(r.picked_up_at)}` : ''}
            </div>

            <div className="small muted" style={{ marginTop: 2 }}>
              {qty(r.total_qty)} across {r.line_count} line{r.line_count === 1 ? '' : 's'} ·{' '}
              {fmtDate(r.challan_date)}
              {r.driver_delivery_person_name ? ` · ${r.driver_delivery_person_name}` : ''}
            </div>

            {r.sla_48h_breach_flag ? (
              <div className="alert alert-red" style={{ marginTop: 8 }}>
                <Icon name="alert" size={14} />
                <div>Past the 48-hour closure window.</div>
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
