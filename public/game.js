// Δένω ΟΛΑ μετά το DOMContentLoaded για να εξαλείψουμε race conditions
document.addEventListener("DOMContentLoaded", () => {

// Connect
const socket = io({ reconnection: true, reconnectionAttempts: 20, reconnectionDelay: 500 });

// ===== Sounds =====
const SFX = {
  click: new Audio("/sounds/click.mp3"),
  win:   new Audio("/sounds/win.mp3"),
  fail:  new Audio("/sounds/fail.mp3"),
  reset: new Audio("/sounds/reset.mp3"),
};
Object.values(SFX).forEach(a => { a.preload = "auto"; a.volume = 0.45; });

// ===== MUTE =====
let muted = false;
const btnMute = document.getElementById("btnMute");
function updateMuteButton() {
  btnMute.textContent = muted ? "🔇" : "🔊";
  Object.values(SFX).forEach(a => a.volume = muted ? 0 : 0.45);
}
btnMute?.addEventListener("click", () => { muted = !muted; updateMuteButton(); });
updateMuteButton();

// Unlock audio first user gesture
function unlockAudio() {
  Object.values(SFX).forEach(a => { a.play().catch(()=>{}); a.pause(); a.currentTime = 0; });
}
document.addEventListener("click", unlockAudio, { once: true });
document.addEventListener("touchstart", unlockAudio, { once: true });

// ===== State =====
const state = {
  role: null,
  roomCode: null,
  images: [],
  eliminated: new Set(),
  mySecretIndex: null,
  isGuessMode: false
};

// ===== DOM =====
const lobbySection   = document.getElementById("lobbySection");
const gameSection    = document.getElementById("gameSection");

const roomBadge      = document.getElementById("roomBadge");
const roleInfo       = document.getElementById("roleInfo");
const playersInfo    = document.getElementById("playersInfo");
const boardPreview   = document.getElementById("boardPreview");

const joinCode       = document.getElementById("joinCode");
const btnCreate      = document.getElementById("btnCreate");
const btnJoin        = document.getElementById("btnJoin");

const dropzone       = document.getElementById("dropzone");
const btnUpload      = document.getElementById("btnUpload");
const fileInputMobile= document.getElementById("fileInputMobile");
const btnMobileSelect= document.getElementById("btnMobileSelect");
const uploadStatus   = document.getElementById("uploadStatus");
const btnStart       = document.getElementById("btnStart");

const board          = document.getElementById("board");
const secretPreview  = document.getElementById("secretPreview");
const btnGuess       = document.getElementById("btnGuess");
const btnResetElims  = document.getElementById("btnResetElims");
const btnRestart     = document.getElementById("btnRestart");

// CHAT
const chatPanel   = document.getElementById("chatPanel");
const chatBubble  = document.getElementById("chatBubble");
const chatClose   = document.getElementById("chatClose");
const chatLog     = document.getElementById("chatLog");
const chatInput   = document.getElementById("chatInput");
const btnSendChat = document.getElementById("btnSendChat");

// RESULT MODAL
const resultModal   = document.getElementById("resultModal");
const resultText    = document.getElementById("resultText");
const modalRestart  = document.getElementById("modalRestart");
const modalNewBoard = document.getElementById("modalNewBoard");

// SCORE
const scoreBoard = document.getElementById("scoreBoard");
let myWins = 0, myLosses = 0;
function updateScoreLabel() {
  scoreBoard.textContent = `👑 ${myWins}  •  💀 ${myLosses}`;
  scoreBoard.classList.add("score-pop");
  setTimeout(() => scoreBoard.classList.remove("score-pop"), 300);
}

updateScoreLabel();

// ===== Helpers =====
function showModal(text) {
  resultText.textContent = text;
  resultModal.classList.remove("hidden");
  resultModal.classList.add("flex");
}
function hideModal() {
  resultModal.classList.add("hidden");
  resultModal.classList.remove("flex");
}
modalRestart.onclick  = () => { hideModal(); btnRestart.click(); };
modalNewBoard.onclick = () => { hideModal(); location.reload(); };

function updateRoomBadge() {
  if (state.roomCode) {
    roomBadge.classList.remove("hidden");
    roomBadge.textContent = `Δωμάτιο: ${state.roomCode}`;
    if (joinCode) joinCode.value = state.roomCode;
  } else {
    roomBadge.classList.add("hidden");
  }
}

function pushChat(prefix, text, mine = false) {
  const row = document.createElement("div");
  row.className = mine ? "chat-row mine" : "chat-row";
  row.textContent = `${prefix} ${text}`;
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
}
function openChat()  { chatPanel.classList.add("panel-open"); }
function closeChat() { chatPanel.classList.remove("panel-open"); }

// Resize/compress image
async function resizeImage(file, maxSize = 512) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  const scale = maxSize / Math.max(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(new File([blob], file.name, { type: "image/jpeg" }));
    }, "image/jpeg", 0.75);
  });
}

