import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Badge, EmptyState, Icon, Spinner, StatusBadge, fmtDate, fmtDateTime, qty } from '../../ui.jsx';

const STAGES = [
  ['return_raised_at', 'Raised'],
  ['pickup_assigned_at', 'Pickup assigned'],
  ['picked_up_at', 'Picked up'],
  ['store_received_at', 'Store received'],
  ['system_posted_at', 'Posted'],
];

async function uploadImage(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const { url } = await post('/files', { data_url: dataUrl });
  return url;
}

export default function Returns() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    get('/mobile/returns')
      .then((d) => setRows(d.returns))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  const act = async (row, fn, message) => {
    setBusy(row.id);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(message);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  if (error && !rows) return <div className="alert alert-red">{error}</div>;
  if (!rows) return <Spinner label="Loading returns…" />;

  const isSupervisor = user.role === 'supervisor';
  const isHelper = user.role === 'store_helper';

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 17 }}>Material returns</h2>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          Five-stage tracking — nothing leaves or re-enters the ledger without a handover.
        </p>
      </div>

      {isSupervisor ? (
        <Link className="btn btn-primary btn-block" to="/m/returns/new" style={{ marginBottom: 14 }}>
          <Icon name="plus" size={17} /> Raise a return
        </Link>
      ) : null}

      {error ? <div className="alert alert-red">{error}</div> : null}
      {notice ? <div className="alert alert-green">{notice}</div> : null}

      {!rows.length ? (
        <EmptyState
          icon="return"
          title="No open returns"
          description={isHelper ? 'Returns in transit to the store appear here.' : 'Returns raised from your sites will be tracked here stage by stage.'}
        />
      ) : null}

      {rows.map((r) => {
        const done = STAGES.filter(([key]) => r[key]).length;
        const current = STAGES[Math.min(done, STAGES.length - 1)];
        return (
          <div className="mobile-card" key={r.id}>
            <div className="row">
              <div style={{ minWidth: 0 }}>
                <h3>{r.site_project_id || r.vendor_name || 'Vendor return'}</h3>
                <div className="code">{r.challan_code}</div>
              </div>
              <span className="spacer" />
              <StatusBadge value={r.status} />
            </div>

            <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
              <Badge tone="neutral">{r.flow_type}</Badge>
              {r.short_missing_flagged ? <Badge tone="red">Short / missing</Badge> : null}
              {r.signed_return_dc_photo_url ? <Badge tone="green">Signed DC in</Badge> : null}
              {r.sla_48h_breach_flag && r.status !== 'Closed' ? <Badge tone="red">48h SLA</Badge> : null}
            </div>

            <div className="stage-track" aria-label={`Stage ${done} of 5`}>
              {STAGES.map(([key]) => (
                <span key={key} className={`stage ${r[key] ? 'done' : ''}`} />
              ))}
            </div>

            <div className="small muted" style={{ marginTop: 8 }}>
              Stage {done}/5 · {current[1]}
              {r.pickup_assigned_at ? ` · pickup ${fmtDateTime(r.pickup_assigned_at)}` : ''}
            </div>

            <div className="small muted" style={{ marginTop: 2 }}>
              {qty(r.sent_qty)} across {r.line_count} line{r.line_count === 1 ? '' : 's'} · {fmtDate(r.challan_date)}
            </div>

            {r.transport_mode ? (
              <div className="small" style={{ marginTop: 6 }}>
                <strong>{r.transport_mode}</strong>
                {r.driver_delivery_person_name ? ` · ${r.driver_delivery_person_name}` : ''}
                {r.vehicle_no ? ` · ${r.vehicle_no}` : ''}
                {r.driver_phone ? (
                  <div>
                    <a href={`tel:${r.driver_phone}`}>{r.driver_phone}</a>
                  </div>
                ) : null}
              </div>
            ) : null}

            {r.return_reason ? <div className="small faint" style={{ marginTop: 6 }}>Reason: {r.return_reason}</div> : null}

            {isSupervisor && r.status === 'Pickup Assigned' ? (
              <button
                type="button"
                className="btn btn-primary btn-block"
                style={{ marginTop: 10 }}
                disabled={busy === r.id}
                onClick={() => act(r, () => post(`/mobile/returns/${r.id}/handover`, {}), `${r.challan_code}: handed over to the driver.`)}
              >
                <Icon name="check" size={16} /> Handed over to driver
              </button>
            ) : null}

            {isHelper && r.status === 'Picked Up' ? (
              <div className="mobile-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy === r.id}
                  onClick={() => act(r, () => post(`/mobile/returns/${r.id}/receive`, {}), `${r.challan_code}: received at store.`)}
                >
                  <Icon name="box" size={16} /> Received at store
                </button>
                <label className="btn" style={{ cursor: 'pointer' }}>
                  <Icon name="camera" size={16} /> Photo &amp; receive
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      await act(
                        r,
                        async () => {
                          const photo_url = await uploadImage(file);
                          await post(`/mobile/returns/${r.id}/receive`, { photo_url });
                        },
                        `${r.challan_code}: received with arrival photo.`
                      );
                    }}
                  />
                </label>
              </div>
            ) : null}

            {r.sla_48h_breach_flag && r.status !== 'Closed' ? (
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
