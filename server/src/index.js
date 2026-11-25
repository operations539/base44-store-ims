import express from 'express';
import cookieParser from 'cookie-parser';
import { attachSession } from './auth.js';
import { HttpError } from './util.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import masterRoutes from './routes/masters.js';
import importRoutes from './routes/imports.js';
import adminRoutes from './routes/admin.js';
import dashboardRoutes from './routes/dashboard.js';
import mobileRoutes from './routes/mobile.js';
import auditRoutes from './routes/audit.js';
import mrnRoutes from './routes/mrn.js';
import poRoutes from './routes/pos.js';
import challanRoutes from './routes/challans.js';
import purchasingRoutes from './routes/purchasing.js';
import ledgerRoutes from './routes/ledger.js';
import fileRoutes from './routes/files.js';
import returnRoutes from './routes/returns.js';
import adminSettingsRoutes from './routes/adminSettings.js';
import apiHubRoutes from './routes/apiHub.js';
import { startSlaScanner } from './sla.js';

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

app.use(express.json({ limit: '6mb' }));
app.use(cookieParser());
app.use(attachSession);

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'store-ims-api' }));

app.use('/api/auth', authRoutes);
app.use('/api/admin', userRoutes);
app.use('/api/admin', importRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', masterRoutes);
app.use('/api', dashboardRoutes);
app.use('/api', mrnRoutes);
app.use('/api', poRoutes);
app.use('/api', challanRoutes);
app.use('/api', purchasingRoutes);
app.use('/api', ledgerRoutes);
app.use('/api', fileRoutes);
app.use('/api/mobile', mobileRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api', returnRoutes);
app.use('/api/admin', adminSettingsRoutes);
app.use('/api/v1', apiHubRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, fields: err.fields || null });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Upload is too large.' });
  }
  console.error('[api] unhandled', err);
  return res.status(500).json({ error: 'Something went wrong on our side.' });
});

const port = Number(process.env.PORT || 8000);
app.listen(port, '0.0.0.0', () => {
  console.log(`[api] KoolMart Store IMS listening on ${port}`);
  startSlaScanner();
});
