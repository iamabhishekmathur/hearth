import { Router } from 'express';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { env } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimit } from '../middleware/rate-limiter.js';
import { setCsrfCookie } from '../middleware/csrf.js';
import * as authService from '../services/auth-service.js';
import { sanitizeUser } from '../services/user-service.js';
import * as ssoService from '../services/sso-service.js';
import { logger } from '../lib/logger.js';

// ──────────────────────────────────────────────
// Passport configuration
// ──────────────────────────────────────────────

passport.serializeUser((user, done) => {
  done(null, (user as { id: string }).id);
});

passport.deserializeUser((id: string, done) => {
  // Deserialization is handled by attachUser middleware, not here.
  // We just pass the id through so it's available on session.
  done(null, { id } as Express.User);
});

// Local strategy (email + password)
passport.use(
  new LocalStrategy(
    { usernameField: 'email', passwordField: 'password' },
    async (email, password, done) => {
      try {
        const user = await authService.validateCredentials(email, password);
        if (!user) {
          return done(null, false, { message: 'Invalid email or password' });
        }
        return done(null, user as unknown as Express.User);
      } catch (err) {
        return done(err);
      }
    },
  ),
);

// Google OAuth strategy (only if configured)
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackURL: env.GOOGLE_CALLBACK_URL,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error('No email from Google profile'));
          }
          const user = await authService.findOrCreateOAuthUser({
            provider: 'google',
            email,
            name: profile.displayName || email,
          });
          return done(null, user as unknown as Express.User);
        } catch (err) {
          return done(err as Error);
        }
      },
    ),
  );
}

// ──────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────

const router: ReturnType<typeof Router> = Router();

/**
 * POST /register — email + password registration
 */
router.post('/register', authRateLimit, async (req, res, next) => {
  try {
    const { email, password, name } = req.body as {
      email?: string;
      password?: string;
      name?: string;
    };

    if (!email || !password || !name) {
      res.status(400).json({ error: 'email, password, and name are required' });
      return;
    }

    const user = await authService.register(email, password, name);

    // Create session
    req.session.userId = user.id;
    const isSecure = env.NODE_ENV === 'production';
    setCsrfCookie(res, isSecure);

    res.status(201).json({ data: sanitizeUser(user) });
  } catch (err) {
    if ((err as Error).message === 'Email already registered') {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }
    next(err);
  }
});

/**
 * POST /login — email + password login via passport-local
 */
router.post('/login', authRateLimit, (req, res, next) => {
  passport.authenticate(
    'local',
    (err: Error | null, user: Express.User | false, info: { message?: string } | undefined) => {
      if (err) return next(err);
      if (!user) {
        res.status(401).json({ error: info?.message || 'Invalid credentials' });
        return;
      }

      req.logIn(user, (loginErr) => {
        if (loginErr) return next(loginErr);

        req.session.userId = user.id;
        const isSecure = env.NODE_ENV === 'production';
        setCsrfCookie(res, isSecure);

        res.json({ data: { id: user.id }, message: 'Logged in' });
      });
    },
  )(req, res, next);
});

/**
 * POST /logout — destroy session
 */
router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy((destroyErr) => {
      if (destroyErr) {
        logger.error({ err: destroyErr }, 'Session destroy failed');
      }
      res.clearCookie('hearth.sid');
      res.clearCookie('hearth.csrf');
      res.json({ message: 'Logged out' });
    });
  });
});

/**
 * GET /me — current user info (requires auth)
 */
router.get('/me', requireAuth, (req, res) => {
  res.json({ data: req.user });
});

/**
 * GET /oauth/google — initiate Google OAuth
 */
router.get(
  '/oauth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] }),
);

/**
 * GET /oauth/google/callback — Google OAuth callback
 */
router.get('/oauth/google/callback', (req, res, next) => {
  passport.authenticate('google', (err: Error | null, user: Express.User | false) => {
    if (err) return next(err);
    if (!user) {
      res.redirect(`${env.WEB_URL}/login?error=oauth_failed`);
      return;
    }

    req.logIn(user, (loginErr) => {
      if (loginErr) return next(loginErr);

      req.session.userId = user.id;
      const isSecure = env.NODE_ENV === 'production';
      setCsrfCookie(res, isSecure);

      res.redirect(`${env.WEB_URL}/`);
    });
  })(req, res, next);
});

/**
 * POST /sso/callback — SSO callback for SAML/OIDC
 *
 * In production, SAML assertions must be cryptographically verified before
 * calling this endpoint (via @node-saml/passport-saml middleware). OIDC
 * tokens must be validated against the discovery document. This endpoint
 * handles the JIT provisioning flow once the IdP has been verified.
 */
router.post('/sso/callback', authRateLimit, async (req, res, next) => {
  try {
    const { orgSlug, email, name } = req.body as {
      orgSlug?: string;
      email?: string;
      name?: string;
    };

    if (!orgSlug || !email || !name) {
      res.status(400).json({ error: 'orgSlug, email, and name are required' });
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email) || email.length > 254) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    // Validate name length
    if (name.length > 200) {
      res.status(400).json({ error: 'Name too long' });
      return;
    }

    // Validate orgSlug format
    if (!/^[a-z0-9-]+$/.test(orgSlug) || orgSlug.length > 100) {
      res.status(400).json({ error: 'Invalid organization slug' });
      return;
    }

    const orgConfig = await ssoService.getSSOConfigBySlug(orgSlug);
    if (!orgConfig) {
      res.status(404).json({ error: 'SSO not configured for this organization' });
      return;
    }

    const user = await ssoService.findOrCreateSSOUser(orgConfig.orgId, {
      email,
      name,
      provider: orgConfig.config.type,
    });

    req.session.userId = user.id;
    const isSecure = env.NODE_ENV === 'production';
    setCsrfCookie(res, isSecure);

    res.json({ data: sanitizeUser(user), message: 'SSO login successful' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /sso/check/:slug — check if SSO is configured for an org
 */
router.get('/sso/check/:slug', async (req, res, next) => {
  try {
    const config = await ssoService.getSSOConfigBySlug(req.params.slug as string);
    res.json({
      data: {
        enabled: !!config,
        type: config?.config.type ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
