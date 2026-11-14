import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import pg from "pg";
import { spawnSync } from "node:child_process";

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
    // Solo ComfyUI online: no aceptar ediciones que necesariamente fallarán.
    await db.query("UPDATE workers SET last_seen_at = now() - interval '5 minutes' WHERE id = $1", [w1]);
    const comfyId = `comfy-test-${randomUUID()}`;
    const comfyHeartbeat = await request("/api/worker/heartbeat", {
      method: "POST", headers: { Authorization: `Bearer ${token}` },
      json: { workerId: comfyId, engine: "acestep", info: { backend: "ComfyUI", capabilities: ["generate"] } },
    });
    assert.equal(comfyHeartbeat.response.status, 200);
    const unsupported = await request("/api/jobs/edit", {
      method: "POST", cookie: users[0], json: { operation: "variation", songId },
    });
    assert.equal(unsupported.response.status, 422, JSON.stringify(unsupported.data));
    assert.match(unsupported.data.error, /solo admite canciones nuevas/);

    const ownSongs = await request("/api/songs?scope=mine", { cookie: users[0] });
    assert.equal(ownSongs.data.songs.length, 1);
    assert.equal((await request(`/api/songs/${songId}`, { cookie: users[1] })).response.status, 404);
    const audio = await request(`/api/songs/${songId}/audio`, { cookie: users[0], headers: { Range: "bytes=0-127" } });
    assert.equal(audio.response.status, 206);
    assert.equal(audio.data.byteLength, 128);
    const suffix = await request(`/api/songs/${songId}/audio`, { cookie: users[0], headers: { Range: "bytes=-64" } });
    assert.equal(suffix.response.status, 206);
    assert.equal(suffix.data.byteLength, 64);

    // Audio MP3 real (no WAV simulado): se comprueba subida, persistencia y reproducción parcial.
    const encoded = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi",
      "-i", "sine=frequency=523:duration=2", "-codec:a", "libmp3lame",
      "-q:a", "5", "-f", "mp3", "pipe:1",
    ], { maxBuffer: 4 * 1024 * 1024 });
    if (encoded.status === 0 && encoded.stdout.byteLength > 1000) {
      const mp3 = encoded.stdout;
      const mp3Job = await createJob(users[0]);
      const mp3Claim = (await claim(w2)).data.job;
      assert.equal(mp3Claim.id, mp3Job.id);
      const mp3Form = new FormData();
      mp3Form.set("meta", JSON.stringify({ durationSec: 2, model: "MP3 real de integración" }));
      mp3Form.set("file", new Blob([mp3], { type: "audio/mpeg" }), "prueba.mp3");
      const mp3Result = await request(`/api/worker/jobs/${mp3Job.id}/complete`, {
        method: "POST", headers: workerHeaders(w2, mp3Claim.attempts), form: mp3Form,
      });
      assert.equal(mp3Result.response.status, 200, JSON.stringify(mp3Result.data));
      const mp3Song = mp3Result.data.songId;
      const mp3Audio = await request(`/api/songs/${mp3Song}/audio`, { cookie: users[0],
        headers: { Range: "bytes=0-255" } });
      assert.equal(mp3Audio.response.status, 206);
      assert.equal(mp3Audio.response.headers.get("content-type"), "audio/mpeg");
      assert.deepEqual(Buffer.from(mp3Audio.data), mp3.subarray(0, 256));
      const mp3Full = await request(`/api/songs/${mp3Song}/audio`, { cookie: users[0] });
      assert.equal(mp3Full.response.status, 200);
      assert.equal(mp3Full.data.byteLength, mp3.length);
    } else {
      assert.notEqual(process.env.SONORA_REQUIRE_REAL_MP3, "1",
        "FFmpeg es obligatorio en GitHub Actions: no puede omitirse la prueba MP3 real");
      console.warn("Sin FFmpeg local: prueba MP3 omitida fuera de CI");
    }

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

