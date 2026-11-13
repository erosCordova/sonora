import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import pg from "pg";

// Ejecutar solo contra un servidor y una base de datos de prueba propios.
const base = process.env.TEST_BASE_URL;
const dbUrl = process.env.TEST_DATABASE_URL;
const token = process.env.WORKER_TOKEN;

test("usuarios, cola, reintentos y resultados concurrentes", { skip: !base || !dbUrl || !token }, async () => {
  const password = "Clave-de-prueba-123";
  const users = [];
  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();

  async function request(path, { method = "GET", json, cookie, headers = {}, form } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(json ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: json ? JSON.stringify(json) : form,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json") ? await response.json() : await response.arrayBuffer();
    return { response, data };
  }
  function workerHeaders(workerId, attempt) {
    return { Authorization: `Bearer ${token}`, "X-Worker-Id": workerId, "X-Job-Attempt": String(attempt) };
  }
  function wave() {
    const samples = 16000 * 2;
    const buf = Buffer.alloc(44 + samples * 2);
    buf.write("RIFF", 0); buf.writeUInt32LE(buf.length - 8, 4); buf.write("WAVEfmt ", 8);
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(16000, 24); buf.writeUInt32LE(32000, 28); buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(samples * 2, 40);
    return buf;
  }
  function resultForm() {
    const form = new FormData();
    form.set("meta", JSON.stringify({ durationSec: 2, model: "Audio sintético para pruebas" }));
    form.set("file", new Blob([wave()], { type: "audio/wav" }), "prueba.wav");
    return form;
  }
  async function createJob(cookie) {
    const r = await request("/api/jobs", { method: "POST", cookie, json: { mode: "simple", prompt: "Una canción instrumental de prueba", vocal: "instrumental" } });
    assert.equal(r.response.status, 201, JSON.stringify(r.data));
    return r.data.jobs[0];
  }
  async function claim(workerId) {
    return request("/api/worker/claim", { method: "POST", headers: { Authorization: `Bearer ${token}` }, json: { workerId, engine: "acestep" } });
  }
  try {
    for (let i = 0; i < 2; i++) {
      const email = `test-${randomUUID()}@example.test`;
      const r = await request("/api/auth/register", { method: "POST", json: { name: "Usuario de prueba", email, password } });
      assert.equal(r.response.status, 200, JSON.stringify(r.data));
      const cookie = r.response.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      users.push(cookie);
    }
    assert.equal((await request("/api/jobs")).response.status, 401);
    const first = await createJob(users[0]);
    assert.equal((await request(`/api/jobs/${first.id}/cancel`, { method: "POST", cookie: users[1] })).response.status, 404);
    assert.equal((await request("/api/jobs", { cookie: users[1] })).data.jobs.length, 0);

    const w1 = `test-a-${randomUUID()}`;
    const w2 = `test-b-${randomUUID()}`;
    const a = (await claim(w1)).data.job;
    assert.equal(a.id, first.id);
    assert.equal(a.attempts, 1);
    const progressPath = `/api/worker/jobs/${first.id}/progress`;
    assert.equal((await request(progressPath, { method: "POST", headers: { Authorization: `Bearer ${token}` }, json: { stage: "prueba" } })).response.status, 400);
    assert.equal((await request(progressPath, { method: "POST", headers: workerHeaders(w1, 1), json: { stage: "prueba", progress: 0.3 } })).response.status, 200);

    await db.query("UPDATE jobs SET heartbeat_at = now() - interval '3 minutes' WHERE id = $1", [first.id]);
    const b = (await claim(w2)).data.job;
    assert.equal(b.id, first.id);
    assert.equal(b.attempts, 2);
    assert.equal((await request(progressPath, { method: "POST", headers: workerHeaders(w1, 1), json: { stage: "antiguo" } })).response.status, 409);
    const heartbeat = await request("/api/worker/heartbeat", { method: "POST", headers: { Authorization: `Bearer ${token}` }, json: { workerId: w1, engine: "acestep", currentJobId: first.id, currentJobAttempt: 1 } });
    assert.equal(heartbeat.data.cancel, true);
    assert.equal((await request(`/api/worker/jobs/${first.id}/fail`, { method: "POST", headers: workerHeaders(w1, 1), json: { error: "antiguo", retryable: true } })).response.status, 409);
    const completePath = `/api/worker/jobs/${first.id}/complete`;
    assert.equal((await request(completePath, { method: "POST", headers: workerHeaders(w1, 1), form: resultForm() })).response.status, 409);
    const uploads = await Promise.all([1, 2].map(() => request(completePath, { method: "POST", headers: workerHeaders(w2, 2), form: resultForm() })));
    assert.deepEqual(uploads.map((r) => r.response.status).sort(), [200, 409]);
    const songId = uploads.find((r) => r.response.status === 200).data.songId;
    if (process.env.STORAGE_BACKEND === "postgres") {
      const stored = await db.query("SELECT bytes, octet_length(content) AS actual FROM audio_objects WHERE key LIKE $1", [`%/${songId}.wav`]);
      assert.equal(stored.rowCount, 1, "El audio debe persistir en PostgreSQL");
      assert.equal(stored.rows[0].bytes, wave().byteLength);
      assert.equal(stored.rows[0].actual, wave().byteLength);
    }
    const ownSongs = await request("/api/songs?scope=mine", { cookie: users[0] });
    assert.equal(ownSongs.data.songs.length, 1);
    assert.equal((await request(`/api/songs/${songId}`, { cookie: users[1] })).response.status, 404);
    const audio = await request(`/api/songs/${songId}/audio`, { cookie: users[0], headers: { Range: "bytes=0-127" } });
    assert.equal(audio.response.status, 206);
    assert.equal(audio.data.byteLength, 128);
    const suffix = await request(`/api/songs/${songId}/audio`, { cookie: users[0], headers: { Range: "bytes=-64" } });
    assert.equal(suffix.response.status, 206);
    assert.equal(suffix.data.byteLength, 64);

    const second = await createJob(users[0]);
    assert.equal((await claim(w1)).data.job.id, second.id);
    assert.equal((await request(`/api/jobs/${second.id}/cancel`, { method: "POST", cookie: users[0] })).response.status, 200);
    assert.equal((await request(`/api/worker/jobs/${second.id}/complete`, { method: "POST", headers: workerHeaders(w1, 1), form: resultForm() })).response.status, 409);
    assert.equal((await request(`/api/worker/jobs/${second.id}/fail`, { method: "POST", headers: workerHeaders(w1, 1), json: { error: "cancelada" } })).response.status, 409);
  } finally {
    for (const cookie of users) {
      await request("/api/profile", { method: "DELETE", cookie, json: { password } }).catch(() => {});
    }
    await db.end();
  }
});


test("recuperación: token de un solo uso incluso ante peticiones simultáneas", { skip: !base || !dbUrl || !token }, async () => {
  const email = `reset-${randomUUID()}@example.test`;
  const originalPassword = "Clave-original-123";
  const newPasswords = ["Clave-nueva-a-123", "Clave-nueva-b-123"];
  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();
  try {
    const register = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Recuperación de prueba", email, password: originalPassword }),
    });
    assert.equal(register.status, 200);
    const cookie = register.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const tokenRaw = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(tokenRaw).digest("hex");
    await db.query(
      `INSERT INTO password_resets (id, user_id, expires_at)
       SELECT $1, id, now() + interval '1 hour' FROM users WHERE email = $2`,
      [tokenHash, email],
    );

    const responses = await Promise.all(newPasswords.map((password) => fetch(`${base}/api/auth/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenRaw, password }),
    })));
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
    assert.equal((await fetch(`${base}/api/jobs`, { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await fetch(`${base}/api/auth/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenRaw, password: "Intento-repetido-123" }),
    })).status, 400);

    const winningPassword = newPasswords[responses.findIndex((r) => r.status === 200)];
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: winningPassword }),
    });
    assert.equal(login.status, 200);
  } finally {
    await db.query("DELETE FROM users WHERE email = $1", [email]);
    await db.end();
  }
});
