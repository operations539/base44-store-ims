import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Icon } from '../ui.jsx';

const DEMO_PASSWORD = 'Koolmart@123';

const DEMO_USERS = [
  ['aniket@koolmart.in', 'Aniket Deshpande', 'MIS & System Builder'],
  ['parul@koolmart.in', 'Parul Kool', 'Owners & VP'],
  ['arun@koolmart.in', 'Arun Nair', 'Store Manager'],
  ['prashant@koolmart.in', 'Prashant Jadhav', 'Store Executive'],
  ['ravi@koolmart.in', 'Ravi Kumar', 'Store Helper (mobile)'],
  ['suresh@koolmart.in', 'Suresh Patil', 'Site Supervisor (mobile)'],
];

const ERRORS = {
  not_invited: 'That Google account is not invited. Ask the administrator to add you.',
  inactive: 'That account is deactivated.',
  google_not_configured: 'Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
  google_state: 'The Google sign-in attempt expired. Please try again.',
  google_token: 'Google did not return a valid token. Please try again.',
  google_profile: 'Google did not return a profile for that account.',
  google_failed: 'Google sign-in failed. Please try again.',
};

export default function Login() {
  const { login, googleEnabled } = useAuth();
  const [params] = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showDemo, setShowDemo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(ERRORS[params.get('error')] || '');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(identifier, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-brand">
        <div className="brand-line">
          <div className="brand-mark" style={{ width: 40, height: 40, flexBasis: 40, fontSize: 17 }}>KM</div>
          <div>
            <div style={{ fontWeight: 700, letterSpacing: '0.02em' }}>KOOL MART INDIA</div>
            <div style={{ color: '#93c5fd', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              Store Inventory Management
            </div>
          </div>
        </div>

        <div>
          <h1>One control room for store stock, dispatch and site material.</h1>
          <p className="lead">
            Two-ledger inventory, rate-free challans, five-stage returns and signed DC control — built for
            warehouse daylight and site reality.
          </p>
        </div>

        <div className="login-points">
          {[
            'Live High Side & Low Side stock with minus-stock overrides',
            '3-scenario dispatch: full store, split and direct-to-site',
            'Five-stage return tracking with short/missing flags',
            'Role-locked access — helpers and supervisors never see rates',
          ].map((text) => (
            <div className="login-point" key={text}>
              <span className="tick">
                <Icon name="check" size={13} />
              </span>
              <span>{text}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <h2>Sign in</h2>
          <p className="sub">Invited users only. Public sign-up is disabled.</p>

          {error ? <div className="toast-error">{error}</div> : null}

          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="identifier">Email or username</label>
              <input
                id="identifier"
                className="input"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="you@koolmart.in"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="login-sep">or</div>

          <button
            type="button"
            className="btn btn-block"
            disabled={!googleEnabled}
            title={googleEnabled ? 'Sign in with Google' : 'Google sign-in needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET'}
            onClick={() => {
              window.location.href = '/api/auth/google/start';
            }}
          >
            <Icon name="lock" size={15} />
            {googleEnabled ? 'Continue with Google' : 'Google sign-in not configured'}
          </button>

          <div className="demo-box">
            <h4
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => setShowDemo((v) => !v)}
            >
              <Icon name={showDemo ? 'chevron' : 'chevron'} size={12} style={{ transform: showDemo ? 'rotate(90deg)' : 'none' }} />
              Demo logins (Layer 1 seed)
            </h4>
            {showDemo ? (
              <>
                <div className="demo-list">
                  {DEMO_USERS.map(([email, name, role]) => (
                    <div
                      key={email}
                      className="demo-user"
                      onClick={() => {
                        setIdentifier(email);
                        setPassword(DEMO_PASSWORD);
                        setError('');
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          setIdentifier(email);
                          setPassword(DEMO_PASSWORD);
                        }
                      }}
                    >
                      <strong>{name}</strong>
                      <span>{role}</span>
                    </div>
                  ))}
                </div>
                <div className="small muted" style={{ marginTop: 8 }}>
                  Shared password: <code>{DEMO_PASSWORD}</code>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
