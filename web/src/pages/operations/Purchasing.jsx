import { useEffect, useMemo, useState } from 'react';
import { get, patch, post } from '../../api.js';
import {
  Badge,
  DataTable,
  EmptyState,
  Field,
  Icon,
  Modal,
  Spinner,
  StatusBadge,
  fmtDate,
  inr,
  qty,
} from '../../ui.jsx';

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

const emptyForm = () => ({
  linked_po_id: '',
  item_id: '',
  qty: '',
  rate: '',
  tax_percent: '',
  bill_status: 'Pending',
  bill_no: '',
  high_side_serial_nos: '',
  bill_photo_url: '',
  entry_date: todayIso(),
});

export default function Purchasing() {
  const [data, setData] = useState(null);
  const [pos, setPos] = useState([]);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [editForm, setEditForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = () =>
    Promise.all([get('/purchasing'), get('/pos')])
      .then(([purchaseData, poData]) => {
        setData(purchaseData);
        setPos(poData.pos);
      })
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  const selectedPo = useMemo(
    () => pos.find((po) => po.id === form.linked_po_id),
    [pos, form.linked_po_id]
  );
  const poLines = selectedPo?.line_items || [];

  const pickItem = (itemId) => {
    const line = poLines.find((l) => String(l.item_id) === String(itemId));
    setForm((prev) => ({
      ...prev,
      item_id: itemId,
      tax_percent: line ? String(line.tax_percent ?? 18) : prev.tax_percent,
    }));
  };

  const uploadPhoto = async (file) => {
    if (!file) return;
    setUploading(true);
    setFormError('');
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read that file.'));
        reader.readAsDataURL(file);
      });
      const result = await post('/files', { data_url: dataUrl });
      if (editing) setEditForm((prev) => ({ ...prev, bill_photo_url: result.url }));
      else setForm((prev) => ({ ...prev, bill_photo_url: result.url }));
    } catch (err) {
      setFormError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      await post('/purchasing', {
        linked_po_id: form.linked_po_id,
        item_id: form.item_id,
        qty: form.qty,
        rate: form.rate === '' ? 0 : form.rate,
        tax_percent: form.tax_percent === '' ? undefined : form.tax_percent,
        bill_status: form.bill_status,
        bill_no: form.bill_no,
        high_side_serial_nos: form.high_side_serial_nos
          ? form.high_side_serial_nos.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        bill_photo_url: form.bill_photo_url || null,
        entry_date: form.entry_date,
      });
      setCreateOpen(false);
      setForm(emptyForm());
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      await patch(`/purchasing/${editing.id}`, {
        bill_no: editForm.bill_no,
        rate: editForm.rate === '' ? 0 : editForm.rate,
        tax_percent: editForm.tax_percent,
        bill_status: editForm.bill_status,
        bill_photo_url: editForm.bill_photo_url || null,
      });
      setEditing(null);
      setEditForm(null);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const columns = useMemo(
    () => [
      { key: 'purchase_id', label: 'Entry', render: (r) => <span className="mono">{r.purchase_id}</span> },
      { key: 'entry_date', label: 'Date', render: (r) => fmtDate(r.entry_date) },
      { key: 'po_code', label: 'PO', render: (r) => r.po_code || <span className="faint">—</span> },
      { key: 'vendor_name', label: 'Vendor' },
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
      { key: 'qty', label: 'Qty', align: 'right', render: (r) => `${qty(r.qty)} ${r.unit}` },
      { key: 'rate', label: 'Rate', align: 'right', render: (r) => (Number(r.rate) === 0 ? <Badge tone="amber">₹0</Badge> : inr(r.rate)) },
      { key: 'total_amount', label: 'Total', align: 'right', render: (r) => inr(r.total_amount) },
      {
        key: 'bill_status',
        label: 'Bill',
        render: (r) => (
          <div>
            <StatusBadge value={r.bill_status} />
            {r.bill_no ? <div className="small faint mono">{r.bill_no}</div> : null}
          </div>
        ),
      },
      {
        key: 'bill_photo_url',
        label: 'Photo',
        sortable: false,
        searchable: false,
        render: (r) =>
          r.bill_photo_url ? (
            <a href={r.bill_photo_url} target="_blank" rel="noreferrer" className="link-btn">
              View
            </a>
          ) : (
            <span className="faint">—</span>
          ),
      },
      {
        key: 'edit',
        label: '',
        sortable: false,
        searchable: false,
        render: (r) => (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setEditing(r);
              setEditForm({
                bill_no: r.bill_no || '',
                rate: String(r.rate ?? ''),
                tax_percent: String(r.tax_percent ?? 18),
                bill_status: r.bill_status,
                bill_photo_url: r.bill_photo_url || '',
              });
            }}
          >
            <Icon name="edit" size={13} /> Bill
          </button>
        ),
      },
    ],
    []
  );

  if (error && !data) return <div className="page"><div className="alert alert-red">{error}</div></div>;
  if (!data) return <Spinner label="Loading purchasing entries…" />;

  const pendingCount = data.entries.filter((e) => e.bill_status === 'Pending').length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Store purchasing</h1>
          <p>
            Every receipt is linked to a Direct PO and adds stock back automatically — including items sitting in
            minus stock. Rate ₹0 and a pending bill are allowed.
          </p>
        </div>
        <div className="actions">
          {pendingCount ? <span className="chip"><Icon name="alert" size={14} /> {pendingCount} bill pending</span> : null}
          <button type="button" className="btn btn-primary" onClick={() => { setCreateOpen(true); setForm(emptyForm()); }}>
            <Icon name="plus" size={15} /> Record receipt
          </button>
        </div>
      </div>

      {error ? <div className="alert alert-red" style={{ marginBottom: 14 }}>{error}</div> : null}

      <DataTable
        columns={columns}
        rows={data.entries}
        exportName="purchasing-entries"
        initialSort={{ key: 'entry_date', dir: 'desc' }}
        empty={
          <EmptyState
            icon="download"
            title="No receipts recorded"
            description="Record goods received against a Direct PO to bring stock back into the store."
          />
        }
      />

      {createOpen ? (
        <Modal
          title="Record a purchase receipt"
          subtitle="Linked to a Direct PO · adds stock to the store ledger"
          onClose={() => setCreateOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setCreateOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" form="purchase-form" className="btn btn-primary" disabled={busy || uploading}>
                {busy ? 'Saving…' : 'Post receipt'}
              </button>
            </>
          }
        >
          <form id="purchase-form" onSubmit={submit}>
            {formError ? <div className="alert alert-red" style={{ marginBottom: 12 }}>{formError}</div> : null}

            <Field label="Direct PO">
              <select
                className="select"
                value={form.linked_po_id}
                onChange={(e) => setForm({ ...emptyForm(), linked_po_id: e.target.value, entry_date: form.entry_date })}
                required
              >
                <option value="">Select a purchase order…</option>
                {pos.map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.po_code} · {po.vendor_name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="form-grid">
              <Field label="Item on the PO">
                <select
                  className="select"
                  value={form.item_id}
                  onChange={(e) => pickItem(e.target.value)}
                  required
                  disabled={!selectedPo}
                >
                  <option value="">{selectedPo ? 'Select item…' : 'Choose a PO first'}</option>
                  {poLines.map((line) => (
                    <option key={line.item_id} value={line.item_id}>
                      {line.item_code} · {line.item_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Received qty">
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  className="input"
                  value={form.qty}
                  onChange={(e) => setForm({ ...form, qty: e.target.value })}
                  required
                />
              </Field>
              <Field label="Rate" hint="₹0 is allowed while the bill is pending.">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input"
                  value={form.rate}
                  onChange={(e) => setForm({ ...form, rate: e.target.value })}
                  placeholder="0"
                />
              </Field>
              <Field label="Tax %">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  className="input"
                  value={form.tax_percent}
                  onChange={(e) => setForm({ ...form, tax_percent: e.target.value })}
                />
              </Field>
              <Field label="Bill status">
                <select
                  className="select"
                  value={form.bill_status}
                  onChange={(e) => setForm({ ...form, bill_status: e.target.value })}
                >
                  <option value="Pending">Pending</option>
                  <option value="Received">Received</option>
                </select>
              </Field>
              <Field label="Bill no" hint="Can be added later.">
                <input
                  className="input"
                  value={form.bill_no}
                  onChange={(e) => setForm({ ...form, bill_no: e.target.value })}
                  placeholder="Vendor bill number"
                />
              </Field>
              <Field label="High Side serial nos" className="full" hint="Comma separated — for serialised equipment.">
                <input
                  className="input"
                  value={form.high_side_serial_nos}
                  onChange={(e) => setForm({ ...form, high_side_serial_nos: e.target.value })}
                  placeholder="FXDQ40-26-0101, FXDQ40-26-0102"
                />
              </Field>
              <Field label="Vendor bill photo" className="full">
                <div className="upload-row">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => uploadPhoto(e.target.files?.[0])}
                  />
                  {uploading ? <span className="small muted">Uploading…</span> : null}
                  {form.bill_photo_url ? (
                    <a href={form.bill_photo_url} target="_blank" rel="noreferrer" className="small">
                      Attached — view
                    </a>
                  ) : null}
                </div>
              </Field>
            </div>
          </form>
        </Modal>
      ) : null}

      {editing && editForm ? (
        <Modal
          title={`Update bill · ${editing.purchase_id}`}
          subtitle="Add the final bill number and rate any time."
          onClose={() => { setEditing(null); setEditForm(null); }}
          footer={
            <>
              <button type="button" className="btn" onClick={() => { setEditing(null); setEditForm(null); }} disabled={busy}>
                Cancel
              </button>
              <button type="submit" form="bill-form" className="btn btn-primary" disabled={busy || uploading}>
                {busy ? 'Saving…' : 'Save bill details'}
              </button>
            </>
          }
        >
          <form id="bill-form" onSubmit={saveEdit}>
            {formError ? <div className="alert alert-red" style={{ marginBottom: 12 }}>{formError}</div> : null}
            <div className="form-grid">
              <Field label="Bill no">
                <input
                  className="input"
                  value={editForm.bill_no}
                  onChange={(e) => setEditForm({ ...editForm, bill_no: e.target.value })}
                />
              </Field>
              <Field label="Bill status">
                <select
                  className="select"
                  value={editForm.bill_status}
                  onChange={(e) => setEditForm({ ...editForm, bill_status: e.target.value })}
                >
                  <option value="Pending">Pending</option>
                  <option value="Received">Received</option>
                </select>
              </Field>
              <Field label="Rate">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input"
                  value={editForm.rate}
                  onChange={(e) => setEditForm({ ...editForm, rate: e.target.value })}
                />
              </Field>
              <Field label="Tax %">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  className="input"
                  value={editForm.tax_percent}
                  onChange={(e) => setEditForm({ ...editForm, tax_percent: e.target.value })}
                />
              </Field>
              <Field label="Vendor bill photo" className="full">
                <div className="upload-row">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => uploadPhoto(e.target.files?.[0])}
                  />
                  {uploading ? <span className="small muted">Uploading…</span> : null}
                  {editForm.bill_photo_url ? (
                    <a href={editForm.bill_photo_url} target="_blank" rel="noreferrer" className="small">
                      Attached — view
                    </a>
                  ) : null}
                </div>
              </Field>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
