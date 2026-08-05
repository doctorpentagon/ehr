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

const origins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:5173').split(',').map(s => s.trim());
const corsOptions = {
  origin: process.env.NODE_ENV === 'development'
    ? (origin, cb) => cb(null, true) // allow all in dev
    : (origin, cb) => (!origin || origins.includes(origin) ? cb(null, true) : cb(new Error('CORS'))),
  credentials: true,
};
app.use(cors(corsOptions));

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
