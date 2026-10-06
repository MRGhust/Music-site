import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import multer from "multer";
import Database from "better-sqlite3";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
const data = path.resolve(process.env.DATA_DIR || "data");
mkdirSync(path.join(data, "uploads"), { recursive: true });
const db = new Database(path.join(data, "hamava.db"));
db.pragma("journal_mode = WAL");
db.exec(
  `CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,owner TEXT,name TEXT,settings TEXT,state TEXT); CREATE TABLE IF NOT EXISTS tracks(id TEXT PRIMARY KEY,room TEXT,title TEXT,file TEXT,mime TEXT,size INTEGER); CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,room TEXT,name TEXT,text TEXT,time INTEGER);`,
);
const app = express(),
  server = createServer(app),
  io = new Server(server, { maxHttpBufferSize: 16384 });
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
db.exec(
  "CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, payload TEXT, created INTEGER)",
);
const sessions = {
    get: (key) => {
      const r = db
        .prepare("SELECT payload FROM sessions WHERE token=? AND created>?")
        .get(key || "", Date.now() - 30 * 86400000);
      return r ? JSON.parse(r.payload) : undefined;
    },
    set: (key, value) =>
      db
        .prepare("INSERT INTO sessions VALUES(?,?,?)")
        .run(key, JSON.stringify(value), Date.now()),
  },
  attempts = new Map();
const clean = (v, max = 100) =>
  String(v || "")
    .trim()
    .slice(0, max);
