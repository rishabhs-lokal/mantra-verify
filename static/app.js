const sessionId = getOrCreateSessionId();

const vyasFigure = document.getElementById("vyas-figure");
const vyasStatus = document.getElementById("vyas-status");
const vyasAudio = document.getElementById("vyas-audio");
const languageSelect = document.getElementById("language-select");

const recordBtn = document.getElementById("record-btn");
const recordIndicator = document.getElementById("record-indicator");
const verifyError = document.getElementById("verify-error");
const verifyResult = document.getElementById("verify-result");
const batchResult = document.getElementById("batch-result");
const batchModeCheckbox = document.getElementById("batch-mode");

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

// Resolves only once playback actually finishes (or errors out) — not just
// once it starts. `vyasAudio.play()` alone resolves on playback START, which
// isn't enough for callers that need to know when Vyas has stopped talking
// (e.g. before resuming mic listening, so his own voice isn't picked up as
// a false chant via speaker-to-mic leakage).
function speakAsVyas(text) {
  return new Promise(async (resolve) => {
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
        resolve();
      };

      await vyasAudio.play();
    } catch (err) {
      console.error(err);
      setVyasStatus("Vyas is listening.");
      resolve(); // resolve even on failure so awaiters never hang forever
    }
  });
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
  const isBatch = batchModeCheckbox.checked;
  setVyasStatus(isBatch ? "Vyas is counting your repetitions…" : "Vyas is checking your recitation…");

  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");
  formData.append("reference_text", document.getElementById("reference-text").value);
  formData.append("session_id", sessionId);
  formData.append("mantra_id", document.getElementById("mantra-id").value);
  formData.append("target_count", document.getElementById("target-count").value);
  formData.append("language", languageSelect.value);

  const endpoint = isBatch ? "/verify_batch" : "/verify";

  try {
    const response = await fetch(endpoint, { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || `Verification failed (${response.status})`);
    }
    if (isBatch) {
      renderBatchResult(data);
    } else {
      renderVerifyResult(data);
    }
    setVyasStatus("Vyas is listening.");
  } catch (err) {
    verifyError.textContent = err.message;
    verifyError.hidden = false;
    setVyasStatus("Vyas is listening.");
  }
}

