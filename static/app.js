const sessionId = getOrCreateSessionId();

const vyasFigure = document.getElementById("vyas-figure");
const vyasStatus = document.getElementById("vyas-status");
const vyasAudio = document.getElementById("vyas-audio");
const languageSelect = document.getElementById("language-select");

const recordBtn = document.getElementById("record-btn");
const recordIndicator = document.getElementById("record-indicator");
const verifyError = document.getElementById("verify-error");
const verifyResult = document.getElementById("verify-result");

const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatError = document.getElementById("chat-error");

let mediaRecorder = null;
let recordedChunks = [];

function getOrCreateSessionId() {
  let id = localStorage.getItem("vyas_session_id");
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) || `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem("vyas_session_id", id);
  }
  return id;
}

function setVyasStatus(text) {
  vyasStatus.textContent = text;
}

async function speakAsVyas(text) {
  try {
    const response = await fetch("/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || `Speech synthesis failed (${response.status})`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    vyasAudio.src = url;

    vyasAudio.onplay = () => {
      vyasFigure.classList.add("speaking");
      setVyasStatus("Vyas is speaking…");
    };
    vyasAudio.onended = vyasAudio.onpause = () => {
      vyasFigure.classList.remove("speaking");
      setVyasStatus("Vyas is listening.");
      URL.revokeObjectURL(url);
    };

    await vyasAudio.play();
  } catch (err) {
    console.error(err);
    setVyasStatus("Vyas is listening.");
  }
}

// ---- Mantra recording + /verify ----

recordBtn.addEventListener("click", async () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    return;
  }
  await startRecording();
});

async function startRecording() {
  verifyError.hidden = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      recordBtn.textContent = "Start Recording";
      recordBtn.classList.remove("recording");
      recordIndicator.hidden = true;
      const blob = new Blob(recordedChunks, { type: "audio/webm" });
      submitVerification(blob);
    };

    mediaRecorder.start();
    recordBtn.textContent = "Stop Recording";
    recordBtn.classList.add("recording");
    recordIndicator.hidden = false;
    setVyasStatus("Vyas is listening to your recitation…");
  } catch (err) {
    verifyError.textContent = `Could not access microphone: ${err.message}`;
    verifyError.hidden = false;
  }
}

async function submitVerification(audioBlob) {
  verifyError.hidden = true;
  setVyasStatus("Vyas is checking your recitation…");

  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");
  formData.append("reference_text", document.getElementById("reference-text").value);
  formData.append("session_id", sessionId);
  formData.append("mantra_id", document.getElementById("mantra-id").value);
  formData.append("target_count", document.getElementById("target-count").value);
  formData.append("language", languageSelect.value);

  try {
    const response = await fetch("/verify", { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || `Verification failed (${response.status})`);
    }
    renderVerifyResult(data);
    setVyasStatus("Vyas is listening.");
  } catch (err) {
    verifyError.textContent = err.message;
    verifyError.hidden = false;
    setVyasStatus("Vyas is listening.");
  }
}

function renderVerifyResult(data) {
  verifyResult.hidden = false;

  document.getElementById("result-score").textContent = data.score.toFixed(0);
  document.getElementById("result-completion").textContent = `${Math.round(data.completion_ratio * 100)}%`;
  const passedEl = document.getElementById("result-passed");
  passedEl.textContent = data.passed ? "Passed" : "Try again";
  passedEl.style.color = data.passed ? "#2f7a3d" : "#b5241f";

  document.getElementById("result-count").textContent = data.count;
  document.getElementById("result-target").textContent = data.target_count;
  document.getElementById("result-mala-complete").hidden = !data.mala_complete;

  document.getElementById("result-transcript").textContent = data.transcript;

  const diffContainer = document.getElementById("result-word-diff");
  diffContainer.innerHTML = "";
  data.word_diff.forEach(([word, tag]) => {
    const span = document.createElement("span");
    span.className = tag;
    span.textContent = word;
    diffContainer.appendChild(span);
  });
}

// ---- Chat with Vyas ----

function appendChatMessage(role, text, pending = false) {
  const div = document.createElement("div");
  div.className = `chat-msg ${role}${pending ? " pending" : ""}`;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;

  chatError.hidden = true;
  appendChatMessage("user", message);
  chatInput.value = "";
  const pendingBubble = appendChatMessage("vyas", "…", true);

  try {
    const response = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message, language: languageSelect.value }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || `Chat failed (${response.status})`);
    }
    pendingBubble.textContent = data.reply;
    pendingBubble.classList.remove("pending");
    speakAsVyas(data.reply);
  } catch (err) {
    pendingBubble.remove();
    chatError.textContent = err.message;
    chatError.hidden = false;
    setVyasStatus("Vyas is listening.");
  }
});
