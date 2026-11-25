import { useEffect, useState } from 'react';
import { get, patch, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { DataTable, ErrorNote, Field, Icon, Modal, Spinner, StatusBadge } from '../ui.jsx';

const BLANK = {
  site_project_id: '',
  client_project_name: '',
  full_site_address: '',
  assigned_supervisor_id: '',
  status: 'Active',
};

export default function Sites() {
  const { has, user } = useAuth();
  const canWrite = has('masters.write');
  const [sites, setSites] = useState(null);
  const [supervisors, setSupervisors] = useState([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [fields, setFields] = useState({});
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    get('/sites')
      .then((d) => setSites(d.sites))
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
    if (canWrite) {
      get('/admin/users')
        .then((d) => setSupervisors(d.users.filter((u) => u.role === 'supervisor')))
        .catch(() => {});
    }
  }, [canWrite]);

  const openNew = () => {
    setEditing('new');
    setForm(BLANK);
    setFields({});
    setSaveError('');
  };

  const openEdit = (site) => {
    setEditing(site.id);
    setForm({
      site_project_id: site.site_project_id,
      client_project_name: site.client_project_name,
      full_site_address: site.full_site_address || '',
      assigned_supervisor_id: site.assigned_supervisor_id || '',
      status: site.status,
    });
    setFields({});
    setSaveError('');
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setSaveError('');
    setFields({});
    try {
      const payload = { ...form, assigned_supervisor_id: form.assigned_supervisor_id || null };
      if (editing === 'new') await post('/sites', payload);
      else await patch(`/sites/${editing}`, payload);
      setEditing(null);
      await load();
    } catch (err) {
      setSaveError(err.message);
      setFields(err.fields || {});
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="page"><div className="alert alert-red">{error}</div></div>;
  if (!sites) return <Spinner label="Loading sites…" />;

  const columns = [
    { key: 'site_project_id', label: 'Site / Project ID', render: (r) => <span className="mono">{r.site_project_id}</span> },
    { key: 'client_project_name', label: 'Client project' },
    { key: 'full_site_address', label: 'Address', render: (r) => <span className="small">{r.full_site_address || '—'}</span> },
    {
      key: 'supervisor_name',
      label: 'Supervisor',
      render: (r) =>
        r.supervisor_name ? (
          <div>
            <div>{r.supervisor_name}</div>
            <div className="small muted">{r.supervisor_phone || ''}</div>
          </div>
        ) : (
          <span className="badge badge-amber">Unassigned</span>
        ),
    },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
    ...(canWrite
      ? [
          {
            key: 'actions',
            label: '',
            sortable: false,
            searchable: false,
            render: (r) => (
              <button type="button" className="btn btn-sm" onClick={() => openEdit(r)}>
                <Icon name="edit" size={13} /> Edit
              </button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Sites master</h1>
          <p>
            {user.role === 'supervisor'
              ? 'You only see the sites assigned to you. Requests you raise are scoped to these projects.'
              : 'Universal site / project ID, client project name, full address and the assigned site supervisor.'}
          </p>
        </div>
        <div className="actions">
          {canWrite ? (
            <button type="button" className="btn btn-primary" onClick={openNew}>
              <Icon name="plus" size={15} /> New site
            </button>
          ) : (
            <span className="chip">
              <Icon name="eye" size={14} /> Read only
            </span>
          )}
        </div>
      </div>

      <DataTable columns={columns} rows={sites} exportName="sites-master" initialSort={{ key: 'site_project_id', dir: 'asc' }} />

      {editing ? (
        <Modal
          title={editing === 'new' ? 'New site' : 'Edit site'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" form="site-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save site'}
              </button>
            </>
          }
        >
          <form id="site-form" onSubmit={save}>
            <ErrorNote message={saveError} />
            <div className="form-grid">
              <Field label="Site / Project ID" error={fields.site_project_id}>
                <input
                  className={`input ${fields.site_project_id ? 'has-error' : ''}`}
                  value={form.site_project_id}
                  onChange={(e) => setForm({ ...form, site_project_id: e.target.value })}
                  placeholder="SP-005"
                  required
                />
              </Field>
              <Field label="Status">
                <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option>Active</option>
                  <option>Closed</option>
                </select>
              </Field>
              <Field label="Client project name" className="full" error={fields.client_project_name}>
                <input
                  className={`input ${fields.client_project_name ? 'has-error' : ''}`}
                  value={form.client_project_name}
                  onChange={(e) => setForm({ ...form, client_project_name: e.target.value })}
                  required
                />
              </Field>
              <Field label="Full site address" className="full">
                <textarea
                  className="textarea"
                  value={form.full_site_address}
                  onChange={(e) => setForm({ ...form, full_site_address: e.target.value })}
                />
              </Field>
              <Field label="Assigned supervisor" className="full" error={fields.assigned_supervisor_id}>
                <select
                  className="select"
                  value={form.assigned_supervisor_id}
                  onChange={(e) => setForm({ ...form, assigned_supervisor_id: e.target.value })}
                >
                  <option value="">Unassigned</option>
                  {supervisors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name} · {s.employee_id || s.email}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