function renderVerifyResult(data) {
  batchResult.hidden = true;
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

function renderBatchResult(data) {
  verifyResult.hidden = true;
  batchResult.hidden = false;

  document.getElementById("batch-detected").textContent = data.detected_repetitions;
  document.getElementById("batch-count").textContent = data.count;
  document.getElementById("batch-target").textContent = data.target_count;
  document.getElementById("batch-mala-complete").hidden = !data.mala_complete;
  document.getElementById("batch-transcript").textContent = data.transcript;

  const segmentsContainer = document.getElementById("batch-segments");
  segmentsContainer.innerHTML = "";
  if (data.segments.length === 0) {
    segmentsContainer.textContent = "No repetitions detected — try recording again with clearer pauses between each one.";
  } else {
    data.segments.forEach((segment, i) => {
      const span = document.createElement("span");
      span.className = "match";
      span.textContent = `#${i + 1} (${segment.score.toFixed(0)})`;
      segmentsContainer.appendChild(span);
    });
  }
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

// ---- Live Chanting Session ----
//
// Continuous mic listening with client-side voice activity detection (VAD):
// no streaming transcription exists (OpenRouter's Whisper endpoint is
// one-shot request/response), so this segments speech into individual
// utterances itself by watching microphone volume, and sends each one to
// /verify_chant as it ends. It reuses the same reference-text / mantra-id /
// target-count / language fields as the manual Recite flow above, and the
// same persistent session+mantra counter (via /verify_chant, which calls
// counter.increment exactly like /verify does) — this is a continuous-
// listening front end for the same counting backend, not a separate one.
//
// The RMS speech threshold and silence-gap timing below are untested
// against real microphone hardware/environments and will likely need
// tuning — they're a reasonable starting point, not a calibrated value.

const SESSION_SPEECH_RMS_THRESHOLD = 0.02; // volume above this counts as "speaking"
const SESSION_UTTERANCE_SILENCE_GAP_MS = 500; // silence this long marks the end of one utterance (lowered from 700 for faster turnaround)
const SESSION_MIN_UTTERANCE_MS = 400; // shorter than this is treated as noise, not a real chant, and isn't sent to the server
// Silence since the last COUNTED chant before the session pauses and shows
// the Resume button — no spoken prompt first anymore (an earlier version
// prompted at 10s and paused at 15s; the spoken prompt was cut, so this is
// just the single remaining threshold).
const SESSION_PAUSE_MS = 10000;
const SESSION_POLL_INTERVAL_MS = 75; // lowered from 150 for faster sound detection and faster barge-in reaction

const SESSION_ERROR_STREAK_LIMIT = 3; // this many consecutive not-counted attempts triggers re-teaching + pause

// Spoken reassurance is in Hindi throughout, regardless of the language
// selector — this is Vyas's own reassurance line, not mantra content.
// PLACEHOLDER — replace with the real line once you have it.
const COMPLETION_PLACEHOLDER_TEXT = "बहुत अच्छा। आपने जाप का यह चरण पूरा कर लिया है। शांति बनी रहे।";

const targetCountInput = document.getElementById("target-count");
const hearMantraBtn = document.getElementById("hear-mantra-btn");
const sessionStartBtn = document.getElementById("session-start-btn");
const sessionStopBtn = document.getElementById("session-stop-btn");
const sessionResumeBtn = document.getElementById("session-resume-btn");
const sessionCounterWrap = document.getElementById("session-counter-wrap");
const sessionCounterEl = document.getElementById("session-counter");
const sessionStatus = document.getElementById("session-status");
const sessionError = document.getElementById("session-error");
const sessionLog = document.getElementById("session-log");

// Available even outside a session — lets you check the correct
// pronunciation any time. Guards against picking up Vyas's own voice as a
// false chant if a session happens to be listening while this plays.
hearMantraBtn.addEventListener("click", async () => {
  if (session) session.vyasSpeaking = true;
  await speakAsVyas(document.getElementById("reference-text").value);
  if (session) session.vyasSpeaking = false;
});

function clampTargetCount() {
  let value = parseInt(targetCountInput.value, 10);
  if (isNaN(value)) value = 108;
  value = Math.max(1, Math.min(108, value));
  targetCountInput.value = value;
  return value;
}

targetCountInput.addEventListener("change", clampTargetCount);

let session = null;

function setSessionStatus(text) {
  sessionStatus.textContent = text;
}

function logSessionAttempt(text, counted, repetitionsCounted) {
  const div = document.createElement("div");
  div.className = `session-log-entry ${counted ? "counted" : "rejected"}`;
  const countLabel = repetitionsCounted > 1 ? ` (×${repetitionsCounted})` : "";
  div.textContent = `${counted ? "✓" : "✗"}${countLabel} "${text}"`;
  sessionLog.prepend(div);
}

async function startChantingSession() {
  sessionError.hidden = true;
  const targetCount = clampTargetCount();
  const mantraId = document.getElementById("mantra-id").value;

  // Always start a fresh countdown from the exact number selected — an
  // earlier version resumed from whatever count had already persisted for
  // this session+mantra, which looked like an unexplained drop when
  // re-testing rather than the intended "remembers your progress" behavior.
  try {
    await fetch(
      `/count/${encodeURIComponent(sessionId)}/reset?mantra_id=${encodeURIComponent(mantraId)}`,
      { method: "POST" }
    );
  } catch (err) {
    // Non-fatal — worst case this session's count starts from stale progress.
  }
  const startingRemaining = targetCount;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    sessionError.textContent = `Could not access microphone: ${err.message}`;
    sessionError.hidden = false;
    return;
  }

  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  session = {
    stream,
    audioContext,
    analyser,
    dataArray: new Uint8Array(analyser.fftSize),
    targetCount,
    isSpeaking: false,
    silenceStreakMs: 0,
    utteranceStartedAt: 0,
    currentRecorder: null,
    currentChunks: [],
    lastCountedChantAt: Date.now(),
    consecutiveErrors: 0,
    vyasSpeaking: false,
    isPaused: false,
    pollTimer: null,
  };

  sessionCounterWrap.hidden = false;
  sessionCounterEl.textContent = startingRemaining;
  sessionStartBtn.hidden = true;
  sessionStopBtn.hidden = false;
  sessionResumeBtn.hidden = true;
  sessionLog.innerHTML = "";

  if (startingRemaining <= 0) {
    await finishSession();
    return;
  }

  // Start the poll loop before Vyas even starts talking, not after — while
  // vyasSpeaking is true it only barge-in-monitors (see pollSession), but
  // that means sound is being watched for from the very first moment, so
  // speaking up during the initial mantra demonstration interrupts it
  // immediately instead of only working once normal listening begins.
  session.pollTimer = setInterval(pollSession, SESSION_POLL_INTERVAL_MS);

  // Say the mantra once before full listening starts, so you have a
  // correct-pronunciation reference before you begin.
  setSessionStatus("Vyas is demonstrating the mantra…");
  session.vyasSpeaking = true;
  await speakAsVyas(document.getElementById("reference-text").value);

  if (!session) return; // session may have been stopped while Vyas was speaking

  session.vyasSpeaking = false;
  setSessionStatus("Listening…");
}

function getRMS() {
  session.analyser.getByteTimeDomainData(session.dataArray);
  let sumSquares = 0;
  for (let i = 0; i < session.dataArray.length; i++) {
    const normalized = (session.dataArray[i] - 128) / 128;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / session.dataArray.length);
}

function pollSession() {
  if (!session || session.isPaused) return;

  const speaking = getRMS() > SESSION_SPEECH_RMS_THRESHOLD;

  // Barge-in: while Vyas is talking, don't do utterance capture — just
  // watch for sound and cut him off the instant any is heard, so you're
  // never stuck waiting for him to finish before you can keep chanting.
  if (session.vyasSpeaking) {
    if (speaking && !vyasAudio.paused) {
      vyasAudio.pause(); // triggers speakAsVyas's onpause handler, which resolves it
    }
    return;
  }

  if (speaking) {
    session.silenceStreakMs = 0;
    if (!session.isSpeaking) {
      session.isSpeaking = true;
      beginUtteranceRecording();
    }
  } else if (session.isSpeaking) {
    session.silenceStreakMs += SESSION_POLL_INTERVAL_MS;
    if (session.silenceStreakMs >= SESSION_UTTERANCE_SILENCE_GAP_MS) {
      session.isSpeaking = false;
      endUtteranceRecording();
    }
  }

  checkSilenceTimers();
}

function beginUtteranceRecording() {
  session.utteranceStartedAt = Date.now();
  session.currentChunks = [];
  session.currentRecorder = new MediaRecorder(session.stream);
  session.currentRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) session.currentChunks.push(e.data);
  };
  session.currentRecorder.start();
}

