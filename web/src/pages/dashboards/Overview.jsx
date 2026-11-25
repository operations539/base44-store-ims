import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth.jsx';
import { get } from '../../api.js';
import { Card, EmptyState, Icon, Spinner, fmtDateTime, inr, qty } from '../../ui.jsx';
import Tip from '../../components/Tip.jsx';

function Kpi({ label, value, meta, icon, tone = '', tip }) {
  return (
    <div className={`kpi ${tone}`}>
      <span className="label">
        {label}
        {tip ? <Tip text={tip} /> : null}
      </span>
      <span className="value">{value}</span>
      {meta ? <span className="meta">{meta}</span> : null}
      <span className="kpi-icon">
        <Icon name={icon} size={16} />
      </span>
    </div>
  );
}

export default function Overview() {
  const { has } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/dashboard/summary')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!data) return <Spinner label="Loading dashboard…" />;

  const { stock, mrn, po, challans, returns, bills, recentActivity } = data;

  const alerts = [];
  if (stock.negative > 0) {
    alerts.push({
      tone: 'amber',
      icon: 'alert',
      title: `${stock.negative} item${stock.negative > 1 ? 's' : ''} in minus stock`,
      body: 'Urgent dispatches were allowed. Purchase the balance or post a return to clear the amber flag.',
      to: '/stock',
    });
  }
  if (challans.awaiting_signed > 0) {
    alerts.push({
      tone: 'red',
      icon: 'alert',
      title: `${challans.awaiting_signed} challan${challans.awaiting_signed > 1 ? 's' : ''} missing the signed DC beyond 48 hours`,
      body: 'Helpers must upload the signed copy so the site archive stays complete.',
      to: '/returns',
    });
  }
  if (returns.short_missing > 0) {
    alerts.push({
      tone: 'red',
      icon: 'alert',
      title: `${returns.short_missing} return flagged for short / missing material`,
      body: 'Owners & VP have been flagged. Close the reconciliation with remarks.',
      to: '/returns',
    });
  }
  if (stock.below_min > 0) {
    alerts.push({
      tone: 'amber',
      icon: 'bell',
      title: `${stock.below_min} item${stock.below_min > 1 ? 's' : ''} below the minimum alert quantity`,
      body: 'Review reorder levels before the next dispatch.',
      to: '/stock',
    });
  }

  return (
    <div className="stack">
      <div className="kpi-grid">
        <Kpi label="Live SKUs" value={stock.total} meta={`${stock.high_side} High Side · ${stock.low_side} Low Side`} icon="box" tone="blue" />
        <Kpi
          label="Minus stock"
          value={stock.negative}
          meta="Signed balances below zero"
          icon="alert"
          tone={stock.negative > 0 ? 'amber' : ''}
          tip="Minus-Stock Override: dispatch is never blocked when the store balance is short. The balance goes negative and is flagged amber until a purchase or return clears it."
        />
        <Kpi label="Open MRNs" value={mrn.pending + mrn.in_progress} meta={`${mrn.pending} pending approval · ${mrn.fulfilled} fulfilled`} icon="list" />
        <Kpi
          label="Challans in transit"
          value={challans.in_transit}
          meta={`${challans.signed} signed copies archived`}
          icon="truck"
          tip="48-Hr SLA: a dispatched challan must come back signed within 48 hours, otherwise it appears as a red alert on the dashboards."
        />
        <Kpi label="Open returns" value={returns.open} meta={`${returns.sla_breach} past the 48-hour SLA`} icon="return" tone={returns.sla_breach > 0 ? 'red' : ''} />
        {bills.pending !== null ? (
          <Kpi
            label="Pending vendor bills"
            value={bills.pending}
            meta={`${inr(bills.pending_value)} unbilled value`}
            icon="file"
            tone={bills.pending > 0 ? 'amber' : ''}
            tip="Bill Pending (Rate = 0): material can be received and stocked before the vendor invoice arrives."
          />
        ) : (
          <Kpi label="Open POs" value={po.open} meta={`${po.pending_approval} awaiting approval`} icon="file" />
        )}
      </div>

      <div className="grid-2">
        <div className="stack">
          <Card title="Needs attention" subtitle="Non-blocking flags raised by the workflow">
            {alerts.length ? (
              <div style={{ display: 'grid', gap: 10 }}>
                {alerts.map((a) => (
                  <div key={a.title} className={`alert alert-${a.tone}`}>
                    <Icon name={a.icon} size={16} />
                    <div>
                      <strong>{a.title}</strong>
                      <div className="small" style={{ marginTop: 2 }}>{a.body}</div>
                      {a.to ? (
                        <Link className="small" to={a.to} style={{ fontWeight: 650, textDecoration: 'underline' }}>
                          Open screen
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="check" title="Nothing urgent" description="No minus stock, no SLA breach and no short/missing returns right now." />
            )}
          </Card>

          <Card title="Store at a glance" subtitle="Two-ledger inventory position">
            <div className="kpi-grid" style={{ marginBottom: 0 }}>
              <Kpi label="Scrap quantity" value={qty(stock.scrap)} meta="Damaged / unusable material" icon="alert" />
              <Kpi label="Active sites" value={data.sites.active} meta={`${data.sites.total} total`} icon="pin" />
              <Kpi label="Active vendors" value={data.vendors.active} meta="Approved supplier list" icon="building" />
              <Kpi label="POs open" value={po.open} meta={`${po.pending_approval} awaiting approval`} icon="file" />
            </div>
          </Card>
        </div>

        <div className="stack">
          {has('audit.read') ? (
            <Card title="Recent activity" subtitle="Immutable audit trail">
              {recentActivity.length ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {recentActivity.map((a) => (
                    <div key={`${a.ts}-${a.action}`} className="small">
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <strong>{a.action.replaceAll('_', ' ')}</strong>
                        <span className="badge badge-neutral">{a.module}</span>
                        {a.emulated ? <span className="badge badge-amber">emulated</span> : null}
                      </div>
                      <div className="muted">
                        {a.actor_name || 'System'} · {fmtDateTime(a.ts)}
                      </div>
                      {a.remarks ? <div className="faint">{a.remarks}</div> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No activity yet" description="Actions will appear here as the team works." />
              )}
            </Card>
          ) : null}

          <Card title="Phase 1 complete" subtitle="What is live in this build">
            <ul className="small" style={{ margin: 0, paddingLeft: 18, color: 'var(--text-muted)', lineHeight: 1.9 }}>
              <li>MRN raise, split-panel approval and item-wise dispatch tracking</li>
              <li>Direct PO with optional approval, ₹0 rate and fixed terms</li>
              <li>3-scenario dispatch challans with atomic two-ledger posting</li>
              <li>Helper mobile PWA with signed DC upload and site archive</li>
              <li>Five-stage anti-leakage returns with usable / scrap / short gate</li>
              <li>Five executive dashboards, 48-hour SLA alerts and the API hub</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
