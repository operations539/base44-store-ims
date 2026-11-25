import { useEffect, useState } from 'react';
import { get, post, put } from '../../api.js';
import { Badge, Card, DataTable, Field, Icon, Spinner, fmtDateTime } from '../../ui.jsx';

const EVENT_LABELS = {
  mrn_raised: 'New MRN raised',
  mrn_approved: 'MRN approved / routed',
  po_approval: 'Direct PO approval requested',
  dispatch_created: 'Challan dispatched',
  return_raised: 'Return raised',
  short_missing: 'Short / missing red flag',
  sla_breach: '48-hour SLA breach',
};

export default function Messaging() {
  const [settings, setSettings] = useState(null);
  const [messages, setMessages] = useState(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const loadMessages = () =>
    get('/admin/messages')
      .then((d) => setMessages(d.messages))
      .catch((err) => setError(err.message));

  useEffect(() => {
    get('/admin/settings')
      .then((d) => setSettings(d.messaging))
      .catch((err) => setError(err.message));
    loadMessages();
  }, []);

  if (!settings) return error ? <div className="alert alert-red">{error}</div> : <Spinner label="Loading messaging settings…" />;

  const setEmail = (k) => (e) =>
    setSettings((s) => ({ ...s, email: { ...s.email, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } }));
  const setWa = (k) => (e) => setSettings((s) => ({ ...s, whatsapp: { ...s.whatsapp, [k]: e.target.value } }));
  const toggleEvent = (key, channel) =>
    setSettings((s) => ({
      ...s,
      events: { ...s.events, [key]: { ...(s.events?.[key] || {}), [channel]: !s.events?.[key]?.[channel] } },
    }));

  const save = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        ...settings,
        email: { ...settings.email, ...(password ? { password } : {}) },
      };
      const res = await put('/admin/settings/messaging', payload);
      setSettings(res.messaging);
      setPassword('');
      setNotice('Messaging settings saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const retry = async (id) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await post(`/admin/messages/${id}/retry`, {});
      setNotice(res.ok ? 'Message re-sent.' : `Retry recorded — ${res.error}`);
      loadMessages();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { key: 'created_at', label: 'Created', render: (r) => fmtDateTime(r.created_at), csv: (r) => fmtDateTime(r.created_at) },
    { key: 'channel', label: 'Channel', render: (r) => <Badge tone={r.channel === 'email' ? 'blue' : 'green'}>{r.channel}</Badge>, csv: (r) => r.channel },
    { key: 'event_key', label: 'Event' },
    { key: 'recipient', label: 'Recipient' },
    { key: 'subject', label: 'Subject' },
    {
      key: 'status',
      label: 'Status',
      render: (r) => <Badge tone={r.status === 'Sent' ? 'green' : r.status === 'Failed' ? 'red' : 'amber'}>{r.status}</Badge>,
      csv: (r) => r.status,
    },
    { key: 'attempts', label: 'Tries', align: 'right' },
    { key: 'error', label: 'Last error', render: (r) => (r.error ? <span className="small" style={{ color: 'var(--red)' }}>{r.error}</span> : <span className="faint">—</span>) },
    {
      key: 'actions',
      label: '',
      sortable: false,
      render: (r) =>
        r.status !== 'Sent' ? (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => retry(r.id)}>
            <Icon name="refresh" size={13} /> Retry
          </button>
        ) : (
          <span className="faint">—</span>
        ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Configurable messaging center</h1>
          <p>Email (Resend or SMTP), WhatsApp free smart mode, event toggles and the send log</p>
        </div>
      </div>

      {error ? <div className="alert alert-red">{error}</div> : null}
      {notice ? <div className="alert alert-green">{notice}</div> : null}

      <div className="stack">
        <Card title="Email channel" subtitle="Resend API or your own SMTP relay">
          <div className="form-grid">
            <Field label="Provider">
              <select value={settings.email.provider} onChange={setEmail('provider')}>
                <option value="resend">Resend</option>
                <option value="smtp">SMTP</option>
              </select>
            </Field>
            <Field label="From name">
              <input value={settings.email.from_name || ''} onChange={setEmail('from_name')} />
            </Field>
            <Field label="From email">
              <input value={settings.email.from_email || ''} onChange={setEmail('from_email')} placeholder="store@koolmart.in" />
            </Field>
            <Field label="API key / SMTP password" hint={settings.email.has_password ? 'A credential is stored — leave blank to keep it.' : 'Not set yet.'}>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={settings.email.has_password ? '••••••••' : 'Paste credential'} autoComplete="new-password" />
            </Field>
            {settings.email.provider === 'smtp' ? (
              <>
                <Field label="SMTP host">
                  <input value={settings.email.smtp_host || ''} onChange={setEmail('smtp_host')} />
                </Field>
                <Field label="SMTP port">
                  <input type="number" value={settings.email.smtp_port || 587} onChange={setEmail('smtp_port')} />
                </Field>
                <Field label="SMTP user">
                  <input value={settings.email.smtp_user || ''} onChange={setEmail('smtp_user')} />
                </Field>
                <Field label="TLS">
                  <label className="small">
                    <input type="checkbox" checked={!!settings.email.smtp_secure} onChange={setEmail('smtp_secure')} /> Use TLS
                  </label>
                </Field>
              </>
            ) : null}
          </div>
        </Card>

        <Card title="WhatsApp channel" subtitle="Free smart mode (wa.me) now, Business API slot reserved for Phase 2">
          <div className="form-grid">
            <Field label="Mode">
              <select value={settings.whatsapp.mode} onChange={setWa('mode')}>
                <option value="smart_link">Free smart link (wa.me/91…)</option>
                <option value="api">Business API (Phase 2)</option>
              </select>
            </Field>
            <Field label="Business number" hint="Ten-digit Indian mobile number used in wa.me links.">
              <input value={settings.whatsapp.business_number || ''} onChange={setWa('business_number')} placeholder="9820000000" />
            </Field>
            <Field label="Business API key (reserved)" hint={settings.whatsapp.api_key_configured ? 'Slot filled — sending stays inactive until Phase 2.' : 'Reserved slot, not used for sending yet.'}>
              <input value={settings.whatsapp.api_key_configured ? '••••••••' : ''} onChange={setWa('api_key')} placeholder="Phase 2 slot" disabled={settings.whatsapp.api_key_configured} />
            </Field>
          </div>
        </Card>

        <Card title="Event-level delivery" subtitle="Choose Email, WhatsApp or both for each event">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Email</th>
                  <th>WhatsApp</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(EVENT_LABELS).map(([key, label]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <td>
                      <input type="checkbox" checked={!!settings.events?.[key]?.email} onChange={() => toggleEvent(key, 'email')} aria-label={`${label} email`} />
                    </td>
                    <td>
                      <input type="checkbox" checked={!!settings.events?.[key]?.whatsapp} onChange={() => toggleEvent(key, 'whatsapp')} aria-label={`${label} WhatsApp`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={save}>
            <Icon name="check" size={15} /> Save messaging settings
          </button>
        </Card>

        <Card title="Message send status log" subtitle="Every queued email and WhatsApp message, with retry">
          {!messages ? <Spinner label="Loading log…" /> : <DataTable columns={columns} rows={messages} exportName="message-log" rowKey={(r) => r.id} />}
        </Card>
      </div>
    </div>
  );
}