const token = () => randomBytes(32).toString("hex");
const get = (id) => db.prepare("SELECT * FROM rooms WHERE id=?").get(id);
const member = (req, res, next) => {
  const s = sessions.get(req.headers.authorization?.replace("Bearer ", ""));
  if (!s || s.room !== req.params.id)
    return res.status(401).json({ error: "ابتدا وارد روم شوید." });
  req.session = s;
  next();
};
const owner = (req, res, next) => {
  if (req.session.owner !== get(req.params.id)?.owner)
    return res.status(403).json({ error: "این کار فقط برای میزبان مجاز است." });
  next();
};
function snapshot(id) {
  const r = get(id);
  if (!r) return null;
  const settings = JSON.parse(r.settings);
  delete settings.passwordHash;
  delete settings.passwordSalt;
  return {
    id,
    name: r.name,
    settings,
    state: JSON.parse(r.state),
    serverTime: Date.now(),
    tracks: db
      .prepare("SELECT id,title,size FROM tracks WHERE room=? ORDER BY rowid")
      .all(id),
    messages: db
      .prepare(
        "SELECT id,name,text,time FROM messages WHERE room=? ORDER BY time DESC LIMIT 80",
      )
      .all(id)
      .reverse(),
    members: [...(io.sockets.adapter.rooms.get(id) || [])].map((sid) => {
      const s = io.sockets.sockets.get(sid);
      return { id: sid, name: s.data.name, host: s.data.owner === r.owner };
    }),
  };
}
function broadcast(id) {
  io.to(id).emit("room", snapshot(id));
}
app.post("/api/rooms", (req, res) => {
  const name = clean(req.body.name);
  if (!name) return res.status(400).json({ error: "نام روم را وارد کنید." });
  const id = randomBytes(5).toString("hex"),
    secret = token(),
    auth = token();
  const settings = {
    guestUpload: false,
    guestControl: false,
    chat: true,
    repeat: false,
  };
  db.prepare("INSERT INTO rooms VALUES(?,?,?,?,?)").run(
    id,
    secret,
    name,
    JSON.stringify(settings),
    JSON.stringify({
      trackId: null,
      playing: false,
      position: 0,
      updatedAt: Date.now(),
    }),
  );
  sessions.set(auth, {
    room: id,
    owner: secret,
    name: clean(req.body.nickname, 30) || "میزبان",
  });
  res.json({ id, token: auth, host: true });
});
app.post("/api/rooms/:id/join", (req, res) => {
  const r = get(req.params.id);
  if (!r) return res.status(404).json({ error: "روم پیدا نشد." });
  const key = req.ip + req.params.id;
  let a = attempts.get(key);
  if (!a || Date.now() - a.start > 60000) {
    a = { count: 0, start: Date.now() };
    attempts.set(key, a);
  }
  if (++a.count > 20)
    return res.status(429).json({ error: "کمی صبر کنید و دوباره تلاش کنید." });
  const settings = JSON.parse(r.settings);
  if (settings.passwordHash) {
    const hash = scryptSync(
      String(req.body.password || ""),
      settings.passwordSalt,
      64,
    );
    if (!timingSafeEqual(hash, Buffer.from(settings.passwordHash, "hex")))
      return res.status(403).json({ error: "رمز روم درست نیست." });
  }
  const auth = token();
  sessions.set(auth, {
    room: r.id,
    name: clean(req.body.nickname, 30) || "شنونده",
  });
  res.json({ id: r.id, token: auth, host: false });
});
app.get("/api/rooms/:id", member, (req, res) =>
  res.json(snapshot(req.params.id)),
);
const upload = multer({
  dest: path.join(data, "uploads"),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) =>
    cb(
      null,
      [
        "audio/mpeg",
        "audio/mp3",
        "audio/wav",
        "audio/x-wav",
        "audio/ogg",
        "audio/mp4",
        "audio/flac",
        "audio/x-flac",
      ].includes(file.mimetype),
    ),
});
app.post(
  "/api/rooms/:id/tracks",
  member,
  (req, res, next) => {
    if (
      req.session.owner !== get(req.params.id).owner &&
      !JSON.parse(get(req.params.id).settings).guestUpload
    )
      return res
        .status(403)
        .json({ error: "آپلود برای مهمان‌ها غیرفعال است." });
    next();
  },
  upload.single("audio"),
  (req, res) => {
    if (!req.file)
      return res
        .status(400)
        .json({ error: "فرمت فایل صوتی پشتیبانی نمی‌شود." });
    const id = randomUUID();
    db.prepare("INSERT INTO tracks VALUES(?,?,?,?,?,?)").run(
      id,
      req.params.id,
      clean(req.file.originalname.replace(/\.[^.]+$/, ""), 150),
      req.file.filename,
      req.file.mimetype,
      req.file.size,
    );
    const r = get(req.params.id),
      state = JSON.parse(r.state);
    if (!state.trackId) {
      state.trackId = id;
      db.prepare("UPDATE rooms SET state=? WHERE id=?").run(
        JSON.stringify(state),
        r.id,
      );
    }
    broadcast(r.id);
    res.json({ id });
  },
);
app.get(
  "/api/rooms/:id/audio/:track",
  (req, res, next) => {
    req.headers.authorization = "Bearer " + req.query.token;
    next();
  },
  member,
  (req, res) => {
    const t = db
      .prepare("SELECT * FROM tracks WHERE id=? AND room=?")
      .get(req.params.track, req.params.id);
    if (!t) return res.sendStatus(404);
    res.set("Cache-Control", "private, no-store");
    res.type(t.mime).sendFile(path.join(data, "uploads", t.file));
  },
);
app.delete("/api/rooms/:id/tracks/:track", member, owner, (req, res) => {
  const t = db
    .prepare("SELECT * FROM tracks WHERE id=? AND room=?")
    .get(req.params.track, req.params.id);
  if (!t) return res.sendStatus(404);
  db.prepare("DELETE FROM tracks WHERE id=?").run(t.id);
  unlinkSync(path.join(data, "uploads", t.file));
  const r = get(req.params.id),
    s = JSON.parse(r.state);
  if (s.trackId === t.id) {
    s.trackId = null;
    s.playing = false;
    s.position = 0;
    db.prepare("UPDATE rooms SET state=? WHERE id=?").run(
      JSON.stringify(s),
      r.id,
    );
  }
  broadcast(r.id);
  res.json({ ok: true });
});
app.patch("/api/rooms/:id/settings", member, owner, (req, res) => {
  const r = get(req.params.id),
    s = JSON.parse(r.settings);
  for (const k of ["guestUpload", "guestControl", "chat", "repeat"])
    if (typeof req.body[k] === "boolean") s[k] = req.body[k];
  if (typeof req.body.password === "string") {
    if (req.body.password) {
      s.passwordSalt = token();
      s.passwordHash = scryptSync(
        req.body.password,
        s.passwordSalt,
        64,
      ).toString("hex");
    } else {
      delete s.passwordHash;
      delete s.passwordSalt;
    }
  }
  db.prepare("UPDATE rooms SET settings=?,name=? WHERE id=?").run(
    JSON.stringify(s),
    clean(req.body.name) || r.name,
    r.id,
  );
  broadcast(r.id);
  res.json({ ok: true });
});
io.use((socket, next) => {
  const s = sessions.get(socket.handshake.auth.token);
  if (!s) return next(new Error("نشست معتبر نیست؛ دوباره وارد شوید."));
  socket.data = s;
  next();
});
io.on("connection", (socket) => {
  const id = socket.data.room;
  socket.join(id);
  broadcast(id);
  socket.on("clock", (cb) => typeof cb === "function" && cb(Date.now()));
  socket.on("control", (payload) => {
    if (!payload || typeof payload !== "object") return;
    const r = get(id);
    if (!r) return;
    const settings = JSON.parse(r.settings);
    if (socket.data.owner !== r.owner && !settings.guestControl) return;
    const s = JSON.parse(r.state);
    if (payload.trackId !== undefined) {
      if (
        !db
          .prepare("SELECT id FROM tracks WHERE id=? AND room=?")
          .get(payload.trackId, id)
      )
        return;
      s.trackId = payload.trackId;
      s.position = 0;
    } else if (s.playing) s.position += (Date.now() - s.updatedAt) / 1000;
    if (
      typeof payload.position === "number" &&
      Number.isFinite(payload.position)
    )
      s.position = Math.max(0, payload.position);
    if (typeof payload.playing === "boolean") s.playing = payload.playing;
    s.updatedAt = Date.now();
    db.prepare("UPDATE rooms SET state=? WHERE id=?").run(
      JSON.stringify(s),
      id,
    );
    broadcast(id);
  });
  socket.on("chat", (value) => {
    if (!JSON.parse(get(id).settings).chat) return;
    const text = clean(value, 500);
    if (!text || Date.now() - (socket.data.lastChat || 0) < 750) return;
    socket.data.lastChat = Date.now();
    db.prepare("INSERT INTO messages VALUES(?,?,?,?,?)").run(
      randomUUID(),
      id,
      socket.data.name,
      text,
      Date.now(),
    );
    broadcast(id);
  });
  socket.on("disconnect", () => broadcast(id));
});
app.use((err, req, res, next) => {
  console.error(err.message);
  res
    .status(400)
    .json({
      error:
        err.code === "LIMIT_FILE_SIZE"
          ? "حداکثر حجم هر آهنگ ۵۰ مگابایت است."
          : "درخواست انجام نشد؛ دوباره تلاش کنید.",
    });
});
if (process.env.NODE_ENV === "production") {
  app.use(express.static("dist"));
  app.get("/{*path}", (req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () =>
  console.log(`Hamava listening on ${port}`),
);