test("video: crear proyecto, reclamar worker, subir MP4 y aislar usuarios", {
  skip: !base || !dbUrl || !token,
}, async () => {
  const password = "Clave-video-123";
  const users = [];
  const workerId = "video-test-" + randomUUID();
  async function call(path, {cookie, method="GET", json, form, headers={}}={}) {
    const response=await fetch(base+path,{method,
      headers:{...(cookie?{Cookie:cookie}:{}),...(json?{"Content-Type":"application/json"}:{}),...headers},
      body:json?JSON.stringify(json):form});
    const contentType=response.headers.get("content-type")||"";
    const data=contentType.includes("application/json")?await response.json():await response.arrayBuffer();
    return {response,data};
  }
  const bearer={Authorization:`Bearer ${token}`};
  const lease=(attempt)=>({...bearer,"X-Worker-Id":workerId,"X-Job-Attempt":String(attempt)});
  try {
    for(let i=0;i<2;i++){
      const email=`video-${randomUUID()}@example.test`;
      const r=await call("/api/auth/register",{method:"POST",json:{name:"Video Tester",email,password}});
      assert.equal(r.response.status,200,JSON.stringify(r.data));
      users.push(r.response.headers.get("set-cookie").split(";")[0]);
    }
    assert.equal((await call("/api/videos")).response.status,401);
    const h=await call("/api/worker/heartbeat",{method:"POST",headers:bearer,
      json:{workerId,engine:"sonora-video",info:{backend:"Montaje local",capabilities:["images","mp4"]}}});
    assert.equal(h.response.status,200,JSON.stringify(h.data));

    const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/R9sAAAAASUVORK5CYII=","base64");
    const wav=Buffer.alloc(44+2*44100);
    wav.write("RIFF",0);wav.writeUInt32LE(wav.length-8,4);
    wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);
    wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
    wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);
    wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
    wav.write("data",36);wav.writeUInt32LE(wav.length-44,40);
    const form=new FormData();
    for(const [key,value] of Object.entries({title:"Manga de prueba",mode:"manga",aspect:"16:9",duration:"15",script:"Narrador: comienza el viaje",narration:"false"}))
      form.set(key,value);
    form.append("files",new Blob([png],{type:"image/png"}),"panel.png");
    form.append("files",new Blob([wav],{type:"audio/wav"}),"audio.wav");
    const create=await call("/api/videos",{cookie:users[0],method:"POST",form});
    assert.equal(create.response.status,201,JSON.stringify(create.data));
    const videoId=create.data.id,jobId=create.data.jobId;
    const foreign=await call(`/api/videos/${videoId}/file`,{cookie:users[1]});
    assert.equal(foreign.response.status,404);
    const claim=await call("/api/worker/claim",{method:"POST",headers:bearer,
      json:{workerId,engine:"sonora-video"}});
    assert.equal(claim.response.status,200,JSON.stringify(claim.data));
    assert.equal(claim.data.job.id,jobId);
    const attempt=claim.data.job.attempts;
    const src=await call(`/api/worker/jobs/${jobId}/video-input`,{headers:lease(attempt)});
    assert.equal(src.response.status,200);
    assert.equal(Buffer.from(src.data).subarray(0,5).toString(),"SNV01");
    assert.equal((await call(`/api/worker/jobs/${jobId}/video-input`,{headers:bearer})).response.status,400);
    const mp4Result=spawnSync("ffmpeg",["-hide_banner","-loglevel","error",
      "-f","lavfi","-i","color=c=blue:s=160x90:r=12:d=2",
      "-f","lavfi","-i","sine=frequency=330:duration=2",
      "-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac","-shortest",
      "-movflags","frag_keyframe+empty_moov","-f","mp4","pipe:1"],{maxBuffer:5*1024*1024});
    assert.equal(mp4Result.status,0,mp4Result.stderr.toString());
    const mp4=mp4Result.stdout;
    assert.equal(mp4.toString("ascii",4,8),"ftyp");
    const videoForm=new FormData();
    videoForm.set("meta",JSON.stringify({durationSec:2,model:"Render CI MP4"}));
    videoForm.set("file",new Blob([mp4],{type:"video/mp4"}),"prueba.mp4");
    const done=await call(`/api/worker/jobs/${jobId}/complete`,{method:"POST",headers:lease(attempt),form:videoForm});
    assert.equal(done.response.status,200,JSON.stringify(done.data));
    assert.equal(done.data.videoId,videoId);
    const list=await call("/api/videos",{cookie:users[0]});
    assert.equal(list.response.status,200);
    assert.equal(list.data.videos.some(v=>v.id===videoId&&v.ready),true);
    const partial=await call(`/api/videos/${videoId}/file`,{cookie:users[0],headers:{Range:"bytes=0-255"}});
    assert.equal(partial.response.status,206);
    assert.equal(partial.response.headers.get("content-type"),"video/mp4");
    assert.deepEqual(Buffer.from(partial.data),mp4.subarray(0,256));
    const saved=await call(`/api/videos/${videoId}/file`,{cookie:users[0]});
    assert.equal(saved.response.status,200);
    assert.equal(saved.data.byteLength,mp4.byteLength);
    assert.equal((await call(`/api/videos/${videoId}/file`,{cookie:users[1]})).response.status,404);

    // Video lírico sin imágenes: solo pista de audio y letra original.
    const lyricsForm=new FormData();
    for(const [key,value] of Object.entries({title:"Video lírico de prueba",mode:"letra",
      aspect:"16:9",duration:"15",script:"[Verse]\nBajo el mismo cielo\n[Chorus]\nVolvemos a cantar",
      narration:"false",sceneSync:"music"})) lyricsForm.set(key,value);
    lyricsForm.append("files",new Blob([wav],{type:"audio/wav"}),"letra.wav");
    const lyricCreate=await call("/api/videos",{cookie:users[0],method:"POST",form:lyricsForm});
    assert.equal(lyricCreate.response.status,201,JSON.stringify(lyricCreate.data));
    const lyricClaim=await call("/api/worker/claim",{method:"POST",headers:bearer,
      json:{workerId,engine:"sonora-video"}});
    assert.equal(lyricClaim.response.status,200,JSON.stringify(lyricClaim.data));
    assert.equal(lyricClaim.data.job.id,lyricCreate.data.jobId);
    assert.equal(lyricClaim.data.job.params.mode,"letra");
    assert.equal(lyricClaim.data.job.params.subtitles,true);
    const lyricInput=await call("/api/worker/jobs/"+lyricCreate.data.jobId+"/video-input",
      {headers:lease(lyricClaim.data.job.attempts)});
    assert.equal(lyricInput.response.status,200);
    assert.equal(Buffer.from(lyricInput.data).subarray(0,5).toString(),"SNV01");
    const lyricResult=new FormData();
    lyricResult.set("meta",JSON.stringify({durationSec:2,model:"CI videoclip lírico"}));
    lyricResult.set("file",new Blob([mp4],{type:"video/mp4"}),"letra.mp4");
    const lyricDone=await call("/api/worker/jobs/"+lyricCreate.data.jobId+"/complete",
      {method:"POST",headers:lease(lyricClaim.data.job.attempts),form:lyricResult});
    assert.equal(lyricDone.response.status,200,JSON.stringify(lyricDone.data));
    assert.equal(lyricDone.data.videoId,lyricCreate.data.id);
    const lyricVideo=await call("/api/videos/"+lyricCreate.data.id+"/file",{cookie:users[0]});
    assert.equal(lyricVideo.response.status,200);
    assert.equal(lyricVideo.data.byteLength,mp4.length);
    assert.equal((await call("/api/videos/"+lyricCreate.data.id,{cookie:users[0],method:"DELETE"})).response.status,200);
    const status=await call("/api/videos",{cookie:users[0]});
    assert.equal(status.data.motor.online,true);
    assert.equal(typeof status.data.motor.pending,"number");
    assert.equal((await call(`/api/videos/${videoId}`,{cookie:users[1],method:"DELETE"})).response.status,404);
    const deleted=await call(`/api/videos/${videoId}`,{cookie:users[0],method:"DELETE"});
    assert.equal(deleted.response.status,200,JSON.stringify(deleted.data));
    assert.equal((await call(`/api/videos/${videoId}/file`,{cookie:users[0]})).response.status,404);
  }finally{
    for(const cookie of users)await call("/api/profile",{cookie,method:"DELETE",json:{password}}).catch(()=>{});
  }
});
