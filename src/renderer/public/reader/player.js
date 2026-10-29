"use strict";
const video = document.getElementById("stream");
const statusEl = document.getElementById("status");
const player = document.getElementById("player");
const fadeLayer = document.getElementById("broadcast-fade");
const unmuteBtn = document.getElementById("unmute");
let socket, peer, reconnectTimer, mediaTimeout, closed = false, pendingIce = [];
let retry = 900;

// state: "busy" (spinner), "idle" (message only), "live"
function setStatus(text, state = "busy") {
  statusEl.textContent = text;
  const live = state === "live";
  document.body.dataset.live = live;
  document.body.dataset.idle = state === "idle";
  unmuteBtn.hidden = !(live && video.muted);
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function resetPeer() {
  if (peer) {
    peer.onconnectionstatechange = null;
    peer.close();
  }
  clearTimeout(mediaTimeout);
  mediaTimeout = null;
  peer = null;
  pendingIce = [];
  video.srcObject = null;
  fadeLayer.style.opacity = "0";
}

function reconnect() {
  if (closed || reconnectTimer) return;
  setStatus("Connection lost. Reconnecting…");
  resetPeer();
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, retry);
  retry = Math.min(Math.round(retry * 1.8), 10000);
}

function connect() {
  if (closed) return;
  socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/signal`);
  const currentSocket = socket;
  let messages = Promise.resolve();
  currentSocket.onopen = () => {
    retry = 900;
    setStatus("Finding your host…");
    send({ type: "register-viewer" });
  };
  currentSocket.onmessage = (event) => {
    if (currentSocket !== socket) return;
    messages = messages.then(() => {
      if (currentSocket === socket) return handle(JSON.parse(event.data));
    }).catch((error) => {
      console.error("Unable to negotiate broadcast:", error);
      setStatus("Unable to negotiate video. Retrying…");
      currentSocket.close();
    });
  };
  currentSocket.onclose = () => { if (currentSocket === socket) reconnect(); };
  currentSocket.onerror = () => currentSocket.close();
}

async function handle(message) {
  switch (message.type) {
    case "connected":
      break;
    case "live":
      resetPeer();
      const connection = new RTCPeerConnection({ iceServers: [] });
      peer = connection;
      connection.onicecandidate = (event) => {
        if (event.candidate && connection === peer) send({ type: "signal", payload: event.candidate.toJSON() });
      };
      connection.ondatachannel = (event) => {
        const channel = event.channel;
        if (channel.label !== "presentation") {
          channel.close();
          return;
        }
        channel.onmessage = (dataEvent) => {
          try {
            const update = JSON.parse(String(dataEvent.data));
            if (update.type === "presentation-fade" && Number.isFinite(update.value)) {
              fadeLayer.style.opacity = String(Math.max(0, Math.min(1, update.value)));
            }
          } catch {
            console.warn("Ignoring invalid presentation update.");
          }
        };
      };
      connection.ontrack = (event) => {
        if (connection !== peer) return;
        event.track.onunmute = () => {
          if (connection === peer) setStatus("Receiving video…");
        };
        if (event.streams[0]) video.srcObject = event.streams[0];
        else {
          if (!video.srcObject) video.srcObject = new MediaStream();
          video.srcObject.addTrack(event.track);
        }
        video.play().catch(() => setStatus("Tap to play the broadcast.", "idle"));
      };
      connection.onconnectionstatechange = () => {
        if (connection !== peer) return;
        if (connection.connectionState === "connected") {
          setStatus("Connected; waiting for video…");
          clearTimeout(mediaTimeout);
          mediaTimeout = setTimeout(() => {
            if (connection === peer && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
              setStatus("Connected, but no video frames are arriving.", "idle");
            }
          }, 8000);
        }
        if (["failed", "disconnected", "closed"].includes(connection.connectionState)) {
          setStatus("The connection was interrupted. Reconnecting…");
          connection.close();
          peer = null;
          socket?.close();
        }
      };
      send({ type: "viewer-ready" });
      setStatus("Preparing the public display…");
      break;
    case "offline":
      resetPeer();
      setStatus("Waiting for the host to start broadcasting…", "idle");
      break;
    case "signal":
      if (!peer || !message.payload) return;
      if (message.payload.type) {
        await peer.setRemoteDescription(message.payload);
        if (message.payload.type === "offer") {
          await peer.setLocalDescription(await peer.createAnswer());
          send({ type: "signal", payload: peer.localDescription.toJSON() });
        }
        for (const candidate of pendingIce) await peer.addIceCandidate(candidate);
        pendingIce = [];
      } else if (message.payload.candidate) {
        if (peer.remoteDescription) await peer.addIceCandidate(message.payload);
        else pendingIce.push(message.payload);
      }
      break;
    case "error":
      setStatus(message.message || "Broadcast unavailable.", "idle");
      break;
  }
}

/* ---------- Custom player ---------- */
const playBtn = document.getElementById("play");
const muteBtn = document.getElementById("mute");
const volume = document.getElementById("volume");
const fsBtn = document.getElementById("fs");
let lastVolume = 1, idleTimer;

function togglePlay() { video.paused ? video.play().catch(() => {}) : video.pause(); }
function toggleMute() {
  video.muted = !video.muted;
  if (!video.muted && video.volume === 0) video.volume = lastVolume || 1;
}
function inFullscreen() { return document.fullscreenElement === player || document.webkitFullscreenElement === player; }
function toggleFullscreen() {
  if (inFullscreen()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else if (player.requestFullscreen) player.requestFullscreen().catch(() => {});
  else if (player.webkitRequestFullscreen) player.webkitRequestFullscreen();
  else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
}
function wakeControls() {
  player.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!video.paused) player.classList.add("idle"); }, 2500);
}

playBtn.onclick = togglePlay;
muteBtn.onclick = toggleMute;
fsBtn.onclick = toggleFullscreen;
volume.oninput = () => { video.volume = +volume.value; video.muted = video.volume === 0; if (video.volume > 0) lastVolume = video.volume; };
unmuteBtn.onclick = () => { video.muted = false; video.play().catch(() => {}); };
document.getElementById("overlay").onclick = () => video.play().catch(() => {});
video.addEventListener("click", togglePlay);
video.addEventListener("dblclick", toggleFullscreen);
video.addEventListener("play", () => { player.classList.remove("paused"); wakeControls(); });
video.addEventListener("pause", () => { player.classList.add("paused"); wakeControls(); });
video.addEventListener("volumechange", () => {
  player.classList.toggle("muted", video.muted || video.volume === 0);
  volume.value = video.muted ? 0 : video.volume;
  unmuteBtn.hidden = !(document.body.dataset.live === "true" && video.muted);
});
video.addEventListener("playing", () => {
  if (peer) {
    clearTimeout(mediaTimeout);
    setStatus("Live", "live");
  }
});
document.addEventListener("fullscreenchange", () => player.classList.toggle("is-fs", inFullscreen()));
document.addEventListener("webkitfullscreenchange", () => player.classList.toggle("is-fs", inFullscreen()));
["pointermove", "pointerdown", "keydown"].forEach(e => player.addEventListener(e, wakeControls));
player.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT") return;
  if (e.key === " " || e.key === "k") { e.preventDefault(); togglePlay(); }
  else if (e.key === "m") toggleMute();
  else if (e.key === "f") toggleFullscreen();
});
video.volume = 1;
player.classList.add("muted");

window.addEventListener("pagehide", () => {
  closed = true;
  clearTimeout(reconnectTimer);
  resetPeer();
  socket?.close();
});
connect();