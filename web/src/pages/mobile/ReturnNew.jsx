import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '../../api.js';
import { Field, Icon, Spinner, qty } from '../../ui.jsx';

export default function ReturnNew() {
  const navigate = useNavigate();
  const [options, setOptions] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ site_id: '', flow_type: 'Return Store', vendor_id: '', reason: '' });
  const [lines, setLines] = useState([{ item_id: '', qty: '' }]);

  useEffect(() => {
    get('/mobile/return-options')
      .then(setOptions)
      .catch((err) => setError(err.message));
  }, []);

  const siteItems = useMemo(() => {
    if (!options || !form.site_id) return [];
    return options.items.filter((i) => i.site_id === form.site_id);
  }, [options, form.site_id]);

  if (error && !options) return <div className="alert alert-red">{error}</div>;
  if (!options) return <Spinner label="Loading sites…" />;

  const setLine = (idx, key, value) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [key]: value } : l)));

  const submit = async () => {
    setError('');
    const cleanLines = lines.filter((l) => l.item_id && Number(l.qty) > 0);
    if (!form.site_id) return setError('Choose the site.');
    if (!form.reason.trim()) return setError('Give the reason for this return.');
    if (!cleanLines.length) return setError('Add at least one item with a quantity.');
    if (form.flow_type === 'Return Vendor' && !form.vendor_id) return setError('Choose the vendor.');

    setBusy(true);
    try {
      await post('/mobile/returns', {
        site_id: form.site_id,
        flow_type: form.flow_type,
        vendor_id: form.flow_type === 'Return Vendor' ? form.vendor_id : undefined,
        reason: form.reason,
        lines: cleanLines.map((l) => ({ item_id: l.item_id, qty: Number(l.qty) })),
      });
      navigate('/m/returns', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 17 }}>Raise a return</h2>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          Stage 1 of 5 — the store assigns a pickup and the return is tracked to the ledger.
        </p>
      </div>

      {error ? <div className="alert alert-red">{error}</div> : null}

      <div className="mobile-card">
        <Field label="Site">
          <select value={form.site_id} onChange={(e) => setForm((f) => ({ ...f, site_id: e.target.value, }))}>
            <option value="">Choose a site…</option>
            {options.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.site_project_id} — {s.client_project_name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Return type">
          <select value={form.flow_type} onChange={(e) => setForm((f) => ({ ...f, flow_type: e.target.value }))}>
            <option value="Return Store">Return to store</option>
            <option value="Return Vendor">Return to vendor</option>
          </select>
        </Field>

        {form.flow_type === 'Return Vendor' ? (
          <Field label="Vendor">
            <select value={form.vendor_id} onChange={(e) => setForm((f) => ({ ...f, vendor_id: e.target.value }))}>
              <option value="">Choose a vendor…</option>
              {options.vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vendor_name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="Reason" hint="Mandatory — this is printed on the return record.">
          <textarea
            rows={3}
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            placeholder="Excess material, wrong item, damaged on site…"
          />
        </Field>
      </div>

      <div className="mobile-card">
        <h3 style={{ marginBottom: 8 }}>Items being returned</h3>
        {!form.site_id ? <p className="small muted">Choose a site to see the material issued to it.</p> : null}
        {form.site_id && !siteItems.length ? (
          <p className="small muted">No issued material found for this site — you can still add an item manually.</p>
        ) : null}

        {lines.map((line, idx) => (
          <div key={idx} style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
            <select value={line.item_id} onChange={(e) => setLine(idx, 'item_id', e.target.value)} aria-label={`Item ${idx + 1}`}>
              <option value="">Choose an item…</option>
              {siteItems.map((i) => (
                <option key={i.item_id} value={i.item_id}>
                  {i.item_code} — {i.item_name} (net {qty(i.net_qty)} {i.unit})
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0.001"
              step="0.001"
              value={line.qty}
              onChange={(e) => setLine(idx, 'qty', e.target.value)}
              placeholder="Quantity sent"
              aria-label={`Quantity ${idx + 1}`}
            />
            {lines.length > 1 ? (
              <button type="button" className="btn btn-sm" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}>
                Remove line
              </button>
            ) : null}
          </div>
        ))}

        <button type="button" className="btn btn-block" onClick={() => setLines((prev) => [...prev, { item_id: '', qty: '' }])}>
          <Icon name="plus" size={15} /> Add another item
        </button>
      </div>

      <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={submit}>
        <Icon name="check" size={17} /> {busy ? 'Raising…' : 'Raise return'}
      </button>
    </>
  );
}