function endUtteranceRecording() {
  if (!session.currentRecorder || session.currentRecorder.state !== "recording") return;
  const duration = Date.now() - session.utteranceStartedAt;
  const chunks = session.currentChunks;
  session.currentRecorder.onstop = () => {
    if (duration < SESSION_MIN_UTTERANCE_MS) return; // too short to plausibly be a real chant
    submitChant(new Blob(chunks, { type: "audio/webm" }));
  };
  session.currentRecorder.stop();
}

// Short synthesized tones, not speech — while chanting your eyes are likely
// closed or unfocused, so a glance at the on-screen status/log text isn't a
// reliable way to know whether the last chant counted. These give instant
// audible confirmation without the latency (or interruption) of Vyas
// actually saying something.
function playTone(frequency, durationMs, volume) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = frequency;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000);
    osc.onended = () => ctx.close();
  } catch (err) {
    // non-fatal — silently skip the tone if the Web Audio API misbehaves
  }
}

function playCountedTone() {
  playTone(880, 150, 0.15); // bright, short chime
}

function playNotCountedTone() {
  playTone(220, 120, 0.08); // quieter, duller — deliberately less noticeable
}

async function submitChant(blob) {
  if (!session) return;
  setSessionStatus("Checking that chant…");

  const formData = new FormData();
  formData.append("audio", blob, "chant.webm");
  formData.append("reference_text", document.getElementById("reference-text").value);
  formData.append("session_id", sessionId);
  formData.append("mantra_id", document.getElementById("mantra-id").value);
  formData.append("target_count", session.targetCount);
  formData.append("language", languageSelect.value);

  try {
    const response = await fetch("/verify_chant", { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || `Chant check failed (${response.status})`);
    }

    if (data.transcript) logSessionAttempt(data.transcript, data.counted, data.repetitions_counted);

    if (data.counted) {
      playCountedTone();
      sessionCounterEl.textContent = data.remaining;
      session.lastCountedChantAt = Date.now();
      session.consecutiveErrors = 0;

      if (data.mala_complete) {
        await finishSession();
        return;
      }
    } else {
      playNotCountedTone();
      session.consecutiveErrors += 1;
      if (session.consecutiveErrors >= SESSION_ERROR_STREAK_LIMIT) {
        await handleRepeatedErrors();
        return;
      }
    }

    if (session && !session.isPaused) setSessionStatus("Listening…");
  } catch (err) {
    sessionError.textContent = err.message;
    sessionError.hidden = false;
  }
}

