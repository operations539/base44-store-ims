import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, patch, post } from '../../api.js';
import { useAuth, homeFor } from '../../auth.jsx';
import {
  Badge,
  DataTable,
  ErrorNote,
  Field,
  Icon,
  Modal,
  Spinner,
  fmtDateTime,
} from '../../ui.jsx';

const ROLES = [
  ['admin', 'MIS & System Builder'],
  ['owner', 'Owners & VP'],
  ['store_manager', 'Store Manager'],
  ['store_exec', 'Store Executive'],
  ['store_helper', 'Store Helper'],
  ['supervisor', 'Site Supervisor'],
];

const DEPARTMENTS = ['MIS', 'SLS', 'DSN', 'PRJ', 'STR', 'SRV', 'ACC', 'HR'];

const BLANK = {
  full_name: '',
  email: '',
  username: '',
  role: 'store_exec',
  employee_id: '',
  department_code: 'STR',
  phone: '',
  password: '',
};

export default function Users() {
  const { user: me, emulate } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // 'new' | user object
  const [form, setForm] = useState(BLANK);
  const [fields, setFields] = useState({});
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);
  const [emulating, setEmulating] = useState(null);

  const load = () =>
    get('/admin/users')
      .then((d) => setUsers(d.users))
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setModal('new');
    setForm(BLANK);
    setFields({});
    setSaveError('');
  };

  const openEdit = (u) => {
    setModal(u);
    setForm({
      full_name: u.full_name,
      email: u.email,
      username: u.username || '',
      role: u.role,
      employee_id: u.employee_id || '',
      department_code: u.department_code || '',
      phone: u.phone || '',
      password: '',
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
      if (modal === 'new') {
        await post('/admin/users', form);
      } else {
        const payload = { ...form };
        if (!payload.password) delete payload.password;
        await patch(`/admin/users/${modal.id}`, payload);
      }
      setModal(null);
      await load();
    } catch (err) {
      setSaveError(err.message);
      setFields(err.fields || {});
    } finally {
      setBusy(false);
    }
  };

  const startEmulation = async (u) => {
    setEmulating(u.id);
    try {
      const data = await emulate(u.id);
      navigate(homeFor(data?.user?.role || u.role));
    } catch (err) {
      setError(err.message);
    } finally {
      setEmulating(null);
    }
  };

  if (error && !users) return <div className="page"><div className="alert alert-red">{error}</div></div>;
  if (!users) return <Spinner label="Loading users…" />;

  const columns = [
    {
      key: 'full_name',
      label: 'User',
      render: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.full_name}</div>
          <div className="small muted">{r.email}</div>
        </div>
      ),
    },
    { key: 'role', label: 'Role', render: (r) => <Badge tone={r.role === 'admin' ? 'navy' : 'neutral'}>{r.roleLabel || ROLES.find((x) => x[0] === r.role)?.[1]}</Badge> },
    { key: 'employee_id', label: 'Employee ID', render: (r) => <span className="mono small">{r.employee_id || '—'}</span> },
    { key: 'department_code', label: 'Dept' },
    {
      key: 'is_active',
      label: 'Status',
      render: (r) => (r.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Disabled</Badge>),
    },
    {
      key: 'last_login_at',
      label: 'Last login',
      render: (r) => <span className="small nowrap">{r.last_login_at ? fmtDateTime(r.last_login_at) : 'Never'}</span>,
    },
    {
      key: 'demo',
      label: 'Source',
      sortable: false,
      render: (r) => (r.is_demo ? <Badge tone="amber">Demo</Badge> : <Badge tone="neutral">Live</Badge>),
    },
    {
      key: 'actions',
      label: '',
      sortable: false,
      searchable: false,
      render: (r) => (
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn-sm" onClick={() => openEdit(r)}>
            <Icon name="edit" size={13} /> Edit
          </button>
          {r.role !== 'admin' && r.is_active ? (
            <button
              type="button"
              className="btn btn-sm"
              disabled={emulating === r.id}
              onClick={() => startEmulation(r)}
              title="View the app exactly as this user sees it"
            >
              <Icon name="eye" size={13} /> {emulating === r.id ? '…' : 'Login as'}
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Users &amp; roles</h1>
          <p>
            Admin-invited accounts only. Every profile carries an Employee ID and Department Code for the future HR
            sync. “Login as” opens a read/write emulation with a persistent banner.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={openNew}>
            <Icon name="plus" size={15} /> Invite user
          </button>
        </div>
      </div>

      {error ? <div className="alert alert-red" style={{ marginBottom: 14 }}>{error}</div> : null}

      <DataTable columns={columns} rows={users} exportName="users" initialSort={{ key: 'full_name', dir: 'asc' }} />

      {modal ? (
        <Modal
          title={modal === 'new' ? 'Invite user' : `Edit ${modal.full_name}`}
          subtitle={modal === 'new' ? 'Public sign-up is disabled — this creates the account directly.' : 'Role changes take effect on the next request.'}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button type="submit" form="user-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : modal === 'new' ? 'Create user' : 'Save changes'}
              </button>
            </>
          }
        >
          <form id="user-form" onSubmit={save}>
            <ErrorNote message={saveError} />
            <div className="form-grid">
              <Field label="Full name" className="full" error={fields.full_name}>
                <input
                  className={`input ${fields.full_name ? 'has-error' : ''}`}
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  required
                />
              </Field>
              <Field label="Email" error={fields.email}>
                <input
                  className={`input ${fields.email ? 'has-error' : ''}`}
                  type="email"
                  value={form.email}
                  disabled={modal !== 'new'}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </Field>
              <Field label="Username (optional)" hint="Lets the user sign in without the email.">
                <input
                  className="input"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </Field>
              <Field label="Role" error={fields.role}>
                <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {ROLES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Department code" error={fields.department_code}>
                <select
                  className="select"
                  value={form.department_code}
                  onChange={(e) => setForm({ ...form, department_code: e.target.value })}
                >
                  <option value="">—</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Employee ID" error={fields.employee_id}>
                <input
                  className="input mono"
                  value={form.employee_id}
                  placeholder="EMP-2005"
                  onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                />
              </Field>
              <Field label="Phone / WhatsApp" error={fields.phone}>
                <input
                  className={`input ${fields.phone ? 'has-error' : ''}`}
                  value={form.phone}
                  placeholder="9876543210"
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
              <Field
                label={modal === 'new' ? 'Temporary password' : 'Reset password'}
                className="full"
                error={fields.password}
                hint={modal === 'new' ? 'Minimum 8 characters. Share it with the user securely.' : 'Leave blank to keep the current password.'}
              >
                <input
                  className={`input ${fields.password ? 'has-error' : ''}`}
                  type="text"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required={modal === 'new'}
                />
              </Field>
              {modal !== 'new' ? (
                <Field label="Account status" className="full">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={modal.is_active}
                      onChange={(e) => setModal({ ...modal, is_active: e.target.checked })}
                      disabled={modal.id === me.id}
                    />
                    Account is active (unchecking signs the user out immediately)
                  </label>
                </Field>
              ) : null}
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
