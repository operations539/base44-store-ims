import { Link } from 'react-router-dom';
import { useAuth, homeFor } from '../auth.jsx';
import { Icon } from '../ui.jsx';

export function AccessDenied() {
  const { user } = useAuth();
  return (
    <div className="page">
      <div className="card" style={{ maxWidth: 560, margin: '48px auto' }}>
        <div className="card-body" style={{ textAlign: 'center', padding: '38px 26px' }}>
          <div className="empty icon-wrap" style={{ margin: '0 auto 12px', width: 52, height: 52 }}>
            <Icon name="lock" size={24} />
          </div>
          <h2 style={{ fontSize: 18, marginBottom: 6 }}>Access denied</h2>
          <p className="muted" style={{ fontSize: 13, margin: '0 0 18px' }}>
            Your role ({user?.roleLabel}) does not include this screen. Menus are hidden by role and every
            request is checked again on the server.
          </p>
          <Link className="btn btn-primary" to={homeFor(user?.role)}>
            Back to my workspace
          </Link>
        </div>
      </div>
    </div>
  );
}

export function NotFound() {
  const { user } = useAuth();
  return (
    <div className="page">
      <div className="card" style={{ maxWidth: 560, margin: '48px auto' }}>
        <div className="card-body" style={{ textAlign: 'center', padding: '38px 26px' }}>
          <div className="empty icon-wrap" style={{ margin: '0 auto 12px', width: 52, height: 52 }}>
            <Icon name="file" size={24} />
          </div>
          <h2 style={{ fontSize: 18, marginBottom: 6 }}>Page not found</h2>
          <p className="muted" style={{ fontSize: 13, margin: '0 0 18px' }}>
            That page does not exist in Store IMS.
          </p>
          <Link className="btn btn-primary" to={user ? homeFor(user.role) : '/login'}>
            Go back
          </Link>
        </div>
      </div>
    </div>
  );
}
