import { useEffect, useMemo, useState } from 'react';
import { get } from '../../api.js';
import { Badge, DataTable, EmptyState, Icon, Spinner, qty } from '../../ui.jsx';

export default function SiteLedger() {
  const [data, setData] = useState(null);
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([get('/site-ledger'), get('/sites')])
      .then(([ledger, siteData]) => {
        setData(ledger);
        setSites(siteData.sites);
      })
      .catch((err) => setError(err.message));
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return siteId ? data.entries.filter((row) => row.site_id === siteId) : data.entries;
  }, [data, siteId]);

  if (error) return <div className="page"><div className="alert alert-red">{error}</div></div>;
  if (!data) return <Spinner label="Loading the site ledger…" />;

  const columns = [
    { key: 'site_project_id', label: 'Site', render: (r) => (
      <div>
        <div>{r.site_project_id}</div>
        <div className="small faint">{r.client_project_name}</div>
      </div>
    ) },
    {
      key: 'item_name',
      label: 'Item',
      render: (r) => (
        <div>
          <div>{r.item_name}</div>
          <div className="small faint mono">{r.item_code}</div>
        </div>
      ),
    },
    { key: 'category', label: 'Category', render: (r) => <Badge tone={r.category === 'High Side' ? 'navy' : 'blue'}>{r.category}</Badge> },
    { key: 'issued_qty', label: 'Issued', align: 'right', render: (r) => `${qty(r.issued_qty)} ${r.unit}` },
    { key: 'returned_qty', label: 'Returned', align: 'right', render: (r) => `${qty(r.returned_qty)} ${r.unit}` },
    {
      key: 'net_qty',
      label: 'Net at site',
      align: 'right',
      render: (r) => <strong>{qty(r.net_qty)} {r.unit}</strong>,
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Site material ledger</h1>
          <p>
            The derived site side of the two-ledger system: everything dispatched (store, split and direct-to-site)
            minus what has physically returned. Quantities only — never rates.
          </p>
        </div>
        <div className="actions">
          <select className="select" style={{ minWidth: 240 }} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">All sites</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.site_project_id}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi blue">
          <span className="label">Issued to sites</span>
          <span className="value">{qty(data.totals.issued)}</span>
          <span className="meta">Across every dispatch flow</span>
          <span className="kpi-icon"><Icon name="truck" size={16} /></span>
        </div>
        <div className="kpi">
          <span className="label">Returned</span>
          <span className="value">{qty(data.totals.returned)}</span>
          <span className="meta">Physically back in the store</span>
          <span className="kpi-icon"><Icon name="return" size={16} /></span>
        </div>
        <div className="kpi">
          <span className="label">Net at sites</span>
          <span className="value">{qty(data.totals.net)}</span>
          <span className="meta">Issued minus returned</span>
          <span className="kpi-icon"><Icon name="pin" size={16} /></span>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        exportName="site-material-ledger"
        initialSort={{ key: 'site_project_id', dir: 'asc' }}
        empty={
          <EmptyState
            icon="pin"
            title="Nothing at site yet"
            description="Dispatch a challan and the site ledger fills automatically."
          />
        }
      />
    </div>
  );
}
