import { useEffect, useState } from 'react';
import { get, put } from '../../api.js';
import { Card, Field, Icon, Spinner } from '../../ui.jsx';
import Tip from '../../components/Tip.jsx';

const DOC_TYPES = [
  ['MRN', 'Material request'],
  ['PO', 'Direct purchase order'],
  ['DC', 'Delivery challan'],
  ['RET', 'Return challan'],
  ['PUR', 'Purchase entry'],
];

const PO_TERMS = [
  'Rates quoted are inclusive of GST unless stated otherwise.',
  'Delivery must reach the Kool Mart store or site within the agreed lead time.',
  'Material rejected at inspection will be returned at the vendor’s cost.',
  'Payment terms as agreed with the Kool Mart accounts department.',
  'This purchase order is valid only with an authorised signature.',
];

export default function Documents() {
  const [data, setData] = useState(null);
  const [numbering, setNumbering] = useState(null);
  const [dcPrint, setDcPrint] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get('/admin/settings')
      .then((d) => {
        setData(d);
        setNumbering(d.numbering);
        setDcPrint(d.dc_print);
      })
      .catch((err) => setError(err.message));
  }, []);

  if (error && !data) return <div className="alert alert-red">{error}</div>;
  if (!data) return <Spinner label="Loading document settings…" />;

  const save = async (path, body, message) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await put(path, body);
      setNotice(message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Document templates &amp; numbering</h1>
          <p>FY sequence prefixes, fixed Direct PO terms and the rate-free 3-copy DC header</p>
        </div>
      </div>

      {error ? <div className="alert alert-red">{error}</div> : null}
      {notice ? <div className="alert alert-green">{notice}</div> : null}

      <div className="stack">
        <Card title="Financial-year numbering" subtitle="Format: KM/2026-27/DC/11/001">
          <div className="form-grid">
            <Field label="Base label">
              <input
                value={numbering.prefix_base}
                onChange={(e) => setNumbering((n) => ({ ...n, prefix_base: e.target.value }))}
                maxLength={12}
              />
            </Field>
            {DOC_TYPES.map(([key, label]) => (
              <Field key={key} label={`${label} prefix`}>
                <input
                  value={numbering.types?.[key] || ''}
                  onChange={(e) =>
                    setNumbering((n) => ({ ...n, types: { ...(n.types || {}), [key]: e.target.value } }))
                  }
                  maxLength={12}
                />
              </Field>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => save('/admin/settings/numbering', numbering, 'Numbering updated. New documents use the new prefixes.')}
          >
            <Icon name="check" size={15} /> Save numbering
          </button>
          <p className="small muted" style={{ marginTop: 10 }}>
            Existing document numbers never change — the next document in each series picks up the new prefix.
          </p>
        </Card>

        <Card
          title={
            <>
              Rate-free delivery challan (3 copies)
              <Tip text="Challans print without invoice, rate, unit cost or expiry on every copy. Rates are never rendered on a DC." />
            </>
          }
          subtitle="Header details used on the A4 print of every DC copy"
        >
          <div className="form-grid">
            <Field label="Company name">
              <input value={dcPrint.company_name} onChange={(e) => setDcPrint((p) => ({ ...p, company_name: e.target.value }))} />
            </Field>
            <Field label="GSTIN">
              <input value={dcPrint.gstin} onChange={(e) => setDcPrint((p) => ({ ...p, gstin: e.target.value }))} />
            </Field>
            <Field label="Address" className="span-2">
              <input value={dcPrint.address} onChange={(e) => setDcPrint((p) => ({ ...p, address: e.target.value }))} />
            </Field>
            <Field label="Footer note" className="span-2">
              <input value={dcPrint.footer_note} onChange={(e) => setDcPrint((p) => ({ ...p, footer_note: e.target.value }))} />
            </Field>
            {[0, 1, 2].map((idx) => (
              <Field key={idx} label={`Copy ${idx + 1} label`}>
                <input
                  value={dcPrint.copies?.[idx] || ''}
                  onChange={(e) =>
                    setDcPrint((p) => {
                      const copies = [...(p.copies || [])];
                      copies[idx] = e.target.value;
                      return { ...p, copies };
                    })
                  }
                />
              </Field>
            ))}
          </div>
          <div className="alert alert-blue">
            <Icon name="lock" size={15} />
            <div>Rate printing stays off by product rule and cannot be enabled from here.</div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => save('/admin/settings/dc-print', dcPrint, 'DC header updated.')}
          >
            <Icon name="check" size={15} /> Save DC header
          </button>
        </Card>

        <Card title="Direct PO terms & conditions" subtitle="Fixed text on every purchase order — not editable">
          <ol className="small" style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted)', lineHeight: 1.9 }}>
            {PO_TERMS.map((term) => (
              <li key={term}>{term}</li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
