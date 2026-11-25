import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { MOBILE_ROLES, homeFor, useAuth } from './auth.jsx';
import { Spinner } from './ui.jsx';
import Shell from './layout/Shell.jsx';
import MobileShell from './layout/MobileShell.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Stock from './pages/Stock.jsx';
import Items from './pages/Items.jsx';
import Sites from './pages/Sites.jsx';
import Vendors from './pages/Vendors.jsx';
import AuditLogs from './pages/AuditLogs.jsx';
import Users from './pages/admin/Users.jsx';
import Import from './pages/admin/Import.jsx';
import DemoData from './pages/admin/DemoData.jsx';
import Packing from './pages/mobile/Packing.jsx';
import Scan from './pages/mobile/Scan.jsx';
import Requests from './pages/mobile/Requests.jsx';
import Returns from './pages/mobile/Returns.jsx';
import Tracking from './pages/mobile/Tracking.jsx';
import { AccessDenied, NotFound } from './pages/Errors.jsx';

function AuthGate({ children }) {
  const { loading, user } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Loading workspace…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function PermissionGate({ perm, children }) {
  const { has } = useAuth();
  if (perm && !has(perm)) return <AccessDenied />;
  return children;
}

function DesktopArea() {
  const { user } = useAuth();
  if (MOBILE_ROLES.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return <Shell />;
}

function MobileArea() {
  const { user } = useAuth();
  if (!MOBILE_ROLES.includes(user.role)) return <Navigate to="/" replace />;
  return <MobileShell />;
}

function MobileIndex() {
  const { user } = useAuth();
  return <Navigate to={homeFor(user.role).replace('/m/', '')} replace />;
}

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={homeFor(user.role)} replace /> : <Login />} />

      <Route
        element={
          <AuthGate>
            <DesktopArea />
          </AuthGate>
        }
      >
        <Route index element={<Dashboard />} />
        <Route
          path="stock"
          element={
            <PermissionGate perm="stock.read">
              <Stock />
            </PermissionGate>
          }
        />
        <Route
          path="masters/items"
          element={
            <PermissionGate perm="masters.read">
              <Items />
            </PermissionGate>
          }
        />
        <Route
          path="masters/sites"
          element={
            <PermissionGate perm="masters.read">
              <Sites />
            </PermissionGate>
          }
        />
        <Route
          path="masters/vendors"
          element={
            <PermissionGate perm="masters.read">
              <Vendors />
            </PermissionGate>
          }
        />
        <Route
          path="audit"
          element={
            <PermissionGate perm="audit.read">
              <AuditLogs />
            </PermissionGate>
          }
        />
        <Route
          path="admin/users"
          element={
            <PermissionGate perm="admin.manage">
              <Users />
            </PermissionGate>
          }
        />
        <Route
          path="admin/import"
          element={
            <PermissionGate perm="import.manage">
              <Import />
            </PermissionGate>
          }
        />
        <Route
          path="admin/data"
          element={
            <PermissionGate perm="demo.reset">
              <DemoData />
            </PermissionGate>
          }
        />
        <Route path="access-denied" element={<AccessDenied />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route
        path="/m"
        element={
          <AuthGate>
            <MobileArea />
          </AuthGate>
        }
      >
        <Route index element={<MobileIndex />} />
        <Route path="packing" element={<Packing />} />
        <Route path="scan" element={<Scan />} />
        <Route path="requests" element={<Requests />} />
        <Route path="returns" element={<Returns />} />
        <Route path="tracking" element={<Tracking />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
