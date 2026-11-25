import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { get } from '../api.js';
import { Icon, initials } from '../ui.jsx';
import { applyTheme, getTheme } from '../theme.js';

const MODULES = [
  { name: 'Store IMS', active: true },
  { name: 'Sales' },
  { name: 'Design' },
  { name: 'Project' },
  { name: 'Service' },
  { name: 'Accounts' },
  { name: 'HR' },
];

function Overlay({ onClose }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 55 }}
      onMouseDown={onClose}
      aria-hidden="true"
    />
  );
}

function Notifications({ onClose }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/notifications')
      .then((data) => setItems(data.notifications || []))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <>
      <Overlay onClose={onClose} />
      <div className="popover" style={{ width: 360 }}>
        <h4>Notifications</h4>
        {error ? <div className="alert alert-red">{error}</div> : null}
        {!items && !error ? <div className="muted small">Loading…</div> : null}
        {items && !items.length ? <div className="muted small">No notifications yet.</div> : null}
        <div style={{ display: 'grid', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
          {items?.map((n) => (
            <div key={n.id} className="alert" style={{ alignItems: 'flex-start' }}>
              <Icon
                name={n.severity === 'critical' ? 'alert' : n.severity === 'warning' ? 'bell' : 'check'}
                size={15}
              />
              <div>
                <strong>{n.title}</strong>
                {n.body ? <div className="small muted" style={{ marginTop: 2 }}>{n.body}</div> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function EmulationBanner() {
  const { emulated, user, actor, exitEmulation } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!emulated) return null;

  return (
    <div className="emulation-banner">
      <Icon name="eye" size={15} />
      <span>
        Viewing as <strong>{user.full_name}</strong> ({user.roleLabel}) — signed in as {actor.full_name}
      </span>
      <span className="spacer" />
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await exitEmulation();
          } finally {
            setBusy(false);
          }
        }}
      >
        Exit
      </button>
    </div>
  );
}

export default function Shell() {
  const { user, actor, nav, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('km_sidebar') === '1');
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(null); // 'modules' | 'user' | 'bell'
  const [theme, setTheme] = useState(getTheme());
  const [unread, setUnread] = useState(0);
  const firstLoad = useRef(true);

  useEffect(() => {
    setDrawer(false);
    setMenu(null);
  }, [location.pathname]);

  useEffect(() => {
    get('/notifications')
      .then((d) => setUnread(d.unread || 0))
      .catch(() => {});
  }, [location.pathname]);

  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    applyTheme(theme);
  }, [theme]);

  const toggleSidebar = () => {
    if (window.innerWidth < 900) {
      setDrawer((v) => !v);
    } else {
      setCollapsed((v) => {
        localStorage.setItem('km_sidebar', v ? '0' : '1');
        return !v;
      });
    }
  };

  const flatNav = nav.flatMap((n) => (n.group ? n.items : [n]));
  const activeItem = flatNav.find((n) => n.to === location.pathname);
  const title = activeItem?.label || 'KoolMart Store IMS';

  return (
    <div className="shell">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${drawer ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">KM</div>
          <div className="brand-text">
            <strong>KoolMart</strong>
            <span>Store IMS</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {nav.map((item, idx) =>
            item.group ? (
              <div key={item.group || idx}>
                <div className="nav-group-label">{item.group}</div>
                {item.items.map((child) => (
                  <NavLink
                    key={child.to}
                    to={child.to}
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    title={child.label}
                  >
                    <Icon name={child.icon} size={17} />
                    <span>{child.label}</span>
                  </NavLink>
                ))}
              </div>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                title={item.label}
              >
                <Icon name={item.icon} size={17} />
                <span>{item.label}</span>
              </NavLink>
            )
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="avatar">{initials(user.full_name)}</div>
          <div className="sidebar-footer-text">
            <strong>{user.full_name}</strong>
            <span>{user.roleLabel}</span>
          </div>
        </div>
      </aside>

      <div className="main-col">
        <EmulationBanner />

        <header className="topbar">
          <button type="button" className="icon-btn" onClick={toggleSidebar} aria-label="Toggle navigation">
            <Icon name="menu" />
          </button>
          <div className="topbar-title">
            <strong>{title}</strong>
            <span>
              Kool Mart India · {user.roleTag}
              {user.employee_id ? ` · ${user.employee_id}` : ''}
            </span>
          </div>
          <div className="topbar-spacer" />

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMenu(menu === 'modules' ? null : 'modules')}
              aria-label="Kool Mart modules"
              title="Kool Mart modules"
            >
              <Icon name="dots" />
            </button>
            {menu === 'modules' ? (
              <>
                <Overlay onClose={() => setMenu(null)} />
                <div className="popover">
                  <h4>Kool Mart Modules</h4>
                  <div className="modules-grid">
                    {MODULES.map((m) => (
                      <div key={m.name} className={`module-tile ${m.active ? 'active' : ''}`}>
                        <Icon name={m.active ? 'box' : 'lock'} size={17} />
                        <span>{m.name}</span>
                        <span className="soon">{m.active ? 'Active' : 'Coming soon'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <button
            type="button"
            className="icon-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle dark mode"
            title="Toggle dark mode"
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMenu(menu === 'bell' ? null : 'bell')}
              aria-label="Notifications"
            >
              <Icon name="bell" />
              {unread > 0 ? <span className="count">{unread}</span> : null}
            </button>
            {menu === 'bell' ? <Notifications onClose={() => setMenu(null)} /> : null}
          </div>

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMenu(menu === 'user' ? null : 'user')}
              aria-label="Account menu"
            >
              <span className="avatar" style={{ width: 30, height: 30, flexBasis: 30, background: 'var(--primary-soft)', color: 'var(--primary-600)', borderColor: 'transparent' }}>
                {initials(user.full_name)}
              </span>
            </button>
            {menu === 'user' ? (
              <>
                <Overlay onClose={() => setMenu(null)} />
                <div className="popover" style={{ width: 260 }}>
                  <div style={{ marginBottom: 10 }}>
                    <strong>{user.full_name}</strong>
                    <div className="small muted">{user.email}</div>
                    <div className="small muted">
                      {user.roleLabel}
                      {user.department_code ? ` · ${user.department_code}` : ''}
                    </div>
                  </div>
                  <div className="divider" />
                  <button
                    type="button"
                    className="btn btn-block"
                    onClick={async () => {
                      await logout();
                      navigate('/login', { replace: true });
                    }}
                  >
                    <Icon name="logout" size={15} /> Sign out
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </header>

        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
