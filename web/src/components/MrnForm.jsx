import { useEffect, useState } from 'react';
import { get, post } from '../api.js';
import { Field, Icon, Spinner } from '../ui.jsx';

const blankLine = () => ({ item_id: '', qty: '', remarks: '' });

export default function MrnForm({ onDone, onCancel }) {
  const [options, setOptions] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    site_id: '',
    required_date: '',
    priority: 'Normal',
    remarks: '',
    lines: [blankLine()],
  });

  useEffect(() => {
    get('/mrn/options')
      .then((data) => {
        setOptions(data);
        if (data.sites?.length === 1) setForm((prev) => ({ ...prev, site_id: data.sites[0].id }));
      })
      .catch((err) => setError(err.message));
  }, []);

  if (error && !options) return <div className="alert alert-red">{error}</div>;
  if (!options) return <Spinner label="Loading items and sites…" />;

  const setLine = (index, patch) =>
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = {
        site_id: form.site_id,
        required_date: form.required_date || null,
        priority: form.priority,
        remarks: form.remarks,
        line_items: form.lines.map((line) => ({
          item_id: line.item_id,
          qty: line.qty,
          remarks: line.remarks,
        })),
      };
      const result = await post('/mrn', payload);
      onDone?.(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      {error ? <div className="alert alert-red" style={{ marginBottom: 12 }}>{error}</div> : null}

      <div className="form-grid">
        <Field label="Site / project">
          <select
            className="select"
            value={form.site_id}
            onChange={(e) => setForm({ ...form, site_id: e.target.value })}
            required
          >
            <option value="">Select a site…</option>
            {options.sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.site_project_id} — {site.client_project_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Required by">
          <input
            type="date"
            className="input"
            value={form.required_date}
            onChange={(e) => setForm({ ...form, required_date: e.target.value })}
          />
        </Field>
        <Field label="Priority">
          <select
            className="select"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
          >
            {['Low', 'Normal', 'Urgent'].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Remarks" className="full">
          <textarea
            className="textarea"
            rows={2}
            value={form.remarks}
            onChange={(e) => setForm({ ...form, remarks: e.target.value })}
            placeholder="Optional note for the store manager"
          />
        </Field>
      </div>

      <div className="line-list">
        <div className="line-head">
          <strong>Items requested</strong>
          <span className="faint small">No rates are shown or captured here.</span>
        </div>

        {form.lines.map((line, index) => {
          const item = options.items.find((i) => i.id === line.item_id);
          return (
            <div className="line-row" key={index}>
              <select
                className="select"
                value={line.item_id}
                onChange={(e) => setLine(index, { item_id: e.target.value })}
                required
                aria-label={`Item ${index + 1}`}
              >
                <option value="">Select item…</option>
                {options.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.item_code} · {i.item_name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0.001"
                step="0.001"
                className="input"
                value={line.qty}
                onChange={(e) => setLine(index, { qty: e.target.value })}
                placeholder="Qty"
                required
                aria-label={`Quantity ${index + 1}`}
              />
              <span className="line-unit">{item?.unit || 'UOM'}</span>
              <input
                className="input"
                value={line.remarks}
                onChange={(e) => setLine(index, { remarks: e.target.value })}
                placeholder="Line remarks (optional)"
                aria-label={`Line remarks ${index + 1}`}
              />
              <button
                type="button"
                className="icon-btn"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    lines: prev.lines.length > 1 ? prev.lines.filter((_, i) => i !== index) : prev.lines,
                  }))
                }
                aria-label="Remove line"
                disabled={form.lines.length === 1}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setForm((prev) => ({ ...prev, lines: [...prev.lines, blankLine()] }))}
        >
          <Icon name="plus" size={14} /> Add item
        </button>
      </div>

      <div className="form-actions">
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit material request'}
        </button>
      </div>
    </form>
  );
}
