const passport = require('passport');
const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');
const { Strategy: LocalStrategy } = require('passport-local');
const bcrypt = require('bcryptjs');
const { prisma } = require('../utils/database');

// ── JWT ────────────────────────────────────────────────────────────────────────
passport.use(new JwtStrategy({
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET || 'awibi-secret',
}, async (payload, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    return user ? done(null, user) : done(null, false);
  } catch (e) { return done(e, false); }
}));

// ── Local (email + password) ───────────────────────────────────────────────────
passport.use('local', new LocalStrategy({ usernameField: 'email', passwordField: 'password' },
  async (email, password, done) => {
    try {
      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      if (!user || !user.passwordHash) return done(null, false, { message: 'Invalid credentials' });
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return done(null, false, { message: 'Invalid credentials' });
      if (!user.isActive) return done(null, false, { message: 'Account deactivated' });
      return done(null, user);
    } catch (e) { return done(e); }
  }
));

// ── Staff ID login ─────────────────────────────────────────────────────────────
passport.use('staff-local', new LocalStrategy({ usernameField: 'staffId', passwordField: 'password' },
  async (staffId, password, done) => {
    try {
      const user = staffId ? await prisma.user.findUnique({ where: { staffId } }) : null;
      if (!user || !user.passwordHash) return done(null, false, { message: 'Invalid Staff ID or password' });
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return done(null, false, { message: 'Invalid Staff ID or password' });
      if (!user.isActive) return done(null, false, { message: 'Account deactivated' });
      if (!user.facilityId) return done(null, false, { message: 'You are not assigned to a facility — contact admin' });
      return done(null, user);
    } catch (e) { return done(e); }
  }
));

// ── Google OAuth ───────────────────────────────────────────────────────────────
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:8000/v1/auth/google/callback',
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      if (!email) return done(null, false, { message: 'No email from Google' });

      let user = await prisma.user.findFirst({ where: { googleId: profile.id } });
      if (!user) user = await prisma.user.findUnique({ where: { email } });

      if (user) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { googleId: profile.id, emailVerified: true },
        });
      } else {
        user = await prisma.user.create({
          data: {
            firstName: profile.name?.givenName || 'New',
            lastName: profile.name?.familyName || 'User',
            email,
            googleId: profile.id,
            emailVerified: true,
            role: 'ADMIN',
            avatar: profile.photos?.[0]?.value,
          },
        });
      }
      return done(null, user);
    } catch (e) { return done(e); }
  }));
} else {
  console.warn('⚠️   Google OAuth not configured. Add GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET to .env');
  console.warn('    Get free credentials at: console.cloud.google.com → APIs & Services → Credentials');
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = await prisma.user.findUnique({ where: { id } });
  done(null, user);
});

module.exports = passport;
