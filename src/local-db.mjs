import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const root = fileURLToPath(new URL('../', import.meta.url));

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const PY_WORKER = `
import sys, json, sqlite3

db_path = sys.argv[1]
conn = sqlite3.connect(db_path, isolation_level=None)
conn.row_factory = sqlite3.Row
conn.execute("PRAGMA foreign_keys=ON;")
if db_path != ":memory:":
    conn.execute("PRAGMA journal_mode=WAL;")
conn.execute("PRAGMA busy_timeout=5000;")

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req = json.loads(line)
    op = req.get("op")
    try:
        if op == "exec":
            conn.executescript(req["sql"])
            out = {"ok": True}
        elif op == "first":
            cur = conn.execute(req["sql"], req.get("params", []))
            row = cur.fetchone()
            out = {"ok": True, "row": dict(row) if row is not None else None}
        elif op == "all":
            cur = conn.execute(req["sql"], req.get("params", []))
            rows = [dict(r) for r in cur.fetchall()]
            out = {"ok": True, "rows": rows}
        elif op == "run":
            cur = conn.execute(req["sql"], req.get("params", []))
            out = {"ok": True, "changes": cur.rowcount if cur.rowcount >= 0 else 0}
        elif op == "batch":
            conn.execute("BEGIN IMMEDIATE")
            try:
                results = []
                for stmt in req.get("statements", []):
                    cur = conn.execute(stmt["sql"], stmt.get("params", []))
                    results.append({"success": True, "meta": {"changes": cur.rowcount if cur.rowcount >= 0 else 0}})
                conn.execute("COMMIT")
                out = {"ok": True, "results": results}
            except Exception as inner_e:
                conn.execute("ROLLBACK")
                raise inner_e
        elif op == "close":
            conn.close()
            sys.stdout.write(json.dumps({"ok": True}) + "\\n")
            sys.stdout.flush()
            break
        else:
            out = {"ok": False, "error": f"Unknown op: {op}"}
    except Exception as e:
        out = {"ok": False, "error": str(e)}
    sys.stdout.write(json.dumps(out) + "\\n")
    sys.stdout.flush()
`;

function openPythonSQLite(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const proc = spawn('python3', ['-u', '-c', PY_WORKER, filename], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  proc.unref();

  let buffer = '';
  const pending = [];

  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', chunk => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      const waiter = pending.shift();
      if (waiter) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.ok) waiter.resolve(parsed);
          else waiter.reject(new Error(parsed.error || 'SQLite error'));
        } catch (err) {
          waiter.reject(err);
        }
      }
    }
  });

  proc.on('error', err => {
    while (pending.length) pending.shift().reject(err);
  });

  const send = payload =>
    new Promise((resolvePromise, rejectPromise) => {
      pending.push({ resolve: resolvePromise, reject: rejectPromise });
      proc.stdin.write(JSON.stringify(payload) + '\n');
    });

  // Queue migrations immediately on startup
  const migrations = readdirSync(resolve(root, 'drizzle'))
    .filter(n => n.endsWith('.sql'))
    .sort()
    .map(name => ({ name, sql: readFileSync(resolve(root, 'drizzle', name), 'utf8') }));

  let initPromise = (async () => {
    await send({ op: 'exec', sql: 'CREATE TABLE IF NOT EXISTS _migrations(name TEXT PRIMARY KEY);' });
    for (const m of migrations) {
      const check = await send({ op: 'first', sql: 'SELECT name FROM _migrations WHERE name=?', params: [m.name] });
      if (!check.row) {
        await send({ op: 'exec', sql: m.sql });
        await send({ op: 'run', sql: 'INSERT INTO _migrations(name) VALUES (?)', params: [m.name] });
      }
    }
  })();

  const ensureInit = async () => {
    if (initPromise) {
      await initPromise;
      initPromise = null;
    }
  };

  const wrap = (query, values = []) => ({
     _sql: query,
    _params: values,
    bind(...v) {
      return wrap(query, v);
    },
    async first() {
      await ensureInit();
      const res = await send({ op: 'first', sql: query, params: values });
      return res.row || null;
    },
    async all() {
      await ensureInit();
      const res = await send({ op: 'all', sql: query, params: values });
      return { results: res.rows || [] };
    },
    async run() {
      await ensureInit();
      const res = await send({ op: 'run', sql: query, params: values });
      return { success: true, meta: { changes: Number(res.changes) } };
    }
  });

  return {
    prepare: wrap,
    async batch(statements) {
      await ensureInit();
      const res = await send({
        op: 'batch',
        statements: statements.map(s => ({ sql: s._sql, params: s._params }))
      });
      return res.results;
    },
    close() {
      try {
        proc.stdin.end();
        proc.kill();
      } catch {}
    }
  };
}

export function openDB(filename = resolve(root, 'data/brandcompass.sqlite')) {
  if (!DatabaseSync) return openPythonSQLite(filename);
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const sql = new DatabaseSync(filename);
  sql.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  sql.exec('CREATE TABLE IF NOT EXISTS _migrations(name TEXT PRIMARY KEY)');
  for (const name of readdirSync(resolve(root, 'drizzle')).filter(n => n.endsWith('.sql')).sort()) {
    if (!sql.prepare('SELECT name FROM _migrations WHERE name=?').get(name)) {
      sql.exec('BEGIN');
      try {
        sql.exec(readFileSync(resolve(root, 'drizzle', name), 'utf8'));
        sql.prepare('INSERT INTO _migrations(name) VALUES (?)').run(name);
        sql.exec('COMMIT');
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    }
  }
  const wrap = (query, values = []) => ({
    bind(...v) {
      return wrap(query, v);
    },
    async first() {
      return sql.prepare(query).get(...values) || null;
    },
    async all() {
      return { results: sql.prepare(query).all(...values) };
    },
    async run() {
      const r = sql.prepare(query).run(...values);
      return { success: true, meta: { changes: Number(r.changes) } };
    }
  });
  return {
    prepare: wrap,
    async batch(statements) {
      sql.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sql.exec('COMMIT');
        return results;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
    close() {
      sql.close();
    }
  };
}
