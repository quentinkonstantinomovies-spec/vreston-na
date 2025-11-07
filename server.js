const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const multer = require("multer");
const cors = require("cors");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 24 }
});

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = new Map();

// Code generator
function genCode(len = 5) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random()*chars.length)]).join("");
}

function publicRoom(code) {
  const r = rooms.get(code);
  if (!r) return null;
  return { 
    roomCode: code, 
    players: [...r.players].map(id => ({ id, username: r.usernames[id] || "Παίκτης" })),
    hostId: r.hostId 
  };
}

function opponentOf(room, me) {
  return [...room.players].find(p => p !== me) || null;
}

// SOCKETS
io.on("connection", (socket) => {

  // === Create Room ===
  socket.on("createRoom", ({ username }, cb) => {
    let code;
    do { code = genCode(); } while (rooms.has(code));

    rooms.set(code, {
      hostId: socket.id,
      players: new Set([socket.id]),
      images: [],
      secrets: {},
      usernames: { [socket.id]: username || "Παίκτης" },
      started: false
    });

    socket.join(code);
    cb?.({ ok: true, roomCode: code, role: "host" });
    io.to(socket.id).emit("youAreHost");
    io.to(code).emit("roomState", publicRoom(code));
  });

  // === Join Room ===
  socket.on("joinRoom", ({ roomCode, username }, cb) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: false, error: "Room not found" });

    socket.join(code);
    room.players.add(socket.id);
    room.usernames[socket.id] = username || "Παίκτης";

    if (room.hostId == null) room.hostId = socket.id;
    if (room.hostId === socket.id) io.to(socket.id).emit("youAreHost");

    cb?.({ ok: true, role: room.hostId === socket.id ? "host" : "guest", roomCode: code });
    io.to(code).emit("roomState", publicRoom(code));

    if (room.images.length) {
      const urls = room.images.map((_, i) => `/img/${code}/${i}`);
      io.to(socket.id).emit("imagesReady", { images: urls });
    }
  });

  // === Start Game ===
  socket.on("startGame", ({ roomCode }) => {
    const code = roomCode.toUpperCase();
    const room = rooms.get(code);
    if (!room) return;

    const players = [...room.players];
    const max = room.images.length;

    players.forEach(p => room.secrets[p] = Math.floor(Math.random()*max));
    players.forEach(p => io.to(p).emit("secretAssigned", { secretIndex: room.secrets[p] }));
    io.to(code).emit("gameStarted");
  });

  // === Chat ===
  socket.on("sendQuestion", ({ text, roomCode }) => {
    const code = roomCode.toUpperCase();
    const room = rooms.get(code);
    io.to(code).emit("receiveQuestion", { 
      text, 
      sender: room.usernames[socket.id] || "Παίκτης" 
    });
  });

  // === Guess ===
  socket.on("makeGuess", ({ roomCode, index }) => {
    const code = roomCode.toUpperCase();
    const room = rooms.get(code);
    if (!room) return;

    const opp = opponentOf(room, socket.id);
    const correct = (index === room.secrets[opp]);

    io.to(code).emit("guessResult", { 
      guesser: room.usernames[socket.id], 
      correct, 
      index 
    });

    io.to(code).emit("gameEnded", { winner: correct ? socket.id : opp });
  });

  // === Restart ===
  socket.on("restartGame", ({ roomCode }) => {
    const code = roomCode.toUpperCase();
    const room = rooms.get(code);
    if (!room) return;

    const players = [...room.players];
    const max = room.images.length;

    players.forEach(p => room.secrets[p] = Math.floor(Math.random()*max));
    io.to(code).emit("restartReady");
    players.forEach(p => io.to(p).emit("secretAssigned", { secretIndex: room.secrets[p] }));
  });

  // === Disconnect ===
  socket.on("disconnect", () => {
    for (const [code, room] of rooms) {
      if (room.players.has(socket.id)) {
        room.players.delete(socket.id);
        delete room.usernames[socket.id];
        if (room.hostId === socket.id) room.hostId = null;
        io.to(code).emit("roomState", publicRoom(code));
      }
    }
  });

});

// Upload
app.post("/upload/:room", upload.array("files", 24), (req, res) => {
  const code = req.params.room.toUpperCase();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ ok: false });

  room.images = req.files.map(f => ({ buffer: f.buffer, mimetype: f.mimetype }));
  const urls = room.images.map((_, i) => `/img/${code}/${i}`);
  io.to(code).emit("imagesReady", { images: urls });
  res.json({ ok: true, count: room.images.length, images: urls });
});

app.get("/img/:room/:idx", (req, res) => {
  const code = req.params.room.toUpperCase();
  const idx = parseInt(req.params.idx, 10);
  const room = rooms.get(code);
  if (!room || idx < 0 || idx >= room.images.length) return res.status(404).send("Not found");
  const file = room.images[idx];
  res.setHeader("Content-Type", file.mimetype);
  res.send(file.buffer);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ Server running on port ${PORT}`)
);
