import test from 'node:test';
import assert from 'node:assert/strict';
import { openDB } from '../src/local-db.mjs';
import { handleApi } from '../src/api.mjs';
import { demoDraft } from '../src/seed.mjs';

function harness(runtimeEnv = {}) {
  const DB = openDB(':memory:');
  let cookie = '';
  return {
    DB,
    async call(path, data, options = {}) {
      const response = await handleApi(
        new Request('http://localhost' + path, {
          method: data === undefined ? 'GET' : 'POST',
          headers: { ...(cookie ? { cookie } : {}), 'Content-Type': 'application/json', 'X-BC-Request': '1', ...options.headers },
          ...(data === undefined ? {} : { body: JSON.stringify(data) })
        }),
        { DB, ...runtimeEnv }
      );
      const next = response.headers.get('set-cookie');
      if (next) cookie = next.split(';')[0];
      return { status: response.status, data: await response.json(), headers: response.headers };
    },
    async demo() {
      return this.call('/api/demo', {});
    },
    async state() {
      return (await this.call('/api/state')).data;
    },
    close() {
      DB.close();
    }
  };
}

const clean = { ...demoDraft, title: 'Clean draft', foreground: '#172B26', text: 'Verdant Bottle holds 750 ml. Verdant Bottle costs INR 999.' };

test('configured audit signing key is used for initial demo events and later audit events', async () => {
  const h = harness({ AUDIT_SIGNING_KEY: 'test-only-audit-signing-secret-for-consistency' });
  try {
    await h.demo();
    let audit = (await h.call('/api/audit')).data;
    assert.equal(audit.valid, true);
    assert.equal(audit.hmac_signed, true);

    const s = await h.state();
    const created = await h.call('/api/reviews', { ...clean, revision: s.revision });
    assert.equal(created.status, 201);
    audit = (await h.call('/api/audit')).data;
    assert.equal(audit.valid, true);
    assert.equal(audit.hmac_signed, true);
  } finally {
    h.close();
  }
});

test('authentication is required for workspace and export', async () => {
  const h = harness();
  try {
    assert.equal((await h.call('/api/state')).status, 401);
    assert.equal((await h.call('/api/export')).status, 401);
  } finally {
    h.close();
  }
});

test('mutation request guard and same-origin check reject CSRF', async () => {
  const h = harness();
  try {
    assert.equal((await h.call('/api/demo', {}, { headers: { 'X-BC-Request': '' } })).status, 403);
    assert.equal((await h.call('/api/demo', {}, { headers: { origin: 'https://evil.example' } })).status, 403);
  } finally {
    h.close();
  }
});

test('demo sessions are isolated, with server-enforced creator permissions and AES-256-GCM at-rest encryption', async () => {
  const h = harness();
  try {
    await h.demo();
    const a = await h.state();
    assert.equal(a.user.role, 'creator');
    assert.equal(a.organisation.encrypted_at_rest, true);
    const rawOrg = await h.DB.prepare('SELECT state FROM organisations WHERE id=?').bind(a.organisation.id).first();
    assert.match(rawOrg.state, /"__encrypted":true/);
    assert.equal((await h.call('/api/knowledge', { revision: a.revision, kind: 'fact' })).status, 403);
    await h.demo();
    const b = await h.state();
    assert.notEqual(a.organisation.id, b.organisation.id);
    assert.equal((await h.call('/api/reviews/' + a.state.reviews[0].id, { revision: b.revision, action: 'comment', text: 'Other tenant' })).status, 404);
  } finally {
    h.close();
  }
});

test('approval blocks unresolved high issues, records override and prevents self approval', async () => {
  const h = harness();
  try {
    await h.demo();
    let s = await h.state(),
      id = s.state.reviews[0].id;
    assert.equal((await h.call('/api/reviews/' + id, { revision: s.revision, action: 'submit' })).status, 200);
    await h.call('/api/demo/role', { role: 'manager' });
    s = await h.state();
    assert.equal((await h.call('/api/reviews/' + id, { revision: s.revision, action: 'approve', reason: 'Looks appropriate' })).status, 409);
    for (const f of s.state.reviews[0].analysis.findings.filter(f => f.severity === 'high')) {
      s = await h.state();
      assert.equal(
        (
          await h.call('/api/reviews/' + id, {
            revision: s.revision,
            action: 'decision',
            finding_id: f.id,
            decision: 'overridden',
            reason: 'Demo override with explicit human judgement'
          })
        ).status,
        200
      );
    }
    s = await h.state();
    assert.equal(
      (await h.call('/api/reviews/' + id, { revision: s.revision, action: 'approve', reason: 'Reviewed evidence and recorded exceptions' })).status,
      200
    );
    assert.equal((await h.state()).state.reviews[0].status, 'approved');
  } finally {
    h.close();
  }
});

