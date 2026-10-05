const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true }
});

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  socket.on("create-room", (roomId) => {
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = "broadcaster";
    socket.emit("room-created", roomId);
  });

  socket.on("join-room", (roomId) => {
    const room = io.sockets.adapter.rooms.get(roomId);
    if (!room) {
      socket.emit("room-error", "Essa sala não existe.");
      return;
    }

    const broadcaster = [...room].find((id) => {
      const s = io.sockets.sockets.get(id);
      return s && s.data.role === "broadcaster";
    });

    if (!broadcaster) {
      socket.emit("room-error", "A transmissão ainda não está disponível.");
      return;
    }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = "viewer";
    socket.emit("joined-room", roomId);
    io.to(broadcaster).emit("viewer-joined", socket.id);
  });

  socket.on("offer", ({ target, offer }) => {
    io.to(target).emit("offer", { from: socket.id, offer });
  });

  socket.on("answer", ({ target, answer }) => {
    io.to(target).emit("answer", { from: socket.id, answer });
  });

  socket.on("ice-candidate", ({ target, candidate }) => {
    io.to(target).emit("ice-candidate", { from: socket.id, candidate });
  });

  socket.on("stop-broadcast", () => {
    const roomId = socket.data.roomId;
    if (roomId) socket.to(roomId).emit("broadcast-stopped");
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (roomId && socket.data.role === "broadcaster") {
      socket.to(roomId).emit("broadcast-stopped");
    }
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, HOST, () => {
  console.log(`ScreenLive rodando na porta ${PORT}`);
});
