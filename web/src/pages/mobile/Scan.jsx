import { useCallback, useEffect, useState } from 'react';
import { get, post } from '../../api.js';
import { Badge, EmptyState, Icon, Spinner, StatusBadge, fmtDate, fmtDateTime } from '../../ui.jsx';

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

export default function Scan() {
  const [rows, setRows] = useState(null);
  const [gallery, setGallery] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    get('/mobile/packing')
      .then((d) => setRows(d.challans.filter((c) => !c.signed_dc_photo_url)))
      .catch((err) => setError(err.message));
    get('/mobile/dc-gallery')
      .then((d) => setGallery(d.sites))
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  const capture = async (challan, file) => {
    if (!file) return;
    setBusyId(challan.id);
    setError('');
    setNotice('');
    try {
      const url = await uploadImage(file);
      await post(`/mobile/signed-dc/${challan.id}`, { photo_url: url });
      setNotice(`${challan.challan_code}: signed copy archived.`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  if (error && !rows) return <div className="alert alert-red">{error}</div>;
  if (!rows) return <Spinner label="Checking signed copies…" />;

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 17 }}>Scan &amp; upload signed DC</h2>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          Photograph the signed delivery challan — it clears the 48-hour alert and lands in the site archive.
        </p>
      </div>

      {error ? <div className="alert alert-red">{error}</div> : null}
      {notice ? <div className="alert alert-green">{notice}</div> : null}

      <h3 style={{ fontSize: 12, margin: '4px 0 10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Awaiting signed copy ({rows.length})
      </h3>

      {!rows.length ? (
        <EmptyState icon="check" title="All caught up" description="Every dispatched challan has a signed copy on file." />
      ) : null}

      {rows.map((c) => (
        <div className="mobile-card" key={c.id}>
          <div className="row">
            <div style={{ minWidth: 0 }}>
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

          <label className="btn btn-primary btn-block" style={{ marginTop: 10, cursor: 'pointer' }}>
            <Icon name="camera" size={17} />
            {busyId === c.id ? 'Uploading…' : 'Capture signed DC'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              disabled={busyId === c.id}
              onChange={(e) => capture(c, e.target.files?.[0])}
            />
          </label>
        </div>
      ))}

      <h3 style={{ fontSize: 12, margin: '22px 0 10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Site-wise signed DC gallery
      </h3>

      {!gallery.length ? (
        <EmptyState icon="camera" title="No signed copies yet" description="Uploaded challans are grouped by site here." />
      ) : null}

      {gallery.map((site) => (
        <div className="mobile-card" key={site.site_project_id || 'unassigned'}>
          <h3>{site.site_project_id || 'Unassigned'}</h3>
          <div className="small muted" style={{ marginBottom: 8 }}>{site.client_project_name}</div>
          <div className="gallery-grid">
            {site.documents.map((doc) => (
              <div className="gallery-item" key={doc.id}>
                <a href={doc.signed_dc_photo_url} target="_blank" rel="noreferrer">
                  <img src={doc.signed_dc_photo_url} alt={`Signed DC ${doc.challan_code}`} loading="lazy" />
                </a>
                <div className="meta">
                  <strong>{doc.challan_code}</strong>
                  <div className="faint">{fmtDateTime(doc.signed_dc_uploaded_at)}</div>
                  <button
                    type="button"
                    className="btn btn-sm btn-block"
                    style={{ marginTop: 6 }}
                    onClick={() => {
                      navigator.clipboard?.writeText(`${window.location.origin}/dc/${doc.site_share_link}`);
                      setNotice('Share link copied.');
                    }}
                  >
                    Copy share link
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="alert alert-blue" style={{ marginTop: 6 }}>
        <Icon name="lock" size={15} />
        <div>Share links are role-controlled and only open signed DC photos.</div>
      </div>
    </>
  );
}