test('clean draft goes through full approval; edits invalidate approval and preserve history', async () => {
  const h = harness();
  try {
    await h.demo();
    let s = await h.state();
    const created = await h.call('/api/reviews', { ...clean, revision: s.revision });
    assert.equal(created.status, 201);
    const id = created.data.id;
    s = await h.state();
    await h.call('/api/reviews/' + id, { revision: s.revision, action: 'submit' });
    s = await h.state();
    assert.equal((await h.call('/api/reviews/' + id, { revision: s.revision, action: 'approve', reason: 'Self approval attempt' })).status, 403);
    await h.call('/api/demo/role', { role: 'reviewer' });
    s = await h.state();
    assert.equal((await h.call('/api/reviews/' + id, { revision: s.revision, action: 'approve', reason: 'Verified both facts' })).status, 200);
    await h.call('/api/demo/role', { role: 'creator' });
    s = await h.state();
    assert.equal((await h.call('/api/reviews/' + id, { ...clean, title: 'Edited title', revision: s.revision, action: 'save' })).status, 200);
    const r = (await h.state()).state.reviews.find(r => r.id === id);
    assert.equal(r.status, 'draft');
    assert.equal(r.approved_by, null);
    assert.equal(r.version, 2);
    assert.equal(r.versions[0].status, 'approved');
    const auditRes = (await h.call('/api/audit')).data;
    assert.equal(auditRes.valid, true);
    assert.equal(auditRes.hmac_signed, true);
  } finally {
    h.close();
  }
});

test('Improvement 3: Google Docs review integration binds approval to document version and invalidates on later edits', async () => {
  const h = harness();
  try {
    await h.demo();
    let s = await h.state();
    // 1. Connect & review a Google Doc containing a preferred-term violation
    const gdocCreate = await h.call('/api/gdocs', {
      doc_id: 'gdoc-campaign-101',
      doc_title: 'Launch Doc',
      doc_revision_id: 'rev-1',
      channel: 'Website',
      text: 'This cheap bottle holds 750 ml. Verdant Bottle costs INR 999.',
      create_review: true,
      revision: s.revision
    });
    assert.equal(gdocCreate.status, 200);
    const reviewId = gdocCreate.data.review_id;

    // 2. Inspect findings and apply accepted correction back to the Google Doc
    s = await h.state();
    const r1 = s.state.reviews.find(r => r.id === reviewId);
    const termFinding = r1.analysis.findings.find(f => f.quote === 'cheap');
    assert.ok(termFinding);

    const applied = await h.call('/api/reviews/' + reviewId, {
      revision: s.revision,
      action: 'gdoc_apply',
      finding_id: termFinding.id
    });
    assert.equal(applied.status, 200);
    assert.equal(applied.data.gdoc.doc_revision_id, 'rev-2');

    // 3. Submit and approve under Reviewer role; verify cryptographic binding to rev-2
    s = await h.state();
    await h.call('/api/reviews/' + reviewId, { revision: s.revision, action: 'submit' });
    await h.call('/api/demo/role', { role: 'reviewer' });
    s = await h.state();
    const approveRes = await h.call('/api/reviews/' + reviewId, {
      revision: s.revision,
      action: 'approve',
      reason: 'Approved Google Doc rev-2'
    });
    assert.equal(approveRes.status, 200);

    const statusRev2 = await h.call('/api/gdocs/gdoc-campaign-101/status?revision_id=rev-2');
    assert.equal(statusRev2.status, 200);
    assert.equal(statusRev2.data.approval_valid, true);
    assert.equal(statusRev2.data.effective_status, 'approved_and_bound');

    // Querying status for a newer unreviewed revision rev-3 reports stale_revision_requires_review
    const statusRev3 = await h.call('/api/gdocs/gdoc-campaign-101/status?revision_id=rev-3');
    assert.equal(statusRev3.data.approval_valid, false);
    assert.equal(statusRev3.data.effective_status, 'stale_revision_requires_review');

    // 4. Syncing a later edit from Google Docs invalidates the approval and requires another review
    await h.call('/api/demo/role', { role: 'creator' });
    s = await h.state();
    const syncRes = await h.call('/api/reviews/' + reviewId, {
      revision: s.revision,
      action: 'gdoc_sync',
      doc_revision_id: 'rev-3',
      text: 'This affordable bottle holds 900 ml.'
    });
    assert.equal(syncRes.status, 200);
    assert.equal(syncRes.data.status, 'draft');
    assert.equal(syncRes.data.gdoc.approval_bound_revision, null);
  } finally {
    h.close();
  }
});