// ===== Lobby =====
socket.on("youAreHost", () => {
  state.role = "host";
  roleInfo.textContent = "Ρόλος: Host ✅";
});

btnCreate?.addEventListener("click", () => {
  socket.emit("createRoom", {}, (res) => {
    if (!res?.ok) return alert(res?.error || "Σφάλμα");
    state.role = res.role;
    state.roomCode = res.roomCode;
    updateRoomBadge();
    roleInfo.textContent = "Ρόλος: Host ✅";
  });
});

btnJoin?.addEventListener("click", () => {
  const code = (joinCode.value || "").trim().toUpperCase();
  if (!code) return alert("Βάλε κωδικό.");
  socket.emit("joinRoom", { roomCode: code }, (res) => {
    if (!res?.ok) return alert(res?.error || "Σφάλμα σύνδεσης.");
    state.role = res.role;
    state.roomCode = res.roomCode;
    updateRoomBadge();
    roleInfo.textContent = res.role === "host" ? "Ρόλος: Host ✅" : "Ρόλος: Παίκτης";
  });
});

socket.on("roomState", (st) => {
  if (!st) return;
  playersInfo.textContent = `Παίκτες: ${st.players.length}/2`;
  state.roomCode = st.roomCode;
  updateRoomBadge();
});

// ===== Upload Images =====
let localFiles = [];
btnMobileSelect?.addEventListener("click", () => fileInputMobile.click());

fileInputMobile?.addEventListener("change", () => {
  const files = Array.from(fileInputMobile.files).filter(f => /^image\/(png|jpe?g)$/i.test(f.type));
  if (!files.length) return;
  localFiles = files.slice(0, 24);
  uploadStatus.textContent = `Επιλέχθηκαν ${localFiles.length} εικόνες.`;
});

["dragenter","dragover"].forEach(ev =>
  dropzone?.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add("dragover"); })
);
["dragleave","drop"].forEach(ev =>
  dropzone?.addEventListener(ev, e => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (ev === "drop") {
      const files = Array.from(e.dataTransfer.files).filter(f => /^image\/(png|jpe?g)$/i.test(f.type));
      if (!files.length) return;
      localFiles = files.slice(0, 24);
      uploadStatus.textContent = `Επιλέχθηκαν ${localFiles.length} εικόνες.`;
    }
  })
);

btnUpload?.addEventListener("click", async () => {
  if (state.role !== "host") return alert("Μόνο ο Host ανεβάζει.");
  if (!state.roomCode) return alert("Δεν είσαι σε δωμάτιο.");
  if (!localFiles.length) return alert("Επίλεξε εικόνες.");

  uploadStatus.textContent = "Συμπίεση...";
  const resized = [];
  for (const f of localFiles) resized.push(await resizeImage(f, 512));

  const form = new FormData();
  resized.forEach(f => form.append("files", f));

  uploadStatus.textContent = "Αποστολή...";
  const res = await fetch(`/upload/${state.roomCode}`, { method: "POST", body: form });
  const data = await res.json();
  if (!data.ok) return alert("Σφάλμα.");

  state.images = data.images;
  uploadStatus.textContent = `✅ ${data.count} εικόνες στάλθηκαν.`;
  renderBoard();
  renderBoardPreview();
});

// ===== Start / Restart =====
btnStart?.addEventListener("click", () => {
  if (state.role !== "host") return;
  if (!state.roomCode) return;
  if ((state.images || []).length < 4) return alert("Ελάχιστο: 4 εικόνες.");
  socket.emit("startGame", { roomCode: state.roomCode });
});

