CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE users (id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organisations(id), email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','manager','reviewer','creator')), password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX sessions_expiry ON sessions(expires_at);
--> statement-breakpoint
CREATE INDEX users_org ON users(org_id);
--> statement-breakpoint
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, resets_at INTEGER NOT NULL);
