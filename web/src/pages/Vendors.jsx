import { useEffect, useState } from 'react';
import { get, patch, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { DataTable, ErrorNote, Field, Icon, Modal, Spinner, StatusBadge } from '../ui.jsx';

const blankContact = () => ({ name: '', designation: '', phone: '', email: '' });

const BLANK = {
  vendor_id: '',
  vendor_name: '',
  full_address: '',
  gstin: '',
  status: 'Active',
  contact_persons: [blankContact()],
};

export default function Vendors() {
  const { has } = useAuth();
  const canWrite = has('masters.write');
  const [vendors, setVendors] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [fields, setFields] = useState({});
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    get('/vendors')
      .then((d) => setVendors(d.vendors))
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditing('new');
    setForm(BLANK);
    setFields({});
    setSaveError('');
  };

  const openEdit = (v) => {
    setEditing(v.id);
    setForm({
      vendor_id: v.vendor_id,
      vendor_name: v.vendor_name,
      full_address: v.full_address || '',
      gstin: v.gstin || '',
      status: v.status,
      contact_persons: v.contact_persons?.length ? v.contact_persons : [blankContact()],
    });
    setFields({});
    setSaveError('');
  };

  const setContact = (index, patchValue) => {
    const next = form.contact_persons.map((c, i) => (i === index ? { ...c, ...patchValue } : c));
    setForm({ ...form, contact_persons: next });
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setSaveError('');
    setFields({});
    try {
      const payload = {
        ...form,
        contact_persons: form.contact_persons.filter((c) => c.name || c.phone || c.email),
      };
      if (editing === 'new') await post('/vendors', payload);
      else await patch(`/vendors/${editing}`, payload);
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
  if (!vendors) return <Spinner label="Loading vendors…" />;

  const columns = [
    { key: 'vendor_id', label: 'Vendor ID', render: (r) => <span className="mono">{r.vendor_id}</span> },
    { key: 'vendor_name', label: 'Vendor' },
    { key: 'gstin', label: 'GSTIN', render: (r) => <span className="mono small">{r.gstin || '—'}</span> },
    {
      key: 'contact_persons',
      label: 'Contact',
      sortable: false,
      render: (r) => {
        const c = r.contact_persons?.[0];
        if (!c) return <span className="faint">—</span>;
        return (
          <div>
            <div>{c.name || '—'}</div>
            <div className="small muted">
              {[c.designation, c.phone].filter(Boolean).join(' · ')}
            </div>
          </div>
        );
      },
    },
    { key: 'full_address', label: 'Address', render: (r) => <span className="small">{r.full_address || '—'}</span> },
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
          <h1>Vendors master</h1>
          <p>Universal vendor ID, GSTIN validation, full address and WhatsApp-ready contact persons.</p>
        </div>
        <div className="actions">
          {canWrite ? (
            <button type="button" className="btn btn-primary" onClick={openNew}>
              <Icon name="plus" size={15} /> New vendor
            </button>
          ) : (
            <span className="chip">
              <Icon name="eye" size={14} /> Read only
            </span>
          )}
        </div>
      </div>

      <DataTable columns={columns} rows={vendors} exportName="vendors-master" initialSort={{ key: 'vendor_name', dir: 'asc' }} />

      {editing ? (
        <Modal
          title={editing === 'new' ? 'New vendor' : 'Edit vendor'}
          onClose={() => setEditing(null)}
          wide
          footer={
            <>
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" form="vendor-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save vendor'}
              </button>
            </>
          }
        >
          <form id="vendor-form" onSubmit={save}>
            <ErrorNote message={saveError} />
            <div className="form-grid">
              <Field label="Vendor ID" error={fields.vendor_id}>
                <input
                  className={`input ${fields.vendor_id ? 'has-error' : ''}`}
                  value={form.vendor_id}
                  onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}
                  placeholder="V-006"
                  required
                />
              </Field>
              <Field label="Status">
                <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option>Active</option>
                  <option>Inactive</option>
                </select>
              </Field>
              <Field label="Vendor name" className="full" error={fields.vendor_name}>
                <input
                  className={`input ${fields.vendor_name ? 'has-error' : ''}`}
                  value={form.vendor_name}
                  onChange={(e) => setForm({ ...form, vendor_name: e.target.value })}
                  required
                />
              </Field>
              <Field label="GSTIN" className="full" error={fields.gstin} hint="15 characters, e.g. 27AABCC1234D1Z5">
                <input
                  className={`input mono ${fields.gstin ? 'has-error' : ''}`}
                  value={form.gstin}
                  maxLength={15}
                  onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label="Full address" className="full">
                <textarea
                  className="textarea"
                  value={form.full_address}
                  onChange={(e) => setForm({ ...form, full_address: e.target.value })}
                />
              </Field>
            </div>

            <div className="divider" />
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ fontSize: 13 }}>Contact persons</strong>
              <button
                type="button"
                className="btn btn-sm"
                style={{ marginLeft: 'auto' }}
                onClick={() => setForm({ ...form, contact_persons: [...form.contact_persons, blankContact()] })}
              >
                <Icon name="plus" size={13} /> Add contact
              </button>
            </div>

            {form.contact_persons.map((c, i) => (
              <div key={i} className="form-grid" style={{ marginBottom: 8 }}>
                <Field label="Name">
                  <input className="input" value={c.name} onChange={(e) => setContact(i, { name: e.target.value })} />
                </Field>
                <Field label="Designation">
                  <input
                    className="input"
                    value={c.designation}
                    onChange={(e) => setContact(i, { designation: e.target.value })}
                  />
                </Field>
                <Field label="Phone / WhatsApp" error={fields[`contact_${i}_phone`]}>
                  <input
                    className="input"
                    value={c.phone}
                    placeholder="9876543210"
                    onChange={(e) => setContact(i, { phone: e.target.value })}
                  />
                </Field>
                <Field label="Email">
                  <input className="input" value={c.email} onChange={(e) => setContact(i, { email: e.target.value })} />
                </Field>
              </div>
            ))}
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
