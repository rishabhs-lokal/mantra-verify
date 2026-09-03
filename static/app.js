const sessionId = getOrCreateSessionId();

const vyasFigure = document.getElementById("vyas-figure");
const vyasStatus = document.getElementById("vyas-status");
const vyasAudio = document.getElementById("vyas-audio");

// Hardcoded since the settings UI (language/mantra text/mantra id) was
// removed to keep the screen to just Vyas's portrait and the counter card.
// If more than one mantra or language is ever needed again, this is the
// one place to reintroduce configurability.
const REFERENCE_TEXT = "ॐ नमः शिवाय";
const MANTRA_ID = "om-namah-shivaya";
const LANGUAGE = "hi";

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

// ---- Chanting: shared elements + mode toggle ----
//
// Two modes, selected before Start is pressed:
// - "user": you chant, the mic listens continuously (VAD-segmented), each
//   recognized chant counts down — see the User-Chants section below.
// - "vyas": Vyas does the chanting (video, once provided — TTS fallback
//   until then) for however many repetitions you selected; no
//   listening/counting logic runs at all in this mode.

const targetCountInput = document.getElementById("target-count");
const modeUserBtn = document.getElementById("mode-user-btn");
const modeVyasBtn = document.getElementById("mode-vyas-btn");
const sessionStartBtn = document.getElementById("session-start-btn");
const sessionStopBtn = document.getElementById("session-stop-btn");
const sessionResumeBtn = document.getElementById("session-resume-btn");
const sessionCounterWrap = document.getElementById("session-counter-wrap");
const sessionCounterEl = document.getElementById("session-counter");
const sessionStatus = document.getElementById("session-status");
const sessionError = document.getElementById("session-error");

const MAX_CHANTS_PER_SESSION = 12;

let currentMode = "user"; // "user" | "vyas"

function setMode(mode) {
  if (session || vyasModeRunning) return; // don't allow switching mid-session
  currentMode = mode;
  modeUserBtn.classList.toggle("active", mode === "user");
  modeVyasBtn.classList.toggle("active", mode === "vyas");
}

modeUserBtn.addEventListener("click", () => setMode("user"));
modeVyasBtn.addEventListener("click", () => setMode("vyas"));

function clampTargetCount() {
  let value = parseInt(targetCountInput.value, 10);
  if (isNaN(value)) value = MAX_CHANTS_PER_SESSION;
  value = Math.max(1, Math.min(MAX_CHANTS_PER_SESSION, value));
  targetCountInput.value = value;
  return value;
}

targetCountInput.addEventListener("change", clampTargetCount);

function setSessionStatus(text) {
  sessionStatus.textContent = text;
}

// Spoken reassurance is in Hindi throughout — this is Vyas's own
// reassurance line, not mantra content.
// PLACEHOLDER — replace with the real line once you have it.
const COMPLETION_PLACEHOLDER_TEXT = "बहुत अच्छा। आपने जाप का यह चरण पूरा कर लिया है। शांति बनी रहे।";

sessionStartBtn.addEventListener("click", () => {
  if (currentMode === "vyas") {
    startVyasChantingMode();
  } else {
    startChantingSession();
  }
});
sessionStopBtn.addEventListener("click", () => {
  if (currentMode === "vyas") {
    stopVyasChantingMode();
  } else {
    stopChantingSession(true);
  }
});
sessionResumeBtn.addEventListener("click", resumeSession);

// ---- Vyas Chants mode: playback loop, no verification at all ----

// PLACEHOLDER: set this to the real video path once the asset is provided
// (e.g. "/vyas-chant.mp4"). Until then, each "play" falls back to speaking
// the mantra via TTS, so the mode is fully testable without the asset.
const VYAS_CHANT_VIDEO_SRC = null;

const vyasChantVideo = document.getElementById("vyas-chant-video");
let vyasModeRunning = false;

function playVyasChantOnce() {
  if (VYAS_CHANT_VIDEO_SRC) {
    return new Promise((resolve) => {
      vyasChantVideo.src = VYAS_CHANT_VIDEO_SRC;
      vyasChantVideo.hidden = false;
      vyasChantVideo.onended = () => {
        vyasChantVideo.hidden = true;
        resolve();
      };
      vyasChantVideo.play();
    });
  }
  return speakAsVyas(REFERENCE_TEXT);
}

async function startVyasChantingMode() {
  const count = clampTargetCount();
  vyasModeRunning = true;

  sessionCounterWrap.hidden = false;
  sessionCounterEl.textContent = count;
  sessionStartBtn.hidden = true;
  sessionStopBtn.hidden = false;
  sessionResumeBtn.hidden = true;

  for (let remaining = count; remaining > 0; remaining--) {
    if (!vyasModeRunning) break;
    await playVyasChantOnce();
    if (!vyasModeRunning) break;
    sessionCounterEl.textContent = remaining - 1;
  }

  sessionStartBtn.hidden = false;
  sessionStopBtn.hidden = true;

  if (vyasModeRunning) {
    setSessionStatus("Complete! 🕉");
    await speakAsVyas(COMPLETION_PLACEHOLDER_TEXT);
  } else {
    setSessionStatus("Stopped.");
  }
  vyasModeRunning = false;
}

