import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Icon } from '../ui.jsx';
import Tip from '../components/Tip.jsx';
import Overview from './dashboards/Overview.jsx';
import MrnTracker from './dashboards/MrnTracker.jsx';
import ChallanArchive from './dashboards/ChallanArchive.jsx';
import ReturnMonitor from './dashboards/ReturnMonitor.jsx';
import StockPosition from './dashboards/StockPosition.jsx';
import ScrapBills from './dashboards/ScrapBills.jsx';

const TABS = [
  { key: 'overview', label: 'Overview', Component: Overview },
  { key: 'mrn', label: 'MRN Tracker', Component: MrnTracker },
  { key: 'challans', label: 'Challans & Signed DC', Component: ChallanArchive },
  { key: 'returns', label: 'Returns & 48-Hr SLA', Component: ReturnMonitor },
  { key: 'stock', label: 'Stock & Site Ledger', Component: StockPosition },
  { key: 'scrap', label: 'Scrap & Vendor Bills', Component: ScrapBills },
];

const QUICK_ACTIONS = [
  { perm: 'mrn.create', to: '/mrn/new', label: 'Raise MRN', icon: 'plus' },
  { perm: 'po.create', to: '/pos', label: 'New Direct PO', icon: 'building' },
  { perm: 'challan.create', to: '/challans', label: 'New Dispatch', icon: 'truck' },
  { perm: 'returns.read', to: '/returns', label: 'Returns', icon: 'return' },
  { perm: 'purchase.create', to: '/purchasing', label: 'Purchasing', icon: 'download' },
  { perm: 'admin.manage', to: '/admin/users', label: 'Admin Panel', icon: 'users' },
];

export default function Dashboard() {
  const { user, has } = useAuth();
  const [active, setActive] = useState('overview');

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const Current = TABS.find((t) => t.key === active)?.Component || Overview;
  const actions = QUICK_ACTIONS.filter((a) => has(a.perm));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            {greeting}, {user.full_name.split(' ')[0]}
          </h1>
          <p>
            {user.roleLabel} view · live store and site position
            <Tip text="Five live views: MRN delivery, challan signed-DC archive, returns and SLA, stock and site ledger, scrap and vendor bills. Each exports to CSV or PDF." />
          </p>
        </div>
      </div>

      {actions.length ? (
        <div className="quick-actions" aria-label="Quick actions">
          {actions.map((a) => (
            <Link key={a.to + a.label} className="qa" to={a.to}>
              <Icon name={a.icon} size={15} /> {a.label}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="tabs" role="tablist" aria-label="Dashboard views">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            className={`tab ${active === t.key ? 'active' : ''}`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        <Current />
      </div>
    </div>
  );
}
