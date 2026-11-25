import { useState } from 'react';
import { post } from '../../api.js';
import { Badge, Card, DataTable, ErrorNote, Field, Icon, Spinner } from '../../ui.jsx';

const TYPES = [
  { key: 'items', label: 'Items Master', hint: 'Item code, category, UOM, GST, rate' },
  { key: 'sites', label: 'Sites Master', hint: 'Site / project ID and supervisor email' },
  { key: 'vendors', label: 'Vendors Master', hint: 'Vendor ID, GSTIN, contact persons' },
  { key: 'opening_stock', label: 'Opening Stock', hint: 'Controlled opening balance per item' },
];

const STATUS_TONE = { new: 'green', update: 'blue', skip: 'neutral', error: 'red' };

export default function Import() {
  const [type, setType] = useState('items');
  const [mode, setMode] = useState('upsert');
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setPreview(null);
    setResult(null);
    setError('');
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    setFileName(file.name);
    setCsv(await file.text());
  };

  const runPreview = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const data = await post('/admin/import/preview', { type, mode, csv });
      setPreview(data);
    } catch (err) {
      setError(err.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const runCommit = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await post('/admin/import/commit', { type, mode, csv });
      setResult(data);
      setPreview(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const previewColumns = [
    { key: 'row', label: 'CSV row', align: 'right' },
    {
      key: 'status',
      label: 'Action',
      render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>,
    },
    {
      key: 'summary',
      label: 'Record',
      render: (r) => {
        const d = r.data;
        const label =
          type === 'items'
            ? `${d.item_code || '?'} · ${d.item_name || ''}`
            : type === 'sites'
            ? `${d.site_project_id || '?'} · ${d.client_project_name || ''}`
            : type === 'vendors'
            ? `${d.vendor_id || '?'} · ${d.vendor_name || ''}`
            : `${d.item_code || '?'} · qty ${d.qty ?? ''}`;
        return <span className="small">{label}</span>;
      },
    },
    {
      key: 'errors',
      label: 'Validation',
      render: (r) =>
        Object.keys(r.errors || {}).length ? (
          <div className="small" style={{ color: 'var(--red)' }}>
            {Object.entries(r.errors).map(([k, v]) => (
              <div key={k}>
                <strong>{k}</strong>: {v}
              </div>
            ))}
          </div>
        ) : (
          <span className="small" style={{ color: 'var(--green)' }}>
            OK
          </span>
        ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Master data import</h1>
          <p>
            Blank templates, preview and validation before save, and smart upsert. Opening stock is imported as a
            controlled stock transaction so the ledger stays append-only.
          </p>
        </div>
      </div>

      <div className="grid-2">
        <div className="stack">
          <Card title="1 · Choose what to import">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setType(t.key);
                    reset();
                  }}
                  className={`card`}
                  style={{
                    textAlign: 'left',
                    padding: 12,
                    cursor: 'pointer',
                    borderColor: type === t.key ? 'var(--primary)' : 'var(--border)',
                    boxShadow: type === t.key ? '0 0 0 3px rgba(59,130,246,0.14)' : 'none',
                    background: 'var(--surface)',
                  }}
                >
                  <div style={{ fontWeight: 650, fontSize: 13 }}>{t.label}</div>
                  <div className="small muted" style={{ marginTop: 2 }}>
                    {t.hint}
                  </div>
                </button>
              ))}
            </div>

            <div className="divider" />

            <Field label="Upsert mode">
              <label className="checkbox-row" style={{ marginBottom: 6 }}>
                <input type="radio" name="mode" checked={mode === 'upsert'} onChange={() => setMode('upsert')} />
                <span>
                  <strong>Update + Add</strong> — update existing codes and insert new ones
                </span>
              </label>
              <label className="checkbox-row">
                <input type="radio" name="mode" checked={mode === 'add_only'} onChange={() => setMode('add_only')} />
                <span>
                  <strong>Add new only</strong> — skip codes that already exist
                </span>
              </label>
            </Field>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <a className="btn" href={`/api/admin/import/template/${type}`} download>
                <Icon name="download" size={15} /> Blank template
              </a>
              <label className="btn" style={{ cursor: 'pointer' }}>
                <Icon name="upload" size={15} /> Choose CSV
                <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: 'none' }} />
              </label>
            </div>
            {fileName ? (
              <div className="small muted" style={{ marginTop: 10 }}>
                Loaded <strong>{fileName}</strong>
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button type="button" className="btn btn-primary" disabled={!csv || busy} onClick={runPreview}>
                {busy ? 'Checking…' : 'Preview & validate'}
              </button>
              {preview ? (
                <button type="button" className="btn" onClick={reset}>
                  Clear
                </button>
              ) : null}
            </div>
          </Card>

          <Card title="Expected columns">
            <div className="mono-block">
              {type === 'items' &&
                'Item_Code, Category, Prod_Category, Item_Name, Model_No, Unit, Tax_Percent, Min_Qty_Alert, Latest_Rate'}
              {type === 'sites' && 'Site_Project_ID, Client_Project_Name, Full_Site_Address, Supervisor_Email, Status'}
              {type === 'vendors' &&
                'Vendor_ID, Vendor_Name, Full_Address, GSTIN, Contact_Name, Contact_Designation, Contact_Phone, Contact_Email, Status'}
              {type === 'opening_stock' && 'Item_Code, Opening_Qty, Unit, Remarks'}
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>
              Category accepts “High Side” or “Low Side”. Unit accepts nos, pcs, feet, mtr, sqft, kg, roll, box. GST
              slabs are 0, 5, 12, 18 or 28.
            </p>
          </Card>
        </div>

        <div className="stack">
          <ErrorNote message={error} />

          {result ? (
            <Card title="Import complete">
              <div className="kpi-grid" style={{ marginBottom: 0 }}>
                <div className="kpi">
                  <span className="label">Inserted</span>
                  <span className="value">{result.inserted}</span>
                </div>
                <div className="kpi">
                  <span className="label">Updated</span>
                  <span className="value">{result.updated}</span>
                </div>
                <div className="kpi">
                  <span className="label">Skipped</span>
                  <span className="value">{result.skipped}</span>
                </div>
              </div>
            </Card>
          ) : null}

          {preview ? (
            <Card
              title="Preview"
              subtitle={`${preview.summary.new} new · ${preview.summary.update} update · ${preview.summary.skip} skip · ${preview.summary.error} error`}
              bodyClass=""
            >
              <div style={{ padding: '0 0 0' }}>
                <DataTable
                  columns={previewColumns}
                  rows={preview.rows}
                  exportName={`${type}-preview`}
                  searchKeys={['summary']}
                />
              </div>
              <div style={{ padding: 14, borderTop: '1px solid var(--border)' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  disabled={busy || preview.summary.error > 0}
                  onClick={runCommit}
                >
                  {busy ? 'Saving…' : `Save ${preview.summary.new + preview.summary.update} row(s)`}
                </button>
                {preview.summary.error > 0 ? (
                  <p className="small" style={{ color: 'var(--red)', marginBottom: 0 }}>
                    Fix the highlighted rows in your CSV and upload again.
                  </p>
                ) : null}
              </div>
            </Card>
          ) : (
            !result && (
              <Card title="How it works">
                <ol className="small" style={{ paddingLeft: 18, color: 'var(--text-muted)', lineHeight: 1.9, margin: 0 }}>
                  <li>Download the blank template for the master you are loading.</li>
                  <li>Fill it in Excel or Google Sheets and export as CSV.</li>
                  <li>Upload it and run the preview — every row is validated.</li>
                  <li>Only a clean file can be saved, and every save is audited.</li>
                </ol>
              </Card>
            )
          )}
        </div>
      </div>
    </div>
  );
}
