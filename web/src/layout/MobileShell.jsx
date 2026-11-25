import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Icon, initials } from '../ui.jsx';
import { EmulationBanner } from './Shell.jsx';

export default function MobileShell() {
  const { user, nav, mobileNav, logout } = useAuth();
  const tabs = mobileNav?.length ? mobileNav : nav;
  const navigate = useNavigate();

  return (
    <div className="mobile-shell">
      <EmulationBanner />

      <header className="mobile-topbar">
        <div className="brand-mark">KM</div>
        <div style={{ minWidth: 0 }}>
          <strong>KoolMart Store IMS</strong>
          <span>{user.roleLabel}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="avatar" style={{ width: 30, height: 30, flexBasis: 30 }}>
            {initials(user.full_name)}
          </span>
          <button
            type="button"
            className="icon-btn"
            style={{ color: '#dbe4f7' }}
            aria-label="Sign out"
            onClick={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            <Icon name="logout" />
          </button>
        </div>
      </header>

      <main className="mobile-body">
        <Outlet />
      </main>

      <nav className="mobile-tabs" style={{ gridTemplateColumns: `repeat(${tabs.length || 1}, 1fr)` }}>
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => `mobile-tab ${isActive ? 'active' : ''}`}
          >
            <Icon name={tab.icon} size={20} />
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
