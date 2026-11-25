import { useEffect, useState } from 'react';
import { get } from '../../api.js';
import { EmptyState, Icon, Spinner, StatusBadge, fmtDate } from '../../ui.jsx';

export default function Scan() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/mobile/packing')
      .then((d) => setRows(d.challans.filter((c) => !c.signed_dc_photo_url)))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!rows) return <Spinner label="Checking signed copies…" />;

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 17 }}>Scan &amp; upload signed DC</h2>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          Photograph the signed delivery challan so it lands in the site archive.
        </p>
      </div>

      <div className="alert alert-blue" style={{ marginBottom: 14 }}>
        <Icon name="camera" size={16} />
        <div>
          Camera capture and upload are switched on in <strong>Layer 2</strong>. Until then this screen shows what is
          still outstanding.
        </div>
      </div>

      <button type="button" className="btn btn-primary btn-block" disabled style={{ minHeight: 48 }}>
        <Icon name="camera" size={18} /> Capture signed DC
      </button>

      <h3 style={{ fontSize: 13, margin: '20px 0 10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Awaiting signed copy ({rows.length})
      </h3>

      {!rows.length ? (
        <EmptyState icon="check" title="All caught up" description="Every dispatched challan has a signed copy on file." />
      ) : null}

      {rows.map((c) => (
        <div className="mobile-card" key={c.id}>
          <div className="row">
            <div>
              <h3>{c.site_project_id}</h3>
              <div className="code">{c.challan_code}</div>
            </div>
            <span className="spacer" />
            <StatusBadge value={c.status} />
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            {c.client_project_name} · {fmtDate(c.challan_date)}
          </div>
          {c.sla_48h_breach_flag ? (
            <div className="alert alert-red" style={{ marginTop: 8 }}>
              <Icon name="alert" size={14} />
              <div>Beyond the 48-hour window — upload this one first.</div>
            </div>
          ) : null}
        </div>
      ))}
    </>
  );
}
