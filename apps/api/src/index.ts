import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import passport from 'passport';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { env } from './config.js';
import { logger } from './lib/logger.js';
import { requestId } from './middleware/request-id.js';
import { attachUser } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler } from './middleware/error-handler.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import chatRouter from './routes/chat.js';
import artifactRouter from './routes/artifacts.js';
import skillsRouter from './routes/skills.js';
import integrationsRouter from './routes/admin/integrations.js';
import auditLogsRouter from './routes/admin/audit-logs.js';
import setupRouter from './routes/admin/setup.js';
import memoryRouter from './routes/memory.js';
import identityRouter from './routes/identity.js';
import sharingRouter from './routes/sharing.js';
import tasksRouter from './routes/tasks.js';
import ssoAdminRouter from './routes/admin/sso.js';
import adminUsersRouter from './routes/admin/users.js';
import adminTeamsRouter from './routes/admin/teams.js';
import adminAnalyticsRouter from './routes/admin/analytics.js';
import adminLlmConfigRouter from './routes/admin/llm-config.js';
import adminComplianceRouter from './routes/admin/compliance.js';
import adminGovernanceRouter from './routes/admin/governance.js';
import adminCognitiveRouter from './routes/admin/cognitive.js';
import routinesRouter from './routes/routines.js';
import chainsRouter from './routes/chains.js';
import approvalsRouter from './routes/approvals.js';
import adminRoutinesRouter from './routes/admin/routines.js';
import webhookIngestRouter from './routes/webhooks/ingest.js';
import slackWebhookRouter from './routes/webhooks/slack.js';
import slackOAuthRouter from './routes/auth-slack-oauth.js';
import intakeRouter from './routes/intake.js';
import recommendationsRouter from './routes/recommendations.js';
import activityRouter from './routes/activity.js';
import uploadsRouter from './routes/uploads.js';
import decisionsRouter from './routes/decisions.js';
import meetingsRouter from './routes/meetings.js';
import { requestLogger } from './middleware/request-logger.js';
import { setupSocketManager } from './ws/socket-manager.js';
import { loadProviders } from './llm/provider-loader.js';
import { bootstrapIntegrations } from './mcp/bootstrap.js';
import { requestContextMiddleware } from './middleware/request-context.js';
import { bootstrapCompliance } from './compliance/bootstrap.js';

const app: Express = express();
const httpServer = createServer(app);

// Trust first proxy hop (nginx in docker-compose) so req.ip reflects real client
app.set('trust proxy', 1);

// Socket.io
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: env.WEB_URL,
    credentials: true,
  },
  path: '/ws',
});

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: env.WEB_URL,
    credentials: true,
  }),
);
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(requestId);
app.use(requestLogger);

// Session (PostgreSQL-backed via connect-pg-simple) — shared with Socket.io
const PgStore = connectPgSimple(session);
const sessionMiddleware = session({
  store: new PgStore({
    conString: env.DATABASE_URL,
    createTableIfMissing: true,
  }),
  name: 'hearth.sid',
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
});
app.use(sessionMiddleware);

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Attach user from session (optional — does not require auth)
app.use(attachUser);

// CSRF protection for state-changing requests
app.use(csrfProtection);

// Request context (AsyncLocalStorage) — must run after auth so req.user is available
app.use(requestContextMiddleware);

// Routes
app.use('/api/v1', healthRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/chat', chatRouter);
app.use('/api/v1/chat', artifactRouter);
app.use('/api/v1/skills', skillsRouter);
app.use('/api/v1/admin/integrations', integrationsRouter);
app.use('/api/v1/admin/audit-logs', auditLogsRouter);
app.use('/api/v1/admin/setup', setupRouter);
app.use('/api/v1/memory', memoryRouter);
app.use('/api/v1/identity', identityRouter);
app.use('/api/v1', sharingRouter);
app.use('/api/v1/tasks', tasksRouter);
app.use('/api/v1/admin/sso', ssoAdminRouter);
app.use('/api/v1/admin/users', adminUsersRouter);
app.use('/api/v1/admin/teams', adminTeamsRouter);
app.use('/api/v1/admin/analytics', adminAnalyticsRouter);
app.use('/api/v1/admin/llm-config', adminLlmConfigRouter);
app.use('/api/v1/admin/compliance', adminComplianceRouter);
app.use('/api/v1/admin/governance', adminGovernanceRouter);
app.use('/api/v1/admin/cognitive', adminCognitiveRouter);
app.use('/api/v1/routines', routinesRouter);
app.use('/api/v1/routines', chainsRouter);
app.use('/api/v1/approvals', approvalsRouter);
app.use('/api/v1/admin/routines', adminRoutinesRouter);
app.use('/api/v1/webhooks/ingest', webhookIngestRouter);
app.use('/api/v1/webhooks/slack', slackWebhookRouter);
app.use('/api/v1/auth/slack', slackOAuthRouter);
app.use('/api/v1/intake', intakeRouter);
app.use('/api/v1/recommendations', recommendationsRouter);
app.use('/api/v1/activity', activityRouter);
app.use('/api/v1/uploads', uploadsRouter);
app.use('/api/v1/decisions', decisionsRouter);
app.use('/api/v1/meetings', meetingsRouter);

// Error handling
app.use(errorHandler);

// Socket.io — share session middleware for auth
setupSocketManager(io, sessionMiddleware);

// Start server — skip listen when running under tests
if (process.env.NODE_ENV !== 'test') {
  loadProviders()
    .then(() => bootstrapCompliance())
    .catch((err) => logger.warn({ err }, 'Provider load or compliance bootstrap failed at startup'));
  bootstrapIntegrations().catch((err) => logger.warn({ err }, 'Integration bootstrap failed at startup'));
  httpServer.listen(env.API_PORT, () => {
    logger.info({ port: env.API_PORT }, 'Hearth API server started');
  });
}

export { app, httpServer, io };