function stopVyasChantingMode() {
  vyasModeRunning = false;
  vyasAudio.pause();
  vyasChantVideo.pause();
}

// ---- User Chants mode: continuous mic listening ----
//
// Client-side voice activity detection (VAD): no streaming transcription
// exists (OpenRouter's Whisper endpoint is one-shot request/response), so
// this segments speech into individual utterances itself by watching
// microphone volume, and sends each one to /verify_chant as it ends.
//
// The RMS speech threshold and silence-gap timing below are untested
// against real microphone hardware/environments and will likely need
// tuning — they're a reasonable starting point, not a calibrated value.

const SESSION_SPEECH_RMS_THRESHOLD = 0.02; // volume above this counts as "speaking"
const SESSION_UTTERANCE_SILENCE_GAP_MS = 500; // silence this long marks the end of one utterance
const SESSION_MIN_UTTERANCE_MS = 400; // shorter than this is treated as noise, not a real chant, and isn't sent to the server
// Silence since the last COUNTED chant before the session pauses and shows
// the Resume button — no spoken prompt first, just the pause.
const SESSION_PAUSE_MS = 10000;
const SESSION_POLL_INTERVAL_MS = 75;

const SESSION_ERROR_STREAK_LIMIT = 3; // this many consecutive not-counted attempts triggers re-teaching + pause

// The first few chants are assumed correct rather than verified — no audio
// is even sent to the server for these, just an immediate counter
// increment (see countFreeChant()) — before real per-chant analysis
// (submitChant()) takes over for the rest of the session.
const FREE_CHANTS_AT_START = 3;

let session = null;

async function startChantingSession() {
  sessionError.hidden = true;
  const targetCount = clampTargetCount();

  // Always start a fresh countdown from the exact number selected, rather
  // than resuming whatever count had already persisted for this
  // session+mantra — resuming looked like an unexplained drop when
  // re-testing rather than the intended "remembers your progress" behavior.
  try {
    await fetch(
      `/count/${encodeURIComponent(sessionId)}/reset?mantra_id=${encodeURIComponent(MANTRA_ID)}`,
      { method: "POST" }
    );
  } catch (err) {
    // Non-fatal — worst case this session's count starts from stale progress.
  }

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
    freeChantsRemaining: FREE_CHANTS_AT_START,
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
  sessionCounterEl.textContent = targetCount;
  sessionStartBtn.hidden = true;
  sessionStopBtn.hidden = false;
  sessionResumeBtn.hidden = true;

  if (targetCount <= 0) {
    await finishSession();
    return;
  }

  setSessionStatus("Listening…");
  session.pollTimer = setInterval(pollSession, SESSION_POLL_INTERVAL_MS);
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
    if (session.freeChantsRemaining > 0) {
      countFreeChant();
    } else {
      submitChant(new Blob(chunks, { type: "audio/webm" }));
    }
  };
  session.currentRecorder.stop();
}

// Short synthesized tones, not speech — while chanting your eyes are likely
// closed or unfocused, so a glance at the on-screen status text isn't a
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

// Counts a chant immediately with zero analysis and zero network call for
// audio — only a lightweight increment request. Used for the first
// FREE_CHANTS_AT_START utterances of a session, assumed correct so the
// session doesn't start by second-guessing you before you've even settled
// into a rhythm. The server (not a client-side shadow counter) remains the
// single source of truth for the displayed remaining count, so there's no
// risk of the display desyncing once real analysis takes over.
async function countFreeChant() {
  if (!session) return;
  session.freeChantsRemaining -= 1;

  try {
    const response = await fetch(
      `/count/${encodeURIComponent(sessionId)}/increment?mantra_id=${encodeURIComponent(MANTRA_ID)}&target_count=${session.targetCount}`,
      { method: "POST" }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `Count failed (${response.status})`);

    playCountedTone();
    sessionCounterEl.textContent = data.remaining;
    session.lastCountedChantAt = Date.now();
    session.consecutiveErrors = 0;

    if (data.mala_complete) {
      await finishSession();
      return;
    }
  } catch (err) {
    sessionError.textContent = err.message;
    sessionError.hidden = false;
  }

  if (session && !session.isPaused) setSessionStatus("Listening…");
}

async function submitChant(blob) {
  if (!session) return;
  setSessionStatus("Checking that chant…");

  const formData = new FormData();
  formData.append("audio", blob, "chant.webm");
  formData.append("reference_text", REFERENCE_TEXT);
  formData.append("session_id", sessionId);
  formData.append("mantra_id", MANTRA_ID);
  formData.append("target_count", session.targetCount);
  formData.append("language", LANGUAGE);

  try {
    const response = await fetch("/verify_chant", { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || `Chant check failed (${response.status})`);
    }

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
  await speakAsVyas(REFERENCE_TEXT);
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
