import { useEffect, useState } from 'react';
import { get, post } from '../../api.js';
import { Card, DataTable, ErrorNote, Field, Icon, Modal, Spinner } from '../../ui.jsx';

export default function DemoData() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const load = () =>
    get('/admin/demo/summary')
      .then(setSummary)
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  const clearDemo = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await post('/admin/demo/clear', { confirm: confirmText });
      setResult(`Removed ${Object.values(data.removed).reduce((a, b) => a + b, 0)} demo rows.`);
      setModal(false);
      setConfirmText('');
      setAck(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await post('/admin/demo/restore', {});
      setResult(
        data.summary?.skipped
          ? 'Demo data is already present — nothing was duplicated.'
          : `Restored ${data.summary.items} items, ${data.summary.vendors} vendors, ${data.summary.sites} sites.`
      );
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !summary) return <div className="page"><div className="alert alert-red">{error}</div></div>;
  if (!summary) return <Spinner label="Loading demo data summary…" />;

  const columns = [
    { key: 'label', label: 'Dataset' },
    { key: 'table', label: 'Table', render: (r) => <span className="mono small">{r.table}</span> },
    { key: 'count', label: 'Demo rows', align: 'right' },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Demo data</h1>
          <p>
            Every seeded record carries <span className="mono">is_demo = true</span>. Clearing removes only those
            rows — real records, live users and the audit trail stay untouched.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={restore} disabled={busy}>
            <Icon name="refresh" size={15} /> Restore demo data
          </button>
          <button type="button" className="btn btn-danger" onClick={() => setModal(true)} disabled={summary.total === 0}>
            <Icon name="database" size={15} /> Clear demo data
          </button>
        </div>
      </div>

      <ErrorNote message={error} />
      {result ? (
        <div className="alert alert-green" style={{ marginBottom: 16 }}>
          <Icon name="check" size={16} />
          <div>{result}</div>
        </div>
      ) : null}

      <div className="grid-2">
        <Card title="Demo footprint" subtitle={`${summary.total} tagged rows in this database`} bodyClass="">
          <DataTable columns={columns} rows={summary.counts} exportName="demo-data-summary" searchKeys={['label', 'table']} />
        </Card>

        <Card title="What the reset does">
          <ul className="small" style={{ paddingLeft: 18, lineHeight: 1.9, color: 'var(--text-muted)', margin: 0 }}>
            <li>Deletes challans, lines, returns, POs, MRNs, purchases and stock movements tagged demo.</li>
            <li>Deletes demo items, sites, vendors and demo user accounts.</li>
            <li>Recomputes every item balance from the remaining ledger.</li>
            <li>Leaves your administrator account, live masters and the audit trail in place.</li>
          </ul>
          <div className="alert alert-amber" style={{ marginTop: 12 }}>
            <Icon name="alert" size={15} />
            <div>
              A demo reset cannot be undone from the UI. “Restore demo data” re-seeds the same dataset if you need it
              back.
            </div>
          </div>
        </Card>
      </div>

      {modal ? (
        <Modal
          title="Clear demo / test data"
          subtitle="This removes is_demo = true rows only."
          onClose={() => {
            setModal(false);
            setConfirmText('');
            setAck(false);
          }}
          footer={
            <>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setModal(false);
                  setConfirmText('');
                  setAck(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy || !ack || confirmText.trim().toUpperCase() !== 'CLEAR DEMO DATA'}
                onClick={clearDemo}
              >
                {busy ? 'Clearing…' : 'Permanently clear demo data'}
              </button>
            </>
          }
        >
          <div className="alert alert-red" style={{ marginBottom: 14 }}>
            <Icon name="alert" size={16} />
            <div>
              <strong>Two confirmations are required.</strong> Demo records across {summary.counts.length} tables will
              be deleted.
            </div>
          </div>

          <label className="checkbox-row" style={{ marginBottom: 14 }}>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>I understand that demo transactions, returns and stock movements will be permanently removed.</span>
          </label>

          <Field label="Type CLEAR DEMO DATA to continue">
            <input
              className="input mono"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="CLEAR DEMO DATA"
            />
          </Field>
        </Modal>
      ) : null}
    </div>
  );
}