test('high severity decisions cannot be dismissed by creators', async () => {
  const h = harness();
  try {
    await h.demo();
    const s = await h.state(),
      r = s.state.reviews[0],
      f = r.analysis.findings.find(f => f.severity === 'high');
    assert.equal(
      (await h.call('/api/reviews/' + r.id, { revision: s.revision, action: 'decision', finding_id: f.id, decision: 'dismissed', reason: 'Skip the hard part' }))
        .status,
      403
    );
  } finally {
    h.close();
  }
});

test('stale write revision is rejected without overwriting work', async () => {
  const h = harness();
  try {
    await h.demo();
    const s = await h.state(),
      id = s.state.reviews[0].id;
    await h.call('/api/reviews/' + id, { revision: s.revision, action: 'comment', text: 'first' });
    assert.equal((await h.call('/api/reviews/' + id, { revision: s.revision, action: 'comment', text: 'stale second' })).status, 409);
    assert.equal((await h.state()).state.reviews[0].comments.length, 1);
  } finally {
    h.close();
  }
});

test('knowledge changes make old analysis ineligible for submission', async () => {
  const h = harness();
  try {
    await h.demo();
    let s = await h.state(),
      id = s.state.reviews[0].id;
    await h.call('/api/demo/role', { role: 'manager' });
    s = await h.state();
    assert.equal(
      (await h.call('/api/knowledge', { kind: 'fact', title: 'New capacity', text: 'Verdant Mini holds 500 ml.', source: 'Fact sheet', revision: s.revision }))
        .status,
      200
    );
    await h.call('/api/demo/role', { role: 'creator' });
    s = await h.state();
    assert.equal((await h.call('/api/reviews/' + id, { action: 'submit', revision: s.revision })).status, 409);
    assert.equal(s.state.knowledge_history.length, 1);
  } finally {
    h.close();
  }
});

test('apply suggestion creates immutable prior revision and recalculates offsets', async () => {
  const h = harness();
  try {
    await h.demo();
    const s = await h.state(),
      r = s.state.reviews[0],
      f = r.analysis.findings.find(f => f.quote === 'cheap');
    await h.call('/api/reviews/' + r.id, { revision: s.revision, action: 'apply', finding_id: f.id });
    const next = (await h.state()).state.reviews[0];
    assert.match(next.text, /affordable/);
    assert.match(next.versions[0].text, /cheap/);
    assert.equal(next.version, 2);
    for (const finding of next.analysis.findings)
      if (Number.isInteger(finding.start)) assert.equal(next.text.slice(finding.start, finding.end), finding.quote);
  } finally {
    h.close();
  }
});

