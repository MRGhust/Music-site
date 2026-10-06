import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import {
  AudioLines,
  Plus,
  Headphones,
  Users,
  Settings,
  Upload,
  Link,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  MessageCircle,
  Music2,
  X,
  Send,
  Trash2,
  Check,
  Lock,
  Radio,
  ChevronLeft,
  Copy,
  Repeat2,
  LogOut,
} from "lucide-react";
import "./style.css";
const fmt = (n) =>
  `${Math.floor((n || 0) / 60)}:${String(Math.floor((n || 0) % 60)).padStart(2, "0")}`;
function App() {
  const [session, setSession] = useState(() => {
      try {
        const saved = JSON.parse(localStorage.getItem("hamava-session"));
        const invited = new URLSearchParams(location.search).get("room");
        return invited && saved?.id !== invited ? null : saved;
      } catch {
        return null;
      }
    }),
    [room, setRoom] = useState(null),
    [modal, setModal] = useState(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [chat, setChat] = useState(""),
    [volume, setVolume] = useState(0.7),
    [position, setPosition] = useState(0),
    [duration, setDuration] = useState(0),
    [enabled, setEnabled] = useState(false),
    [tab, setTab] = useState("queue");
  const audio = useRef(null),
    sock = useRef(null),
    offset = useRef(0),
    state = useRef(null),
    file = useRef(null),
    bottom = useRef(null);
  const params = new URLSearchParams(location.search),
    invite = params.get("room");
  const notify = (t) => {
    setToast(t);
    setTimeout(() => setToast(""), 3200);
  };
  async function request(url, opts = {}) {
    const r = await fetch(url, {
      ...opts,
      headers: {
        ...(opts.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
        ...opts.headers,
      },
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "ارتباط با سرور برقرار نشد.");
    return d;
  }
  useEffect(() => {
    if (!session) {
      if (invite) setModal("join");
      return;
    }
    let alive = true;
    request(`/api/rooms/${session.id}`)
      .then((d) => alive && setRoom(d))
      .catch((e) => {
        setError(e.message);
        setSession(null);
        localStorage.removeItem("hamava-session");
      });
    const s = io({ auth: { token: session.token } });
    sock.current = s;
    const calibrate = () => {
      const sent = Date.now();
      s.emit(
        "clock",
        (server) => (offset.current = server - (sent + Date.now()) / 2),
      );
    };
    s.on("connect", calibrate);
    const timer = setInterval(calibrate, 10000);
    s.on("room", (r) => {
      setRoom(r);
      state.current = r;
    });
    s.on("connect_error", (e) => setError(e.message));
    s.on("disconnect", () => notify("ارتباط قطع شد؛ در حال اتصال مجدد…"));
    return () => {
      alive = false;
      s.disconnect();
      clearInterval(timer);
    };
  }, [session]);
  useEffect(() => {
    if (!room) return;
    state.current = room;
    const a = audio.current;
    if (!a) return;
    const t = room.state.trackId;
    const url = t
      ? `/api/rooms/${room.id}/audio/${t}?token=${session.token}`
      : "";
    if (a.dataset.track !== t) {
      a.pause();
      a.dataset.track = t || "";
      a.src = url;
      setDuration(0);
    }
    const sync = () => {
      const r = state.current;
      if (!r?.state.trackId) return;
      const target =
        r.state.position +
        (r.state.playing
          ? Math.max(0, Date.now() + offset.current - r.state.updatedAt) / 1000
          : 0);
      if (Number.isFinite(a.duration) && Math.abs(a.currentTime - target) > 0.3)
        a.currentTime = Math.min(target, a.duration);
      if (r.state.playing && enabled) a.play().catch(() => setEnabled(false));
      else a.pause();
    };
    sync();
    a.addEventListener("loadedmetadata", sync);
    const timer = setInterval(sync, 2000);
    return () => {
      clearInterval(timer);
      a.removeEventListener("loadedmetadata", sync);
    };
  }, [room, enabled]);
  useEffect(() => {
    audio.current.volume = volume;
  }, [volume]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [room?.messages.length]);
  const control = (p) => sock.current?.emit("control", p),
    canControl = session?.host || room?.settings.guestControl,
    tracks = room?.tracks || [],
    current = tracks.find((t) => t.id === room?.state.trackId),
    index = tracks.findIndex((t) => t.id === current?.id);
  function next(direction = 1) {
    if (!tracks.length) return;
    let i = index + direction;
    if (i >= tracks.length) {
      if (room.settings.repeat) i = 0;
      else return control({ playing: false, position: 0 });
    }
    if (i < 0) i = 0;
    control({ trackId: tracks[i].id, playing: true });
  }
  async function enter(e, join = false) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const id =
        form.code?.trim().split("room=")[1]?.split("&")[0] || form.code?.trim();
      const d = await request(
        join ? `/api/rooms/${encodeURIComponent(id)}/join` : "/api/rooms",
        { method: "POST", body: JSON.stringify(form) },
      );
      localStorage.setItem("hamava-session", JSON.stringify(d));
      setSession(d);
      history.replaceState(null, "", `?room=${d.id}`);
      setModal(null);
      setEnabled(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(files) {
    setBusy(true);
    try {
      for (const f of files) {
        const data = new FormData();
        data.append("audio", f);
        await request(`/api/rooms/${room.id}/tracks`, {
          method: "POST",
          body: data,
        });
      }
      notify("آهنگ‌ها به صف اضافه شدند");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      file.current.value = "";
    }
  }
  async function saveSettings(e) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const body = {
        name: f.get("name"),
        guestUpload: f.has("guestUpload"),
        guestControl: f.has("guestControl"),
        chat: f.has("chat"),
        repeat: f.has("repeat"),
      };
      if (f.get("changePassword")) body.password = f.get("password");
      await request(`/api/rooms/${room.id}/settings`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setModal(null);
      notify("تنظیمات ذخیره شد");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/?room=${room.id}`,
      );
      notify("لینک دعوت کپی شد");
    } catch {
      setModal("invite");
    }
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="/" onClick={(e) => e.preventDefault()}>
          <span className="brand-icon">
            <AudioLines />
          </span>
          <span>
            هم‌آوا<small>HAMAVA</small>
          </span>
        </a>
        <div className="nav-label">فضای موسیقی شما</div>
        <button className="nav active" onClick={() => setTab("queue")}>
          <Headphones size={20} />
          روم من<span className="tiny">{room ? "۱" : "۰"}</span>
        </button>
        <button className="nav" onClick={() => setModal("create")}>
          <Plus size={20} />
          ساخت روم جدید
        </button>
        <button className="nav" onClick={() => setModal("join")}>
          <Users size={20} />
          پیوستن به روم
        </button>
        <div className="sidebar-note">
          <div className="mini-bars">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <h3>موسیقی، وقتی با همیم.</h3>
          <p>
            یک آهنگ خوب، یک جمع خوب.
            <br />
            همین برای یک لحظهٔ خوب کافی‌ست.
          </p>
        </div>
        <div className="profile">
          <div className="avatar">{room ? "ش" : "♪"}</div>
          <div>
            <strong>{session ? "شما" : "دوست موسیقی"}</strong>
            <small>
              {session?.host ? "میزبان روم" : session ? "شنونده" : "خوش آمدید"}
            </small>
          </div>
          {session && (
            <button
              title="خروج از روم"
              aria-label="خروج از روم"
              onClick={() => {
                setSession(null);
                setRoom(null);
                localStorage.removeItem("hamava-session");
                history.replaceState(null, "", "/");
                audio.current.pause();
              }}
            >
              <LogOut size={18} />
            </button>
          )}
        </div>
      </aside>
      <div className="workspace">
        <header>
          <div className="breadcrumb">
            فضای موسیقی <ChevronLeft size={14} />
            <span>{room ? "روم من" : "شروع یک دورهمی"}</span>
          </div>
          <div className="header-actions">
            <span className="connection">
              <i />
              {room ? "متصل به روم" : "آماده برای شنیدن"}
            </span>
            <button
              className="round"
              aria-label="راهنمای هم‌آوا"
              onClick={() => setModal("help")}
            >
              <Headphones size={18} />
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR SHARED SOUNDSPACE</div>
              <h1>{room?.name || "جای شما و آهنگ‌های خوب"}</h1>
              <p>
                {room
                  ? "از هر جا که هستید، یک آهنگ را با هم بشنوید."
                  : "یک روم بسازید و حال خوب را با دوستانتان شریک شوید."}
              </p>
            </div>
            <div className="heading-actions">
              {room ? (
                <>
                  <button
                    className="secondary"
                    onClick={() => setModal("settings")}
                  >
                    <Settings size={17} />
                    تنظیمات روم
                  </button>
                  <button className="primary" onClick={share}>
                    <Link size={17} />
                    دعوت دوستان
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="secondary"
                    onClick={() => setModal("join")}
                  >
                    <Users size={17} />
                    پیوستن به روم
                  </button>
                  <button
                    className="primary"
                    onClick={() => setModal("create")}
                  >
                    <Plus size={18} />
                    ساخت روم
                  </button>
                </>
              )}
            </div>
          </div>
          <section className="listening-card">
            <div className="record-area">
              <div
                className={`record ${room?.state.playing && enabled ? "spinning" : ""}`}
              >
                <div className="record-label">
                  <AudioLines size={40} />
                  <span>
                    HAMAVA
                    <br />
                    SIDE A • 33 RPM
                  </span>
                </div>
              </div>
              <div className="record-caption">
                A LITTLE CLOSER THROUGH MUSIC
              </div>
            </div>
            <div className="now-playing">
              <div className="live-label">
                <span className="equalizer">
                  <i />
                  <i />
                  <i />
                </span>
                {current ? "در حال شنیدن با هم" : "یک لحظه برای با هم بودن"}
              </div>
              <h2>{current?.title || "آهنگ اول، با شما"}</h2>
              <p>
                {current
                  ? "همه در یک ریتم، همه در یک لحظه."
                  : "آهنگ محبوبتان را آپلود کنید؛ باقی‌اش یک لینک دعوت است."}
              </p>
              <div className="waveform">
                {Array.from({ length: 65 }, (_, i) => (
                  <i
                    key={i}
                    style={{
                      height: `${12 + Math.sin(i * 0.7) ** 2 * 36 + Math.cos(i * 0.19) ** 2 * 14}px`,
                      opacity: i / 65 < position / (duration || 1) ? 1 : 0.28,
                    }}
                  />
                ))}
              </div>
              {room ? (
                <div className="room-caption">
                  <Lock size={14} />
                  <span>روم دعوتی</span>
                  <span className="separator">/</span>
                  <Users size={14} />
                  <span>{room.members.length.toLocaleString("fa")} شنونده</span>
                </div>
              ) : (
                <button
                  className="text-button"
                  onClick={() => setModal("create")}
                >
                  اولین روم خود را بسازید <Plus size={16} />
                </button>
              )}
            </div>
            <span className="card-corner">LISTEN TOGETHER</span>
          </section>
          <div className="content-grid">
            <section className="queue panel">
              <div className="panel-heading">
                <div className="tabs">
                  <button
                    className={tab === "queue" ? "selected" : ""}
                    onClick={() => setTab("queue")}
                  >
                    صف پخش <span>{tracks.length.toLocaleString("fa")}</span>
                  </button>
                  <button
                    className={tab === "members" ? "selected" : ""}
                    onClick={() => setTab("members")}
                  >
                    شنونده‌ها
                  </button>
                </div>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    room ? file.current.click() : setModal("create")
                  }
                >
                  <Plus size={17} />
                  {busy ? "در حال آپلود…" : "افزودن آهنگ"}
                </button>
              </div>
              <input
                ref={file}
                type="file"
                accept="audio/*"
                multiple
                hidden
                onChange={(e) => upload([...e.target.files])}
              />
              {tab === "members" ? (
                <div className="members-list">
                  {room?.members.map((m) => (
                    <div key={m.id} className="member">
                      <div className="avatar">{m.name[0]}</div>
                      <strong>{m.name}</strong>
                      <span>{m.host ? "میزبان" : "شنونده"}</span>
                    </div>
                  )) || <p>با ساخت روم، دوستانتان را دعوت کنید.</p>}
                </div>
              ) : tracks.length ? (
                <div className="track-list">
                  <div className="track-labels">
                    <span>#</span>
                    <span>آهنگ</span>
                    <span>حجم</span>
                    <span />
                  </div>
                  {tracks.map((t, i) => (
                    <div
                      className={`track ${t.id === current?.id ? "playing-track" : ""}`}
                      key={t.id}
                    >
                      <button
                        aria-label={`پخش ${t.title}`}
                        disabled={!canControl}
                        onClick={() =>
                          control({ trackId: t.id, playing: true })
                        }
                      >
                        {t.id === current?.id ? (
                          <AudioLines size={17} />
                        ) : (
                          String(i + 1).padStart(2, "0")
                        )}
                      </button>
                      <div>
                        <strong>{t.title}</strong>
                        <small>آپلود شده در روم</small>
                      </div>
                      <span dir="ltr">
                        {(t.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                      {session.host && (
                        <button
                          aria-label={`حذف ${t.title}`}
                          onClick={async () => {
                            try {
                              await request(
                                `/api/rooms/${room.id}/tracks/${t.id}`,
                                { method: "DELETE" },
                              );
                            } catch (e) {
                              setError(e.message);
                            }
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  className="upload-empty"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (room) upload([...e.dataTransfer.files]);
                  }}
                >
                  <div className="upload-icon">
                    <Upload size={25} />
                  </div>
                  <h3>جای آهنگ‌های شما خالی‌ست</h3>
                  <p>آهنگ‌ها را اینجا رها کنید، یا از دستگاهتان انتخاب کنید.</p>
                  <button
                    className="secondary"
                    disabled={
                      busy ||
                      (!!room && !(session.host || room.settings.guestUpload))
                    }
                    onClick={() =>
                      room ? file.current.click() : setModal("create")
                    }
                  >
                    <Music2 size={17} />
                    انتخاب آهنگ
                  </button>
                  <small>MP3, WAV, OGG, M4A, FLAC · حداکثر ۵۰ مگابایت</small>
                </div>
              )}
              <div className="panel-footer">
                <Radio size={15} />
                <span>پخش هماهنگ برای تمام شنونده‌های روم</span>
                <span className="subtle-badge">LIVE SYNC</span>
              </div>
            </section>
            <section className="chat panel">
              <div className="panel-heading">
                <h3>
                  <MessageCircle size={18} />
                  گپ روم
                </h3>
                <span className="subtle-badge">
                  {room?.members.length || 0} آنلاین
                </span>
              </div>
              <div className="messages">
                {room?.messages.length ? (
                  room.messages.map((m) => (
                    <div className="message" key={m.id}>
                      <div className="message-meta">
                        <strong>{m.name}</strong>
                        <time>
                          {new Date(m.time).toLocaleTimeString("fa", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                      <p>{m.text}</p>
                    </div>
                  ))
                ) : (
                  <div className="chat-empty">
                    <div>
                      <MessageCircle size={27} />
                    </div>
                    <h3>آهنگ‌ها بهانه‌اند.</h3>
                    <p>
                      از همین‌جا گفت‌وگو را شروع کنید
                      <br />و حال این لحظه را شریک شوید.
                    </p>
                    <span>✦</span>
                  </div>
                )}
                <div ref={bottom} />
              </div>
              <form
                className="chat-input"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (chat.trim()) {
                    sock.current?.emit("chat", chat);
                    setChat("");
                  }
                }}
              >
                <input
                  aria-label="پیام شما"
                  placeholder={
                    room?.settings.chat === false
                      ? "گفت‌وگو غیرفعال است"
                      : "چیزی بنویسید…"
                  }
                  disabled={!room || !room.settings.chat}
                  maxLength={500}
                  value={chat}
                  onChange={(e) => setChat(e.target.value)}
                />
                <button
                  aria-label="ارسال پیام"
                  disabled={!room || !room.settings.chat || !chat.trim()}
                >
                  <Send size={17} />
                </button>
              </form>
            </section>
          </div>
          <div className="below-note">
            <AudioLines size={15} />
            <span>فاصله‌ها کمتر می‌شوند، وقتی یک آهنگ را با هم می‌شنویم.</span>
            <span>ساخته شده برای با هم شنیدن</span>
          </div>
        </main>
      </div>
      <footer className="player">
        <div className="player-song">
          <div className="small-cover">
            <AudioLines size={24} />
          </div>
          <div>
            <strong>{current?.title || "هنوز آهنگی انتخاب نشده"}</strong>
            <small>{room?.name || "هم‌آوا · با هم گوش کنیم"}</small>
          </div>
        </div>
        <div className="player-main">
          <div className="player-controls">
            <button
              title="تکرار صف"
              aria-label="تکرار صف"
              className={room?.settings.repeat ? "mint" : ""}
              disabled={!session?.host}
              onClick={async () => {
                try {
                  await request(`/api/rooms/${room.id}/settings`, {
                    method: "PATCH",
                    body: JSON.stringify({ repeat: !room.settings.repeat }),
                  });
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              <Repeat2 size={17} />
            </button>
            <button
              aria-label="آهنگ قبلی"
              disabled={!current || !canControl}
              onClick={() => next(-1)}
            >
              <SkipForward size={20} />
            </button>
            <button
              className="play-button"
              aria-label={room?.state.playing ? "توقف" : "پخش"}
              disabled={!current}
              onClick={() => {
                setEnabled(true);
                if (canControl) control({ playing: !room.state.playing });
                else if (room.state.playing)
                  audio.current
                    .play()
                    .catch(() => notify("برای فعال‌سازی صدا دوباره تلاش کنید"));
                else notify("منتظر شروع پخش توسط میزبان باشید");
              }}
            >
              {room?.state.playing && enabled ? (
                <Pause size={21} fill="currentColor" />
              ) : (
                <Play size={21} fill="currentColor" />
              )}
            </button>
            <button
              aria-label="آهنگ بعدی"
              disabled={!current || !canControl}
              onClick={() => next()}
            >
              <SkipBack size={20} />
            </button>
            <span className="sync-label">
              <i />
              همگام
            </span>
          </div>
          <div className="timeline" dir="ltr">
            <time>{fmt(position)}</time>
            <input
              aria-label="موقعیت پخش"
              type="range"
              min="0"
              max={duration || 1}
              step=".1"
              value={Math.min(position, duration || 1)}
              disabled={!current || !canControl}
              onChange={(e) => control({ position: Number(e.target.value) })}
            />
            <time>{fmt(duration)}</time>
          </div>
        </div>
        <div className="volume">
          <button
            aria-label="قطع صدا"
            onClick={() => setVolume(volume ? 0 : 0.7)}
          >
            {volume ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
          <input
            aria-label="بلندی صدا"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
          <span>{Math.round(volume * 100)}%</span>
        </div>
      </footer>
      <audio
        ref={audio}
        onTimeUpdate={(e) => setPosition(e.target.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.target.duration)}
        onEnded={() => session?.host && next()}
        onError={() =>
          current && notify("فایل صوتی قابل پخش نیست؛ آهنگ دیگری انتخاب کنید.")
        }
      />
      {room && current && !enabled && (
        <button
          className="enable-audio"
          onClick={() => {
            setEnabled(true);
            audio.current.play().catch(() => {});
          }}
        >
          <Headphones size={18} />
          برای شنیدن، صدا را فعال کنید
        </button>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button aria-label="بستن خطا" onClick={() => setError("")}>
            <X size={17} />
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {modal && (
        <div className="overlay" onClick={() => setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="روم"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="بستن"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            <div className="modal-icon">
              {modal === "settings" ? (
                <Settings />
              ) : modal === "join" ? (
                <Users />
              ) : (
                <AudioLines />
              )}
            </div>
            {modal === "create" || modal === "join" ? (
              <>
                <h2>
                  {modal === "create"
                    ? "یک روم، یک حال خوب"
                    : "به جمع دوستان بپیوندید"}
                </h2>
                <p>
                  {modal === "create"
                    ? "نامی برای روم انتخاب کنید و موسیقی را شروع کنید."
                    : "کد یا لینک دعوت روم را وارد کنید."}
                </p>
                <form onSubmit={(e) => enter(e, modal === "join")}>
                  <label>
                    نام شما
                    <input
                      name="nickname"
                      required
                      maxLength={30}
                      placeholder="با چه نامی صدایتان کنیم؟"
                      autoFocus
                    />
                  </label>
                  <label>
                    {modal === "create" ? "نام روم" : "کد یا لینک روم"}
                    <input
                      name={modal === "create" ? "name" : "code"}
                      required
                      defaultValue={modal === "join" ? invite || "" : ""}
                      placeholder={
                        modal === "create" ? "مثلاً: شب‌های آرام" : "کد دعوت"
                      }
                      maxLength={200}
                    />
                  </label>
                  {modal === "join" && (
                    <label>
                      رمز روم (در صورت نیاز)
                      <input type="password" name="password" />
                    </label>
                  )}
                  <button className="primary full" disabled={busy}>
                    {busy
                      ? "لطفاً صبر کنید…"
                      : modal === "create"
                        ? "ساخت روم"
                        : "ورود به روم"}
                  </button>
                </form>
              </>
            ) : modal === "settings" ? (
              <>
                <h2>تنظیمات روم</h2>
                {session.host ? (
                  <form onSubmit={saveSettings}>
                    <label>
                      نام روم
                      <input
                        name="name"
                        defaultValue={room.name}
                        required
                        maxLength={100}
                      />
                    </label>
                    {[
                      [
                        "guestUpload",
                        "آپلود توسط مهمان‌ها",
                        "همه بتوانند آهنگ اضافه کنند.",
                      ],
                      [
                        "guestControl",
                        "کنترل مشترک پخش",
                        "مهمان‌ها هم پخش را کنترل کنند.",
                      ],
                      [
                        "chat",
                        "گفت‌وگوی روم",
                        "پیام‌های دوستان در کنار موسیقی.",
                      ],
                      [
                        "repeat",
                        "تکرار صف",
                        "پس از آخرین آهنگ، از ابتدا پخش شود.",
                      ],
                    ].map(([k, t, d]) => (
                      <label className="switch-row" key={k}>
                        <span>
                          <strong>{t}</strong>
                          <small>{d}</small>
                        </span>
                        <input
                          type="checkbox"
                          name={k}
                          defaultChecked={room.settings[k]}
                        />
                      </label>
                    ))}
                    <label className="switch-row">
                      <span>تغییر یا حذف رمز روم</span>
                      <input type="checkbox" name="changePassword" />
                    </label>
                    <input
                      type="password"
                      name="password"
                      placeholder="رمز جدید؛ خالی برای حذف رمز"
                      maxLength={128}
                    />
                    <button className="primary full" disabled={busy}>
                      ذخیرهٔ تنظیمات
                    </button>
                  </form>
                ) : (
                  <p>تنظیمات روم توسط میزبان مدیریت می‌شود.</p>
                )}
              </>
            ) : modal === "invite" ? (
              <>
                <h2>دعوت دوستان</h2>
                <input
                  readOnly
                  value={`${location.origin}/?room=${room.id}`}
                  onFocus={(e) => e.target.select()}
                />
              </>
            ) : (
              <>
                <h2>با هم گوش کنیم</h2>
                <p>
                  یک روم بسازید، فایل‌های صوتی را اضافه کنید و لینک دعوت را برای
                  دوستانتان بفرستید. پخش و توقف میزبان برای همه هماهنگ می‌شود.
                </p>
                <p>
                  هر شنونده باید یک‌بار صدا را فعال کند. بلندی صدا فقط روی
                  دستگاه خودتان تغییر می‌کند. کنترل مهمان‌ها و رمز ورود را از
                  تنظیمات روم مدیریت کنید.
                </p>
                <p>
                  فایل‌هایی را به اشتراک بگذارید که اجازهٔ استفاده از آن‌ها را
                  دارید.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
