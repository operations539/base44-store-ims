import { useEffect, useState } from 'react';
import { get } from '../../api.js';
import { Badge, Card, DataTable, EmptyState, Icon, Spinner, StatusBadge, fmtDate, fmtDateTime, qty } from '../../ui.jsx';
import { printTable } from '../../export.js';
import Tip from '../../components/Tip.jsx';

const COLUMNS = [
  { key: 'challan_code', label: 'Challan', render: (r) => <strong>{r.challan_code}</strong> },
  { key: 'challan_date', label: 'Date', render: (r) => fmtDate(r.challan_date), csv: (r) => fmtDate(r.challan_date) },
  { key: 'site_project_id', label: 'Site' },
  { key: 'flow_type', label: 'Flow' },
  { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} />, csv: (r) => r.status },
  { key: 'total_qty', label: 'Qty', align: 'right', render: (r) => qty(r.total_qty), csv: (r) => r.total_qty },
  {
    key: 'signed',
    label: 'Signed DC',
    render: (r) => (r.signed ? <Badge tone="green">Delivered-Signed</Badge> : r.missing_48h ? <Badge tone="red">Missing &gt;48h</Badge> : <Badge tone="amber">Pending</Badge>),
    csv: (r) => (r.signed ? 'Delivered-Signed' : r.missing_48h ? 'Missing >48h' : 'Pending'),
  },
  { key: 'hours_open', label: 'Hours open', align: 'right' },
  { key: 'signed_dc_uploaded_at', label: 'Signed at', render: (r) => fmtDateTime(r.signed_dc_uploaded_at), csv: (r) => fmtDateTime(r.signed_dc_uploaded_at) },
];

export default function ChallanArchive() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/dashboards/challans')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!data) return <Spinner label="Loading challan status…" />;

  const { rows, gallery, totals } = data;

  return (
    <div className="stack">
      <Card
        title={
          <>
            Live challan status
            <Tip text="A challan is Delivered-Signed once the helper photographs the signed copy. Anything unsigned after 48 hours raises a red alert." />
          </>
        }
        subtitle="Issued vs. Delivered-Signed, with 48-hour missing-scan alerts"
        actions={
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              printTable({
                title: 'Live Challan Status',
                subtitle: `${totals.signed} signed · ${totals.issued} pending · ${totals.missing_48h} past 48h`,
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
          <div className="stat-chip"><span className="lbl">Delivered-Signed</span><span className="val">{totals.signed}</span></div>
          <div className="stat-chip amber"><span className="lbl">Awaiting scan</span><span className="val">{totals.issued}</span></div>
          <div className="stat-chip red"><span className="lbl">Missing &gt;48h</span><span className="val">{totals.missing_48h}</span></div>
        </div>
        <DataTable columns={COLUMNS} rows={rows} exportName="challan-status" rowKey={(r) => r.id} />
      </Card>

      <Card title="Site-wise signed DC archive" subtitle="Photos uploaded by the store helper, with share links">
        {!gallery.length ? (
          <EmptyState icon="camera" title="No signed copies yet" description="Uploaded signed challans are grouped by site here." />
        ) : (
          gallery.map((site) => (
            <div className="gallery-site" key={site.site_project_id || 'unassigned'}>
              <h4>
                {site.site_project_id || 'Unassigned'} <span className="faint">· {site.client_project_name}</span>
              </h4>
              <div className="gallery-grid">
                {site.documents.map((doc) => (
                  <div className="gallery-item" key={doc.id}>
                    <a href={doc.signed_dc_photo_url} target="_blank" rel="noreferrer">
                      <img src={doc.signed_dc_photo_url} alt={`Signed DC ${doc.challan_code}`} loading="lazy" />
                    </a>
                    <div className="meta">
                      <strong>{doc.challan_code}</strong>
                      <div className="faint">{fmtDate(doc.challan_date)}</div>
                      <div className="share-row">
                        <input readOnly value={`${window.location.origin}/dc/${doc.site_share_link}`} aria-label="Share link" />
                        <button
                          type="button"
                          className="icon-btn"
                          title="Copy share link"
                          onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/dc/${doc.site_share_link}`)}
                        >
                          <Icon name="file" size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