test('real accounts cannot use demo role elevation, and password recovery, invitations and MFA work', async () => {
  const h = harness();
  try {
    const signup = await h.call('/api/signup', {
      email: 'test@example.com',
      password: 'Testing-Password-123',
      name: 'Test Admin',
      organisation: 'Test Company'
    });
    assert.equal(signup.status, 200);
    assert.match(signup.headers.get('set-cookie'), /HttpOnly/);
    assert.equal((await h.call('/api/demo/role', { role: 'manager' })).status, 403);

    // Email verification using token from signup
    const verifyRes = await h.call('/api/account/security', { action: 'verify_email', token: signup.data.verification_token });
    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.data.email_verified, true);

    // TOTP MFA setup & activation
    const mfaSetup = await h.call('/api/account/security', { action: 'mfa_setup' });
    assert.equal(mfaSetup.status, 200);
    const mfaEnable = await h.call('/api/account/security', { action: 'mfa_enable', code: mfaSetup.data.current_code });
    assert.equal(mfaEnable.status, 200);
    assert.equal(mfaEnable.data.mfa_enabled, true);

    // Member invitation & acceptance
    let s = await h.state();
    const inviteRes = await h.call('/api/members/invite', {
      name: 'Invited Reviewer',
      email: 'invited@example.com',
      role: 'reviewer',
      revision: s.revision
    });
    assert.equal(inviteRes.status, 200);
    assert.ok(inviteRes.data.invite_token);

    await h.call('/api/logout', {});
    const acceptRes = await h.call('/api/members/accept-invite', {
      token: inviteRes.data.invite_token,
      password: 'Invited-Password-456'
    });
    assert.equal(acceptRes.status, 200);
    assert.equal(acceptRes.data.user.role, 'reviewer');

    // Password recovery flow
    await h.call('/api/logout', {});
    const rec = await h.call('/api/account/recover', { email: 'test@example.com' });
    assert.equal(rec.status, 200);
    assert.ok(rec.data.recovery_token);
    const reset = await h.call('/api/account/reset', {
      token: rec.data.recovery_token,
      new_password: 'Reset-Password-789'
    });
    assert.equal(reset.status, 200);
    assert.equal((await h.call('/api/login', { email: 'test@example.com', password: 'Testing-Password-123' })).status, 401);
    assert.equal((await h.call('/api/login', { email: 'test@example.com', password: 'Reset-Password-789' })).status, 200);
  } finally {
    h.close();
  }
});

test('reviewer cannot edit creator text, and admin can provision a real team member and run retention cleanup', async () => {
  const h = harness();
  try {
    await h.demo();
    let s = await h.state(),
      id = s.state.reviews[0].id;
    await h.call('/api/demo/role', { role: 'reviewer' });
    s = await h.state();
    assert.equal((await h.call('/api/reviews/' + id, { ...clean, revision: s.revision, action: 'save' })).status, 403);
    await h.call('/api/demo/role', { role: 'admin' });
    s = await h.state();
    assert.equal(
      (await h.call('/api/members', { revision: s.revision, name: 'New Member', email: 'new@example.com', password: 'long-password-123', role: 'reviewer' }))
        .status,
      200
    );
    assert.equal((await h.call('/api/members')).data.members.length, 5);
    s = await h.state();
    const ret = await h.call('/api/admin/retention', { max_drafts: 150, max_revisions: 30, demo_ttl_hours: 12, revision: s.revision });
    assert.equal(ret.status, 200);
    assert.equal(ret.data.retention.max_drafts, 150);
  } finally {
    h.close();
  }
});

test('invalid content and malformed colours return clear validation errors', async () => {
  const h = harness();
  try {
    await h.demo();
    const s = await h.state();
    assert.equal((await h.call('/api/reviews', { ...clean, foreground: 'url(x)', revision: s.revision })).status, 400);
    assert.equal((await h.call('/api/reviews', { ...clean, text: '', revision: s.revision })).status, 400);
  } finally {
    h.close();
  }
});

test('authenticated HTML, JSON, CSV and native PDF exports are downloadable and tenant-scoped', async () => {
  const h = harness();
  try {
    const demo = await h.demo(),
      cookie = demo.headers.get('set-cookie').split(';')[0],
      s = await h.state(),
      id = s.state.reviews[0].id;
    for (const format of ['html', 'json', 'csv', 'pdf']) {
      const res = await handleApi(new Request('http://localhost/api/reports/' + id + '/' + format, { headers: { cookie } }), { DB: h.DB });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-disposition'), /attachment/);
      const text = await res.text();
      assert.ok(text.length > 100);
      if (format === 'pdf') assert.ok(text.startsWith('%PDF-1.4'));
    }
    await h.demo();
    const newer = await h.state();
    assert.equal((await h.call('/api/reports/' + id + '/json')).status, 404);
    assert.notEqual(newer.organisation.id, s.organisation.id);
  } finally {
    h.close();
  }
});