function checkSilenceTimers() {
  if (!session || session.isPaused) return;
  const elapsed = Date.now() - session.lastCountedChantAt;

  if (elapsed >= SESSION_PAUSE_MS) {
    pauseSession();
  }
}

async function handleRepeatedErrors() {
  session.consecutiveErrors = 0;
  setSessionStatus("Vyas is repeating the mantra for you…");
  session.vyasSpeaking = true;
  await speakAsVyas(document.getElementById("reference-text").value);
  if (!session) return; // stopped while Vyas was speaking
  session.vyasSpeaking = false;
  pauseSession();
}

function pauseSession() {
  if (!session || session.isPaused) return;
  session.isPaused = true;
  clearInterval(session.pollTimer);
  if (session.isSpeaking) endUtteranceRecording();
  sessionResumeBtn.hidden = false;
  setSessionStatus("Paused — click Resume to continue.");
}

function resumeSession() {
  if (!session) return;
  session.isPaused = false;
  session.lastCountedChantAt = Date.now();
  sessionResumeBtn.hidden = true;
  setSessionStatus("Listening…");
  session.pollTimer = setInterval(pollSession, SESSION_POLL_INTERVAL_MS);
}

async function finishSession() {
  setSessionStatus("Complete! 🕉");
  stopChantingSession(false);
  await speakAsVyas(COMPLETION_PLACEHOLDER_TEXT);
}

function stopChantingSession(userInitiated = true) {
  if (!session) return;
  clearInterval(session.pollTimer);
  if (session.currentRecorder && session.currentRecorder.state === "recording") {
    session.currentRecorder.stop();
  }
  session.stream.getTracks().forEach((track) => track.stop());
  session.audioContext.close();

  sessionStartBtn.hidden = false;
  sessionStopBtn.hidden = true;
  sessionResumeBtn.hidden = true;
  if (userInitiated) setSessionStatus("Session stopped.");

  session = null;
}

sessionStartBtn.addEventListener("click", startChantingSession);
sessionStopBtn.addEventListener("click", () => stopChantingSession(true));
sessionResumeBtn.addEventListener("click", resumeSession);
