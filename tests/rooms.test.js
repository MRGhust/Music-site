import { test } from "node:test";
import assert from "node:assert/strict";
import { io } from "socket.io-client";
const origin = process.env.TEST_URL || "http://localhost:3000";
async function api(route, body, token, method = "POST") {
  const r = await fetch(origin + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
const waitRoom = (s, predicate) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Error("Room event timed out")),
      5000,
    );
    const cb = (r) => {
      if (predicate(r)) {
        clearTimeout(timeout);
        s.off("room", cb);
        resolve(r);
      }
    };
    s.on("room", cb);
  });
test("shared rooms enforce ownership, password and synchronize playback/chat", async () => {
  const host = await api("/api/rooms", { name: "Test room", nickname: "Host" });
  assert.equal(host.status, 200);
  const id = host.body.id;
  const guest = await api(`/api/rooms/${id}/join`, { nickname: "Guest" });
  const hs = io(origin, { auth: { token: host.body.token } }),
    gs = io(origin, { auth: { token: guest.body.token } });
  try {
    await Promise.all([
      waitRoom(hs, (r) => r.members.length === 2),
      waitRoom(gs, (r) => r.members.length === 2),
    ]);
    const denied = await api(
      `/api/rooms/${id}/settings`,
      { chat: false },
      guest.body.token,
      "PATCH",
    );
    assert.equal(denied.status, 403);
    const wav = Buffer.alloc(44 + 16000);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(16000, 40);
    const form = new FormData();
    form.append("audio", new Blob([wav], { type: "audio/wav" }), "test.wav");
    const uploaded = await fetch(`${origin}/api/rooms/${id}/tracks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${host.body.token}` },
      body: form,
    });
    assert.equal(uploaded.status, 200);
    const track = await uploaded.json();
    const event = waitRoom(
      gs,
      (r) => r.state.playing && r.state.trackId === track.id,
    );
    hs.emit("control", { trackId: track.id, playing: true, position: 0.3 });
    const shared = await event;
    assert.equal(shared.state.position, 0.3);
    const seek = waitRoom(gs, (r) => r.state.position === 0.5);
    hs.emit("control", { position: 0.5 });
    await seek;
    const chat = waitRoom(hs, (r) =>
      r.messages.some((m) => m.text === "Hello together"),
    );
    gs.emit("chat", "Hello together");
    await chat;
    assert.equal(
      (
        await fetch(
          `${origin}/api/rooms/${id}/audio/${track.id}?token=${guest.body.token}`,
          { headers: { Range: "bytes=0-43" } },
        )
      ).status,
      206,
    );
    await api(
      `/api/rooms/${id}/settings`,
      { password: "secret" },
      host.body.token,
      "PATCH",
    );
    assert.equal(
      (await api(`/api/rooms/${id}/join`, { password: "wrong" })).status,
      403,
    );
    assert.equal(
      (await api(`/api/rooms/${id}/join`, { password: "secret" })).status,
      200,
    );
  } finally {
    hs.disconnect();
    gs.disconnect();
  }
});
