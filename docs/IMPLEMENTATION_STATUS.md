# MVP implementation status

## Implemented

- Responsive React workspace with dashboard, child profile, growth records, learning, follow-ups, goals, and family settings.
- Desktop sidebar, mobile navigation drawer, stable responsive grids, and accessible icon labels.
- All primary modules load and save through FastAPI and SQLite/PostgreSQL: profile editing, record creation/filtering/conversion, homework creation/state transitions, follow-up creation/review transitions, goal creation/status updates, and family settings.
- Dashboard cards aggregate the latest persisted records, homework, follow-ups, and goals after every successful operation.
- Browser URL routing for the six primary views and history navigation.
- PWA manifest and static shell, Vercel SPA configuration, Render PostgreSQL configuration, FastAPI health/database endpoint, and local one-command launcher.
- Family account authentication, guardian-only account/family administration, 30-day login sessions, 5-second refresh, and refresh on foreground return.
- Isolated API acceptance flow for authentication, role permissions, CRUD, state archives, record conversion idempotency, validation, and logout.
- Production TypeScript/Vite build verification and 360px browser layout verification.

## Integration boundary

Local development can use clearly fictional demonstration data; production defaults to an empty PostgreSQL database. Supabase Auth, versioned support-plan confirmation, comments/read receipts, object-level grants, exports, audit logs, deletion recovery, and cursor-based incremental sync remain unimplemented. The current 5-second refresh reloads authorized household data rather than using a changes cursor. Production deployment must not claim the unimplemented capabilities before their acceptance tests pass.
