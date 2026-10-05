const socket = io();
const $ = (id) => document.getElementById(id);

const pages = {
  home: $("home"),
  broadcast: $("broadcast"),
  watch: $("watch")
};

let currentRoom = null;
let localStream = null;
let isBroadcaster = false;
const peerConnections = new Map();
const pendingCandidates = new Map();

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

// Opcional: configure TURN pelo navegador via /turn-config em uma versão posterior.
async function createPeerConnection(remoteId) {
  if (peerConnections.has(remoteId)) return peerConnections.get(remoteId);

  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections.set(remoteId, pc);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", {
        target: remoteId,
        candidate: event.candidate
      });
    }
  };

  pc.ontrack = (event) => {
    if (!isBroadcaster) {
      $("remoteVideo").srcObject = event.streams[0];
      $("watchPlaceholder").classList.add("hidden");
      $("watchStatus").textContent = "Ao vivo";
      $("remoteVideo").play().catch(() => {});
    }
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (!isBroadcaster) $("watchStatus").textContent = state;

    if (state === "failed") {
      setTimeout(() => reconnectViewer(remoteId), 1500);
    }

    if (state === "closed") {
      peerConnections.delete(remoteId);
    }
  };

  return pc;
}

async function applySenderSettings(pc) {
  const bitrate = $("bitrate").value;
  const fps = Number($("fps").value);

  for (const sender of pc.getSenders()) {
    if (!sender.track || sender.track.kind !== "video") continue;

    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];

    params.encodings[0].maxFramerate = fps;

    if (bitrate !== "auto") {
      params.encodings[0].maxBitrate = Number(bitrate) * 1000;
    }

    try {
      await sender.setParameters(params);
    } catch (e) {
      console.warn("Não foi possível aplicar bitrate/FPS:", e);
    }
  }
}

async function reconnectViewer(remoteId) {
  if (isBroadcaster || !currentRoom) return;

  const old = peerConnections.get(remoteId);
  if (old) {
    try { old.close(); } catch {}
    peerConnections.delete(remoteId);
  }

  // O broadcaster normalmente cria uma nova oferta quando o viewer reconecta.
  socket.emit("viewer-reconnect", { roomId: currentRoom });
}

function showPage(name) {
  Object.values(pages).forEach(p => p.classList.add("hidden"));
  pages[name].classList.remove("hidden");
}

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function roomFromUrl() {
  return new URLSearchParams(location.search).get("room");
}

async function startBroadcast(roomId) {
  currentRoom = roomId;
  isBroadcaster = true;
  showPage("broadcast");

  const quality = Number($("quality").value);
  const fps = Number($("fps").value);
  const wantAudio = $("audio").checked;

  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: quality === 1080 ? 1920 : quality === 720 ? 1280 : quality === 480 ? 854 : 640 },
        height: { ideal: quality === 1080 ? 1080 : quality === 720 ? 720 : quality === 480 ? 480 : 360 },
        frameRate: { ideal: fps, max: fps }
      },
      audio: wantAudio
    });

    $("localVideo").srcObject = localStream;
    $("shareLink").value = `${location.origin}/?room=${encodeURIComponent(roomId)}`;
    $("status").textContent = "Ao vivo";

    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) videoTrack.addEventListener("ended", stopBroadcast);

  } catch (err) {
    $("homeError").textContent = "Não foi possível iniciar a captura: " + err.message;
    stopBroadcast(false);
  }
}

async function handleViewerJoined(viewerId) {
  if (!localStream) return;

  const pc = await createPeerConnection(viewerId);
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  await applySenderSettings(pc);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit("offer", {
    target: viewerId,
    offer: pc.localDescription
  });
}

function stopBroadcast(notify = true) {
  if (notify) socket.emit("stop-broadcast");

  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  peerConnections.forEach(pc => pc.close());
  peerConnections.clear();
  isBroadcaster = false;
  currentRoom = null;
  location.href = location.origin;
}

$("createBtn").onclick = async () => {
  const roomId = makeRoomId();
  socket.emit("create-room", roomId);
  await startBroadcast(roomId);
};

$("joinBtn").onclick = () => {
  const roomId = $("roomInput").value.trim().toUpperCase();
  if (!roomId) return;
  currentRoom = roomId;
  isBroadcaster = false;
  showPage("watch");
  $("watchStatus").textContent = "Entrando...";
  socket.emit("join-room", roomId);
};

$("copyBtn").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("shareLink").value);
    $("copyBtn").textContent = "Copiado!";
    setTimeout(() => $("copyBtn").textContent = "Copiar link", 1200);
  } catch {}
};

$("stopBtn").onclick = () => stopBroadcast(true);

socket.on("room-error", (msg) => {
  $("homeError").textContent = msg;
  $("watchError").textContent = msg;
  showPage("home");
});

socket.on("viewer-joined", handleViewerJoined);

socket.on("offer", async ({ from, offer }) => {
  if (isBroadcaster) return;

  const pc = await createPeerConnection(from);
  await pc.setRemoteDescription(offer);

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit("answer", {
    target: from,
    answer: pc.localDescription
  });
});

socket.on("answer", async ({ from, answer }) => {
  const pc = peerConnections.get(from);
  if (pc) await pc.setRemoteDescription(answer);
});

socket.on("ice-candidate", async ({ from, candidate }) => {
  const pc = peerConnections.get(from);
  if (!pc) return;

  try {
    if (pc.remoteDescription) {
      await pc.addIceCandidate(candidate);
    } else {
      const list = pendingCandidates.get(from) || [];
      list.push(candidate);
      pendingCandidates.set(from, list);
    }
  } catch (e) {
    console.warn("ICE candidate:", e);
  }
});

socket.on("broadcast-stopped", () => {
  $("watchStatus").textContent = "Transmissão encerrada";
  $("watchPlaceholder").classList.remove("hidden");
  $("remoteVideo").srcObject = null;
});

const initialRoom = roomFromUrl();
if (initialRoom) {
  $("roomInput").value = initialRoom;
  currentRoom = initialRoom;
  isBroadcaster = false;
  showPage("watch");
  socket.emit("join-room", initialRoom);
}