btnRestart?.addEventListener("click", () => {
  if (!state.roomCode) return;
  socket.emit("restartGame", { roomCode: state.roomCode });
});

socket.on("restartReady", () => {
  state.eliminated.clear();
  state.isGuessMode = false;
  renderBoard();
  renderSecret();
  SFX.reset.play();
  pushChat("Σύστημα:", "🔄 Νέος γύρος!");
});

// ===== Game =====
socket.on("imagesReady", ({ images }) => {
  state.images = images;
  renderBoard();
  renderBoardPreview();
});

socket.on("gameStarted", () => {
  lobbySection.classList.add("hidden");
  gameSection.classList.remove("hidden");
  openChat();
});

socket.on("secretAssigned", ({ secretIndex }) => {
  state.mySecretIndex = secretIndex;
  renderSecret();
});

// ===== Guessing =====
btnGuess?.addEventListener("click", () => {
  if (!state.images.length) return;
  state.isGuessMode = true;
  alert("Κάνε κλικ στη μυστική κάρτα του αντιπάλου.");
});

socket.on("guessResult", ({ guesser, correct }) => {
  const me = (guesser === socket.id);
  if (correct) SFX.win.play(); else SFX.fail.play();
  pushChat("Σύστημα:", me ? (correct ? "🎉 ΚΕΡΔΙΣΕΣ!" : "❌ Λάθος.") :
                             (correct ? "😅 Έχασες." : "✅ Δεν σε βρήκε!"));
});

// ===== END GAME POPUP + SCORE =====
socket.on("gameEnded", ({ winner }) => {
  const me = (winner === socket.id);
  if (me) myWins++; else myLosses++;
  updateScoreLabel();
  showModal(me ? "🏆 ΝΙΚΗΣΕΣ!" : "😅 ΕΧΑΣΕΣ!");
});

// ===== Reset Eliminations =====
btnResetElims?.addEventListener("click", () => {
  state.eliminated.clear();
  renderBoard();
  SFX.reset.play();
});

// ===== Chat =====
btnSendChat?.addEventListener("click", sendChat);
chatInput?.addEventListener("keydown", e => { if (e.key === "Enter") sendChat(); });
chatBubble?.addEventListener("click", () => chatPanel.classList.toggle("panel-open"));
chatClose?.addEventListener("click", closeChat);

function sendChat() {
  const txt = chatInput.value.trim();
  if (!txt || !state.roomCode) return;
  socket.emit("sendQuestion", { text: txt, roomCode: state.roomCode });
  pushChat("Εσύ:", txt, true);
  chatInput.value = "";
}
socket.on("receiveQuestion", ({ text, sender }) => {
  if (sender === socket.id) return;
  pushChat("Αντίπαλος:", text, false);
});

// ===== Rendering =====
function renderBoard() {
  board.innerHTML = "";
  state.images.forEach((src, idx) => {
    const card = document.createElement("div");
    card.className = "card aspect-square bg-black/20";
    if (state.eliminated.has(idx)) card.classList.add("eliminated");

    const img = document.createElement("img");
    img.src = src;
    img.alt = `img-${idx}`;
    card.appendChild(img);

    card.onclick = () => {
      if (state.isGuessMode) {
        socket.emit("makeGuess", { roomCode: state.roomCode, index: idx });
        state.isGuessMode = false;
        return;
      }
      SFX.click.play();
      if (state.eliminated.has(idx)) state.eliminated.delete(idx);
      else state.eliminated.add(idx);
      renderBoard();
    };

    board.appendChild(card);
  });
}

function renderBoardPreview() {
  boardPreview.innerHTML = "";
  state.images.forEach((src) => {
    const card = document.createElement("div");
    card.className = "card aspect-square bg-black/20";
    const img = document.createElement("img");
    img.src = src;
    img.alt = "prev";
    card.appendChild(img);
    boardPreview.appendChild(card);
  });
}

function renderSecret() {
  secretPreview.innerHTML = "";
  if (state.mySecretIndex == null || !state.images.length) return;
  const img = document.createElement("img");
  img.src = state.images[state.mySecretIndex];
  img.alt = "secret";
  img.className = "rounded-md max-h-40";
  secretPreview.appendChild(img);
}

}); // DOMContentLoaded
