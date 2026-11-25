import { useEffect, useState } from 'react';
import { get, post } from '../../api.js';
import { Badge, Card, DataTable, Field, Icon, Modal, Spinner, fmtDateTime } from '../../ui.jsx';

const ENDPOINTS = [
  ['GET', '/api/v1/stock', 'stock.read', 'Live item stock with minus / min-qty flags'],
  ['GET', '/api/v1/mrns', 'mrns.read', 'Material requests with status and routing'],
  ['POST', '/api/v1/mrns', 'mrns.write', 'Raise an MRN (site, priority, line items)'],
  ['GET', '/api/v1/dispatch', 'dispatch.read', 'Delivery challans with signed-DC state'],
  ['POST', '/api/v1/dispatch', 'dispatch.write', 'Create a store dispatch (atomic ledger posting)'],
  ['GET', '/api/v1/masters/items', 'masters.read', 'Items master'],
  ['PUT', '/api/v1/masters/items/:id', 'masters.write', 'Update an item (name, min qty, latest rate)'],
  ['GET', '/api/v1/masters/sites', 'masters.read', 'Sites master'],
  ['GET', '/api/v1/masters/vendors', 'masters.read', 'Vendors master'],
];

export default function ApiHub() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    get('/admin/api-keys')
      .then(setData)
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  if (!data) return error ? <div className="alert alert-red">{error}</div> : <Spinner label="Loading API keys…" />;

  const revoke = async (key) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await post(`/admin/api-keys/${key.id}/revoke`, {});
      setNotice(`${key.name} revoked. Tokens using it stop working immediately.`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { key: 'name', label: 'Key name', render: (r) => <strong>{r.name}</strong> },
    { key: 'token_prefix', label: 'Prefix', render: (r) => <code>{r.token_prefix}…</code>, csv: (r) => r.token_prefix },
    { key: 'scopes', label: 'Scopes', render: (r) => (r.scopes || []).map((s) => <Badge key={s} tone="blue">{s}</Badge>), csv: (r) => (r.scopes || []).join(' ') },
    { key: 'created_by_name', label: 'Created by' },
    { key: 'created_at', label: 'Created', render: (r) => fmtDateTime(r.created_at), csv: (r) => fmtDateTime(r.created_at) },
    { key: 'last_used_at', label: 'Last used', render: (r) => fmtDateTime(r.last_used_at), csv: (r) => fmtDateTime(r.last_used_at) },
    {
      key: 'state',
      label: 'State',
      render: (r) => (r.revoked_at ? <Badge tone="red">Revoked</Badge> : <Badge tone="green">Active</Badge>),
      csv: (r) => (r.revoked_at ? 'Revoked' : 'Active'),
    },
    {
      key: 'actions',
      label: '',
      sortable: false,
      render: (r) =>
        r.revoked_at ? <span className="faint">—</span> : (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => revoke(r)}>
            Revoke
          </button>
        ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>API integration hub</h1>
          <p>Scoped, revocable bearer tokens and documented internal REST endpoints</p>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} /> New API key
          </button>
        </div>
      </div>

      {error ? <div className="alert alert-red">{error}</div> : null}
      {notice ? <div className="alert alert-green">{notice}</div> : null}
      {newToken ? (
        <div className="alert alert-amber">
          <Icon name="lock" size={16} />
          <div>
            <strong>Copy this token now — it is shown once.</strong>
            <div className="secret-chip" style={{ marginTop: 6 }}>{newToken}</div>
            <button
              type="button"
              className="btn btn-sm"
              style={{ marginTop: 8 }}
              onClick={() => {
                navigator.clipboard?.writeText(newToken);
                setNotice('Token copied to the clipboard.');
              }}
            >
              Copy token
            </button>
          </div>
        </div>
      ) : null}

      <div className="stack">
        <Card title="API keys" subtitle="Only the hash is stored — the plaintext is shown once at creation">
          <DataTable columns={columns} rows={data.keys} exportName="api-keys" rowKey={(r) => r.id} />
        </Card>

        <Card title="Documented endpoints" subtitle="Bearer token required · every write is audit-logged">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Path</th>
                  <th>Scope</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {ENDPOINTS.map(([method, path, scope, description]) => (
                  <tr key={`${method}${path}`}>
                    <td><Badge tone={method === 'GET' ? 'blue' : 'amber'}>{method}</Badge></td>
                    <td><code>{path}</code></td>
                    <td><code>{scope}</code></td>
                    <td className="small">{description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="alert alert-blue" style={{ marginTop: 12 }}>
            <Icon name="alert" size={15} />
            <div>
              External ERP sync stays <strong>inactive</strong> in Phase 1 — the status and voucher-ref hooks exist but no
              outbound sync runs.
            </div>
          </div>
        </Card>
      </div>

      {creating ? (
        <CreateKeyModal
          scopes={data.scopes}
          onClose={() => setCreating(false)}
          onCreated={(token) => {
            setCreating(false);
            setNewToken(token);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateKeyModal({ scopes, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState(['stock.read']);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (scope) =>
    setSelected((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));

  return (
    <Modal
      title="Create API key"
      subtitle="Choose the narrowest set of scopes the integration needs"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const res = await post('/admin/api-keys', { name, scopes: selected });
                onCreated(res.token);
              } catch (err) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Create key
          </button>
        </>
      }
    >
      {error ? <div className="alert alert-red">{error}</div> : null}
      <Field label="Key name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ERP nightly stock pull" />
      </Field>
      <Field label="Scopes">
        <div className="scope-pills">
          {scopes.map((scope) => (
            <button
              type="button"
              key={scope}
              className={`scope-pill ${selected.includes(scope) ? 'on' : ''}`}
              onClick={() => toggle(scope)}
            >
              {scope}
            </button>
          ))}
        </div>
      </Field>
    </Modal>
  );
}
