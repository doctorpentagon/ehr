require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const passport = require('./config/passport');
const routes = require('./routes');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const app = express();

// Trust proxy (for rate limiting behind Nginx/Railway/etc.)
app.set('trust proxy', 1);

// ── Security ────────────────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

/**
 * Which front-ends may call this API.
 *
 * Accepts either variable name: ALLOWED_ORIGINS is what this has always read,
 * CORS_ORIGIN is what most hosting dashboards and our own .env.example call it.
 * Honouring both costs nothing and removes a failure that is genuinely hard to
 * diagnose — a browser reports it as a network error with no clue that the
 * server simply did not recognise the name of the setting.
 *
 * Trailing slashes are stripped because an origin has no path, and pasting a
 * site URL from the address bar almost always brings one along.
 */
const CORS_DEFAULTS = 'http://localhost:3000,http://localhost:5173,http://localhost:5177';
const origins = (process.env.CORS_ORIGIN || process.env.ALLOWED_ORIGINS || CORS_DEFAULTS)
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    // No origin: same-origin requests, curl, health checks.
    if (!origin) return cb(null, true);
    if (process.env.NODE_ENV === 'development') return cb(null, true);
    if (origins.includes(origin.replace(/\/+$/, ''))) return cb(null, true);
    // Refuse by omitting the header rather than throwing. Throwing turned every
    // rejected request into a 500, so a misconfigured origin looked like the
    // server was broken — including on endpoints that were working perfectly.
    return cb(null, false);
  },
  credentials: true,
};
app.use(cors(corsOptions));

if (process.env.NODE_ENV === 'production') {
  console.log(`  CORS allows: ${origins.join(', ')}`);
}

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } }));

// ── Parsers ─────────────────────────────────────────────────────────────────
// Note: Paystack webhook needs raw body — mount before json()
app.use('/v1/billing/paystack-webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Logging ─────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// ── Passport ────────────────────────────────────────────────────────────────
app.use(passport.initialize());

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/v1', routes);

// ── Swagger (dev) ───────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  try {
    const swaggerJsdoc = require('swagger-jsdoc');
    const swaggerUi = require('swagger-ui-express');
    const spec = swaggerJsdoc({
      definition: { openapi: '3.0.0', info: { title: 'AwibiEHR API', version: '2.0.0' }, servers: [{ url: '/v1' }] },
      apis: ['./src/routes/*.js'],
    });
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec));
    console.log('📖  Swagger UI at http://localhost:' + (process.env.PORT || 8000) + '/api-docs');
  } catch (_) {}
}

// ── Error handling ──────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
