require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

const { initDatabase } = require('./config/initDb');
const { initSuperAdminDb } = require('./config/initSuperAdminDb');
const { runBackup } = require('./utils/backup');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const staffRoutes = require('./routes/staff');
const candidateRoutes = require('./routes/candidate');
const certificateRoutes = require('./routes/certificate');
const objectionRoutes = require('./routes/objection');
const superadminRoutes = require('./routes/superadmin');
const { attachTraceId, notFoundHandler, errorHandler } = require('./middleware/errors');
const { globalLimiter, csrfGuard, issueCsrf } = require('./middleware/security');
const { processQueuedCertificateGeneration } = require('./utils/duplicateCertificate');
const { enqueue, runFallbackProcessor, hasRedis } = require('./utils/queue');
const { emit, captureMetric } = require('./utils/structuredLogger');
const { createWorkers, shutdownWorkers } = require('./utils/workerOrchestrator');
const opsRoutes = require('./routes/ops');

const app = express();

// Create required directories
const dirs = ['uploads/temp', 'uploads/verified', 'uploads/certificates', 'uploads/objection_docs', 'uploads/quarantine', 'backups'];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:'], scriptSrc: ["'self'"], scriptSrcAttr: ["'none'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'], reportUri: ['/api/ops/csp-report'] } },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(globalLimiter);
app.use(issueCsrf);
app.use(csrfGuard);
app.use(attachTraceId);

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.OTP_RATE_LIMIT_MAX || '6', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error_code: 'OTP_RATE_LIMITED',
    message: 'Too many OTP requests. Try again later.'
  }
});

// Super Admin hidden routes — declared BEFORE static middleware so the
// public/superadmin/ directory never causes a static redirect to /superadmin/
app.get('/superadmin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'superadmin', 'index.html')));
app.get('/superadmin/panel', (req, res) => res.sendFile(path.join(__dirname, 'public', 'superadmin', 'panel.html')));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/image', express.static(path.join(__dirname, 'public', 'image')));
app.use('/images', express.static(path.join(__dirname, 'public', 'image')));
app.use('/uploads', (req, res, next) => {
  if (req.path.includes('/temp/') || req.path.includes('/quarantine/')) return res.status(403).json({ success: false, message: 'Access denied' });
  next();
}, express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth/request-otp', otpLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/candidate', candidateRoutes);
app.use('/api/certificate', certificateRoutes);
app.use('/api/objection', objectionRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/ops', opsRoutes);

// Frontend routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.redirect('/admin/dashboard.html'));
app.get('/admin/:page', (req, res, next) => {
  const allowedPages = new Set([
    'dashboard.html',
    'applications.html',
    'cop.html',
    'renewals.html',
    'reissue.html',
    'verification.html',
    'objections.html',
    'imports.html',
    'certificates.html',
    'staff.html',
    'reports.html',
    'settings.html',
    'audit_logs.html'
  ]);
  if (!allowedPages.has(req.params.page)) return next();
  res.sendFile(path.join(__dirname, 'public', 'admin', req.params.page));
});
app.get('/staff', (req, res) => res.sendFile(path.join(__dirname, 'public', 'staff.html')));
app.get('/candidate', (req, res) => res.sendFile(path.join(__dirname, 'public', 'candidate.html')));

app.get('/healthz', async (req, res) => {
  const mem = process.memoryUsage();
  await captureMetric('runtime_memory', 'ok', { rss: mem.rss, heapUsed: mem.heapUsed }, req.traceId);
  res.status(200).json({ success: true, status: 'ok', trace_id: req.traceId, memory: { rss: mem.rss, heap_used: mem.heapUsed } });
});

app.post('/api/ops/csp-report', express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'] }), async (req, res) => {
  const report = req.body && (req.body['csp-report'] || req.body);
  await captureMetric('csp_violation', 'warn', { report }, req.traceId);
  emit('warn', 'security.csp.violation', { trace_id: req.traceId, report });
  res.status(204).end();
});

app.get('/readyz', async (req, res) => {
  const checks = { redis: hasRedis() ? 'configured' : 'disabled', db: 'unknown', storage: 'unknown' };
  try { await require('./config/db').query('SELECT 1'); checks.db = 'ready'; } catch (e) { checks.db = 'down'; }
  checks.storage = fs.existsSync('uploads') ? 'ready' : 'missing';
  const ok = checks.db === 'ready' && checks.storage === 'ready';
  res.status(ok ? 200 : 503).json({ success: ok, status: ok ? 'ready' : 'not_ready', checks, trace_id: req.traceId });
});

app.use(notFoundHandler);
app.use(errorHandler);

// Validate required environment variables before startup
const requiredEnv = ['JWT_SECRET'];
const missingEnv = requiredEnv.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
  console.error('❌ Missing required environment variables:', missingEnv.join(', '));
  process.exit(1);
}
if (process.env.DB_PASSWORD === 'yourpassword') {
  console.warn('⚠️  DB_PASSWORD is still set to the placeholder value. Update .env with your MySQL password or leave it blank if no password is used.');
}

// Initialize DB and start server
const PORT = process.env.PORT || 5000;
initDatabase().then(() => initSuperAdminDb()).then(() => {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Bar Council Portal running on http://0.0.0.0:${PORT}`);
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use. Stop the process using that port or set a different PORT in .env.`);
      process.exit(1);
    }
    throw err;
  });


  const role = process.env.PROCESS_ROLE || 'all';
  if (role === 'queue' || role === 'all') createWorkers();

  let shuttingDown = false;
  const gracefulShutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    emit('warn', 'shutdown.start', { reason: 'signal' });
    await shutdownWorkers();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000);
  };
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);

  // Queue workers (restart-safe fallback polling processor)
  cron.schedule('*/1 * * * *', async () => {
    try {
      await processQueuedCertificateGeneration(5);
      await runFallbackProcessor({
        certificate_generation: async payload => {
          if (payload && payload.duplicate_request_id) await processQueuedCertificateGeneration(5);
        },
        notifications: async payload => emit('info', 'notification.dispatched', payload),
        communication: async payload => emit('info', 'communication.dispatched', payload),
        report_generation: async payload => emit('info', 'report.generated', payload),
        audit_exports: async payload => emit('info', 'audit.exported', payload),
        otp_retries: async payload => emit('info', 'otp.retry', payload),
        bulk_uploads: async payload => emit('info', 'bulk.upload', payload),
        duplicate_processing: async payload => emit('info', 'duplicate.processing', payload),
        malware_scan: async payload => emit('info', 'malware.scan.fallback', payload),
        cleanup: async payload => emit('info', 'cleanup.run', payload)
      });
    } catch (e) {
      await captureMetric('worker_crash', 'error', { error: e.message });
      console.error('[queue-worker]', e.message);
    }
  });

  // Daily backup at 2 AM
  cron.schedule('0 2 * * *', () => {
    console.log('Running daily backup...');
    runBackup();
  });
}).catch(err => {
  console.error('❌ DB Init failed:', err);
  process.exit(1);
});
