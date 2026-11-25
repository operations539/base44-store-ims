import { useEffect, useState } from 'react';
import { get, patch, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import {
  Badge,
  DataTable,
  ErrorNote,
  Field,
  Icon,
  Modal,
  Spinner,
  StatusBadge,
  inr,
  qty,
} from '../ui.jsx';

const BLANK = {
  item_code: '',
  category: 'High Side',
  prod_category: '',
  item_name: '',
  model_no: '',
  unit: 'nos',
  tax_percent: '18',
  min_qty_alert: '0',
  latest_rate: '0',
};

const UNITS = ['nos', 'pcs', 'feet', 'mtr', 'sqft', 'kg', 'roll', 'box'];
const TAX = [0, 5, 12, 18, 28];

export default function Items() {
  const { has } = useAuth();
  const canWrite = has('masters.write');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [fields, setFields] = useState({});
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    get('/items')
      .then(setData)
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

  const openEdit = (item) => {
    setEditing(item.id);
    setForm({
      item_code: item.item_code,
      category: item.category,
      prod_category: item.prod_category || '',
      item_name: item.item_name,
      model_no: item.model_no || '',
      unit: item.unit,
      tax_percent: String(item.tax_percent),
      min_qty_alert: String(item.min_qty_alert),
      latest_rate: String(item.latest_rate ?? 0),
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
      const payload = { ...form, tax_percent: Number(form.tax_percent), min_qty_alert: Number(form.min_qty_alert), latest_rate: Number(form.latest_rate) };
      if (editing === 'new') await post('/items', payload);
      else await patch(`/items/${editing}`, payload);
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
  if (!data) return <Spinner label="Loading items…" />;

  const columns = [
    { key: 'item_code', label: 'Item code', render: (r) => <span className="mono">{r.item_code}</span> },
    { key: 'item_name', label: 'Item' },
    { key: 'category', label: 'Category', render: (r) => <StatusBadge value={r.category} /> },
    { key: 'prod_category', label: 'Product category' },
    { key: 'model_no', label: 'Model no' },
    { key: 'unit', label: 'UOM' },
    { key: 'tax_percent', label: 'GST %', align: 'right', render: (r) => `${r.tax_percent}%` },
    {
      key: 'store_physical_stock',
      label: 'Stock',
      align: 'right',
      render: (r) => (
        <span className={r.store_physical_stock < 0 ? 'negative' : ''}>
          {qty(r.store_physical_stock)} {r.unit}
        </span>
      ),
    },
    ...(data.pricingVisible
      ? [{ key: 'latest_rate', label: 'Latest rate', align: 'right', render: (r) => inr(r.latest_rate) }]
      : []),
    {
      key: 'demo',
      label: 'Source',
      sortable: false,
      render: (r) => (r.is_demo ? <Badge tone="amber">Demo</Badge> : <Badge tone="neutral">Live</Badge>),
    },
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
          <h1>Items master</h1>
          <p>
            Universal item code, High Side / Low Side classification, multi-UOM and GST slab. Stock balances are
            driven by the ledger — they cannot be typed in here.
          </p>
        </div>
        <div className="actions">
          {canWrite ? (
            <button type="button" className="btn btn-primary" onClick={openNew}>
              <Icon name="plus" size={15} /> New item
            </button>
          ) : (
            <span className="chip">
              <Icon name="eye" size={14} /> Read only
            </span>
          )}
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={data.items}
        exportName="items-master"
        initialSort={{ key: 'item_code', dir: 'asc' }}
      />

      {editing ? (
        <Modal
          title={editing === 'new' ? 'New item' : 'Edit item'}
          subtitle="High Side items carry a model number; Low Side items are quantity-only."
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" form="item-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save item'}
              </button>
            </>
          }
        >
          <form id="item-form" onSubmit={save}>
            <ErrorNote message={saveError} />
            <div className="form-grid">
              <Field label="Item code" error={fields.item_code}>
                <input
                  className={`input ${fields.item_code ? 'has-error' : ''}`}
                  value={form.item_code}
                  onChange={(e) => setForm({ ...form, item_code: e.target.value })}
                  required
                />
              </Field>
              <Field label="Category" error={fields.category}>
                <select
                  className="select"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  <option>High Side</option>
                  <option>Low Side</option>
                </select>
              </Field>
              <Field label="Item name" className="full" error={fields.item_name}>
                <input
                  className={`input ${fields.item_name ? 'has-error' : ''}`}
                  value={form.item_name}
                  onChange={(e) => setForm({ ...form, item_name: e.target.value })}
                  required
                />
              </Field>
              <Field label="Product category">
                <input
                  className="input"
                  value={form.prod_category}
                  onChange={(e) => setForm({ ...form, prod_category: e.target.value })}
                  placeholder="Split AC, Copper Piping…"
                />
              </Field>
              <Field label="Model no (High Side)">
                <input
                  className="input"
                  value={form.model_no}
                  onChange={(e) => setForm({ ...form, model_no: e.target.value })}
                />
              </Field>
              <Field label="Unit" error={fields.unit}>
                <select className="select" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="GST slab" error={fields.tax_percent}>
                <select
                  className="select"
                  value={form.tax_percent}
                  onChange={(e) => setForm({ ...form, tax_percent: e.target.value })}
                >
                  {TAX.map((t) => (
                    <option key={t} value={t}>
                      {t}%
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Minimum alert qty" error={fields.min_qty_alert}>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.001"
                  value={form.min_qty_alert}
                  onChange={(e) => setForm({ ...form, min_qty_alert: e.target.value })}
                />
              </Field>
              <Field label="Latest rate (₹)" error={fields.latest_rate}>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.latest_rate}
                  onChange={(e) => setForm({ ...form, latest_rate: e.target.value })}
                />
              </Field>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
