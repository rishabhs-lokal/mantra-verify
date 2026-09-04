import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, Sparkles } from 'lucide-react';
import { vedApi } from './api';
import { practices, preferences } from './data';
import type { FlowType, OfferingStats, PracticeCard } from './types';
import { useBackNavigation } from './useBackNavigation';
import { getUserId } from './uid';
import { loadYouTubeApi } from './youtube';
import { vyasMantraConfig } from './vyasMantras';

const VYAS_API_BASE = '/api/vyas';
const VYAS_LANGUAGE = 'hi';
const VYAS_MAX_CHANTS = 12;
const VYAS_SPEECH_RMS_THRESHOLD = 0.02;
const VYAS_UTTERANCE_SILENCE_GAP_MS = 500;
const VYAS_MIN_UTTERANCE_MS = 400;
const VYAS_SESSION_PAUSE_MS = 10000;
const VYAS_POLL_INTERVAL_MS = 75;
const VYAS_ERROR_STREAK_LIMIT = 3;
const VYAS_FREE_CHANTS_AT_START = 3;

type VyasMode = 'user' | 'vyas';
type VyasPhase = 'idle' | 'running' | 'paused';

interface VyasChantSession {
  stream: MediaStream;
  audioContext: AudioContext;
  analyser: AnalyserNode;
  dataArray: Uint8Array<ArrayBuffer>;
  targetCount: number;
  freeChantsRemaining: number;
  isSpeaking: boolean;
  silenceStreakMs: number;
  utteranceStartedAt: number;
  currentRecorder: MediaRecorder | null;
  currentChunks: Blob[];
  lastCountedChantAt: number;
  consecutiveErrors: number;
  isPaused: boolean;
  pollTimer: number | null;
}

const emptyStats: OfferingStats = { ok: false, is_new_user: true, counts_30d: {}, recently_used_item_id: null };

function App() {
  const [toast, setToast] = useState('');
  const [stats, setStats] = useState<OfferingStats>(emptyStats);

  const userId = useMemo(() => getUserId(), []);
  const { screen, flow, selectedId, count, setCount, navigate, goBack } = useBackNavigation(setToast);

  const selected = useMemo(
    () => flow && selectedId ? practices[flow].find((item) => item.id === selectedId) ?? null : null,
    [flow, selectedId]
  );

  function openPreferences() {
    navigate({ screen: 'preferences', flow: null, selectedId: null, count: 0 });
  }

  function chooseFlow(type: FlowType) {
    navigate({ screen: 'choices', flow: type, selectedId: null, count: 0 });
    void vedApi.getStats(type, userId).then(setStats);
  }

  function enterRoom(item: PracticeCard) {
    if (!flow) return;
    navigate({ screen: 'room', flow, selectedId: item.id, count: 0 });
    void vedApi.start({ type: flow, item_id: item.id, count: 0, user_id: userId });
  }

  function addCount() {
    if (!flow || !selectedId) return;
    const next = count + 1;
    setCount(next);
    if (next % 9 === 0) void vedApi.progress({ type: flow, item_id: selectedId, count: next, user_id: userId });
  }

  function complete() {
    if (!flow || !selectedId) return;
    void vedApi.complete({ type: flow, item_id: selectedId, count, user_id: userId });
    setToast('Practice complete · Shubh din ✦');
  }

  return (
    <main className="app-shell">
      <Topbar showBack={screen !== 'home'} onBack={goBack} />
      <div className="page-transition" key={screen + (selectedId ?? '')}>
        {screen === 'home' && <Home onOpen={openPreferences} />}
        {screen === 'preferences' && <Preferences onChoose={chooseFlow} />}
        {screen === 'choices' && flow && <Choices flow={flow} stats={stats} onChoose={enterRoom} />}
        {screen === 'room' && flow && selected && (
          flow === 'meditation'
            ? <MeditationRoom item={selected} onComplete={complete} />
            : <VyasMantraRoom item={selected} flow={flow} sessionId={userId} onComplete={complete} />
        )}
      </div>
      <div className={`toast ${toast ? 'show' : ''}`} role="status">{toast}</div>
    </main>
  );
}

function Topbar({ showBack, onBack }: { showBack: boolean; onBack: () => void }) {
  return <header className="topbar">
    <button className="brand" type="button" aria-label="Ved home" onClick={onBack}>
      {/* <span className="brand-mark">व</span><span>Ved</span> */}
    </button>
    {showBack && <button className="ghost-button" type="button" onClick={onBack}><ArrowLeft size={17} /> Back</button>}
  </header>;
}

function Home({ onOpen }: { onOpen: () => void }) {
  return <>
    <button className="hero-banner" type="button" onClick={onOpen}>
      <span className="hero-copy">
        <strong>Roz thoda sa sukoon.</strong>
        <span className="hero-sub">Mantra, meditation aur samadhan </span>
        <span className="hero-action">Apni practice chunein <i><ChevronRight size={18} /></i></span>
      </span>
      <span className="hero-symbol" aria-hidden="true">ॐ</span>
    </button>
    <p className="home-note"><Sparkles size={15} /> Aapki daily spiritual space</p>
  </>;
}

function Preferences({ onChoose }: { onChoose: (type: FlowType) => void }) {
  return <>
    <PageHead eyebrow="Choose your path" title="Aaj aapko kya chahiye?" description="Ek option chunein — phir themed card se seedha apne room mein jaayein." />
    <section className="preference-grid">
      {preferences.map((item) => {
        const Icon = item.icon;
        return <button className="pref-card" type="button" key={item.id} onClick={() => onChoose(item.id)}>
          <span className="pref-icon"><Icon size={24} /></span>
          <span className="pref-copy"><h2>{item.label}</h2><p>{item.description}</p></span>
          <ChevronRight className="card-arrow" size={20} />
        </button>;
      })}
    </section>
  </>;
}

function Choices({ flow, stats, onChoose }: { flow: FlowType; stats: OfferingStats; onChoose: (item: PracticeCard) => void }) {
  const headings = {
    mantra: ['Mantra Chant', 'Kaunsa mantra aaj aapke saath chalega?', '4 canonical mantras'],
    meditation: ['Meditation', 'Apne mood ke hisaab se practice chunein.', '4 mindful practices'],
    samadhan: ['Mantra Samadhan', 'Kis baat ka samadhan dhoondh rahe hain?', 'Choose what feels closest']
  } satisfies Record<FlowType, [string, string, string]>;
  const [eyebrow, title, description] = headings[flow];

  const showUsage = !stats.is_new_user;

  return <>
    <PageHead eyebrow={eyebrow} title={title} description={`${description} — card par tap karte hi room shuru ho jayega.`} />
    <section className="choice-grid">
      {practices[flow].map((item) => {
        const Icon = item.icon;
        const usedCount = stats.counts_30d[item.id] ?? 0;
        const isRecent = showUsage && stats.recently_used_item_id === item.id;
        return <button className="choice-card" type="button" key={item.id} onClick={() => onChoose(item)} style={{ borderColor: `${item.theme.accent}22` }}>
          {isRecent && <span className="recently-used-tag">Recently Used</span>}
          <span className="choice-icon" style={{ background: `linear-gradient(135deg, ${item.theme.dark}, ${item.theme.accent})` }}><Icon size={22} /></span>
          <span className="choice-copy"><h2>{item.label}</h2><p>{item.description}</p></span>
          {showUsage && usedCount > 0 && <span className="usage-streak">Used {usedCount} times in the last 30 days</span>}
        </button>;
      })}
    </section>
  </>;
}

function VyasMantraRoom({ item, flow, sessionId, onComplete }: { item: PracticeCard; flow: FlowType; sessionId: string; onComplete: () => void }) {
  const isSamadhan = flow === 'samadhan';
  // Samadhan cards recommend a mantra by its display label (item.mantra,
  // e.g. "Om Namah Shivaya") rather than by id, since practices.samadhan
  // and practices.mantra are separate lists — resolve back to the actual
  // mantra id so the same vyasMantraConfig entry (and its video) is used
  // as when picking that mantra directly from the Mantra Chant flow.
  const mantraId = isSamadhan
    ? practices.mantra.find((m) => m.label === item.mantra)?.id ?? item.id
    : item.id;
  const config = vyasMantraConfig[mantraId];
  const referenceText = config?.referenceText ?? item.label;
  const youtubeId = config?.youtubeId ?? null;
  const displayLabel = isSamadhan ? item.mantra ?? item.label : item.label;
  const roomKicker = isSamadhan ? `${item.label} · Aapka mantra samadhan` : 'Mantra Room · Vyas ke saath';

  const [mode, setMode] = useState<VyasMode>('user');
  const [targetCount, setTargetCount] = useState(VYAS_MAX_CHANTS);
  const [phase, setPhase] = useState<VyasPhase>('idle');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [videoVisible, setVideoVisible] = useState(false);

  const sessionRef = useRef<VyasChantSession | null>(null);
  const vyasModeRunningRef = useRef(false);
  const ytPlayerRef = useRef<any>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const ytEndedResolveRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      vyasModeRunningRef.current = false;
      const session = sessionRef.current;
      if (session) {
        if (session.pollTimer) window.clearInterval(session.pollTimer);
        if (session.currentRecorder && session.currentRecorder.state === 'recording') session.currentRecorder.stop();
        session.stream.getTracks().forEach((track) => track.stop());
        void session.audioContext.close();
        sessionRef.current = null;
      }
      if (ytPlayerRef.current?.destroy) ytPlayerRef.current.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clampTarget(value: number) {
    if (Number.isNaN(value)) value = VYAS_MAX_CHANTS;
    return Math.max(1, Math.min(VYAS_MAX_CHANTS, value));
  }

  // ---- Vyas Chants mode: looped video playback, no verification at all ----

  async function ensureYtPlayer(): Promise<any> {
    if (ytPlayerRef.current) return ytPlayerRef.current;
    const YT = await loadYouTubeApi();
    return new Promise((resolve) => {
      // No videoId here — passing one makes the player auto-cue/play on its
      // own the moment it's ready, racing with our explicit loadVideoById()
      // call in playVyasChantOnce() below (that race was why looping broke:
      // two overlapping playbacks).
      //
      // onStateChange is registered exactly once, for the player's entire
      // lifetime, rather than via addEventListener per loop iteration —
      // the iframe API's removeEventListener does not reliably detach a
      // per-iteration listener in practice, so add/remove-per-loop left
      // stale listeners stacking up on every repeat. A single listener
      // that resolves whatever the "current" pending promise is (tracked
      // in ytEndedResolveRef) avoids that entirely.
      const player = new YT.Player(ytContainerRef.current, {
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, controls: 0, modestbranding: 1 },
        events: {
          onReady: () => { ytPlayerRef.current = player; resolve(player); },
          onStateChange: (event: any) => {
            if (event.data === window.YT.PlayerState.ENDED) {
              const resolvePending = ytEndedResolveRef.current;
              ytEndedResolveRef.current = null;
              resolvePending?.();
            }
          }
        }
      });
    });
  }

  function playVyasChantOnce(): Promise<void> {
    if (!youtubeId) return Promise.resolve();
    return new Promise(async (resolve) => {
      const player = await ensureYtPlayer();
      setVideoVisible(true);
      ytEndedResolveRef.current = resolve;
      // loadVideoById (not seekTo+playVideo) is what reliably restarts and
      // auto-plays from 0 — seek+play left the player paused on a "replay"
      // thumbnail instead of continuing into the next loop.
      player.loadVideoById(youtubeId);
    });
  }

  async function startVyasChantingMode() {
    if (!youtubeId) {
      setErrorText('No video is set up for this mantra yet.');
      return;
    }
    const target = clampTarget(targetCount);
    setTargetCount(target);
    vyasModeRunningRef.current = true;
    setPhase('running');
    setRemaining(target);
    setStatusText('');
    setErrorText(null);

    for (let rem = target; rem > 0; rem--) {
      if (!vyasModeRunningRef.current) break;
      await playVyasChantOnce();
      if (!vyasModeRunningRef.current) break;
      setRemaining(rem - 1);
    }

    setVideoVisible(false);
    const completed = vyasModeRunningRef.current;
    vyasModeRunningRef.current = false;
    setPhase('idle');

    if (completed) {
      setStatusText('Complete! 🕉');
      onComplete();
    } else {
      setStatusText('Stopped.');
    }
  }

  function stopVyasChantingMode() {
    vyasModeRunningRef.current = false;
    if (ytPlayerRef.current?.pauseVideo) ytPlayerRef.current.pauseVideo();
    setVideoVisible(false);
    setPhase('idle');
    setStatusText('Stopped.');
  }

  // ---- User Chants mode: continuous mic listening, verified via /verify_chant ----

  function getRMS(session: VyasChantSession) {
    session.analyser.getByteTimeDomainData(session.dataArray);
    let sumSquares = 0;
    for (let i = 0; i < session.dataArray.length; i++) {
      const normalized = (session.dataArray[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    return Math.sqrt(sumSquares / session.dataArray.length);
  }

  function playTone(frequency: number, durationMs: number, volume: number) {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
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
    } catch {
      // non-fatal — skip the tone if Web Audio misbehaves
    }
  }

  const playCountedTone = () => playTone(880, 150, 0.15);
  const playNotCountedTone = () => playTone(220, 120, 0.08);

  async function startChantingSession() {
    setErrorText(null);
    const target = clampTarget(targetCount);
    setTargetCount(target);

    try {
      await fetch(`${VYAS_API_BASE}/count/${encodeURIComponent(sessionId)}/reset?mantra_id=${encodeURIComponent(mantraId)}`, { method: 'POST' });
    } catch {
      // non-fatal — worst case this session's count starts from stale progress
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: any) {
      setErrorText(`Could not access microphone: ${err.message}`);
      return;
    }

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const session: VyasChantSession = {
      stream,
      audioContext,
      analyser,
      dataArray: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
      targetCount: target,
      freeChantsRemaining: VYAS_FREE_CHANTS_AT_START,
      isSpeaking: false,
      silenceStreakMs: 0,
      utteranceStartedAt: 0,
      currentRecorder: null,
      currentChunks: [],
      lastCountedChantAt: Date.now(),
      consecutiveErrors: 0,
      isPaused: false,
      pollTimer: null
    };
    sessionRef.current = session;

    setPhase('running');
    setRemaining(target);

    if (target <= 0) {
      finishSession(session);
      return;
    }

    setStatusText('Listening…');
    session.pollTimer = window.setInterval(() => pollSession(session), VYAS_POLL_INTERVAL_MS);
  }

  function pollSession(session: VyasChantSession) {
    if (sessionRef.current !== session || session.isPaused) return;

    const speaking = getRMS(session) > VYAS_SPEECH_RMS_THRESHOLD;

    if (speaking) {
      session.silenceStreakMs = 0;
      if (!session.isSpeaking) {
        session.isSpeaking = true;
        beginUtteranceRecording(session);
      }
    } else if (session.isSpeaking) {
      session.silenceStreakMs += VYAS_POLL_INTERVAL_MS;
      if (session.silenceStreakMs >= VYAS_UTTERANCE_SILENCE_GAP_MS) {
        session.isSpeaking = false;
        endUtteranceRecording(session);
      }
    }

    checkSilenceTimers(session);
  }

  function beginUtteranceRecording(session: VyasChantSession) {
    session.utteranceStartedAt = Date.now();
    session.currentChunks = [];
    session.currentRecorder = new MediaRecorder(session.stream);
    session.currentRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) session.currentChunks.push(e.data);
    };
    session.currentRecorder.start();
  }

  function endUtteranceRecording(session: VyasChantSession) {
    if (!session.currentRecorder || session.currentRecorder.state !== 'recording') return;
    const duration = Date.now() - session.utteranceStartedAt;
    const chunks = session.currentChunks;
    session.currentRecorder.onstop = () => {
      if (duration < VYAS_MIN_UTTERANCE_MS) return; // too short to plausibly be a real chant
      if (session.freeChantsRemaining > 0) {
        void countFreeChant(session);
      } else {
        void submitChant(session, new Blob(chunks, { type: 'audio/webm' }));
      }
    };
    session.currentRecorder.stop();
  }

  async function countFreeChant(session: VyasChantSession) {
    if (sessionRef.current !== session) return;
    session.freeChantsRemaining -= 1;

    try {
      const response = await fetch(
        `${VYAS_API_BASE}/count/${encodeURIComponent(sessionId)}/increment?mantra_id=${encodeURIComponent(mantraId)}&target_count=${session.targetCount}`,
        { method: 'POST' }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `Count failed (${response.status})`);

      playCountedTone();
      setRemaining(data.remaining);
      session.lastCountedChantAt = Date.now();
      session.consecutiveErrors = 0;

      if (data.mala_complete) {
        finishSession(session);
        return;
      }
    } catch (err: any) {
      setErrorText(err.message);
    }

    if (sessionRef.current === session && !session.isPaused) setStatusText('Listening…');
  }

  async function submitChant(session: VyasChantSession, blob: Blob) {
    if (sessionRef.current !== session) return;
    setStatusText('Checking that chant…');

    const formData = new FormData();
    formData.append('audio', blob, 'chant.webm');
    formData.append('reference_text', referenceText);
    formData.append('session_id', sessionId);
    formData.append('mantra_id', mantraId);
    formData.append('target_count', String(session.targetCount));
    formData.append('language', VYAS_LANGUAGE);

    try {
      const response = await fetch(`${VYAS_API_BASE}/verify_chant`, { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `Chant check failed (${response.status})`);

      if (data.counted) {
        playCountedTone();
        setRemaining(data.remaining);
        session.lastCountedChantAt = Date.now();
        session.consecutiveErrors = 0;

        if (data.mala_complete) {
          finishSession(session);
          return;
        }
      } else {
        playNotCountedTone();
        session.consecutiveErrors += 1;
        if (session.consecutiveErrors >= VYAS_ERROR_STREAK_LIMIT) {
          handleRepeatedErrors(session);
          return;
        }
      }

      if (sessionRef.current === session && !session.isPaused) setStatusText('Listening…');
    } catch (err: any) {
      setErrorText(err.message);
    }
  }

  function checkSilenceTimers(session: VyasChantSession) {
    if (sessionRef.current !== session || session.isPaused) return;
    const elapsed = Date.now() - session.lastCountedChantAt;
    if (elapsed >= VYAS_SESSION_PAUSE_MS) pauseSession(session);
  }

  function handleRepeatedErrors(session: VyasChantSession) {
    session.consecutiveErrors = 0;
    pauseSession(session);
    setStatusText('Rukiye — dhyaan se jaap karein aur Resume dabayein.');
  }

  function pauseSession(session: VyasChantSession) {
    if (sessionRef.current !== session || session.isPaused) return;
    session.isPaused = true;
    if (session.pollTimer) window.clearInterval(session.pollTimer);
    if (session.isSpeaking) endUtteranceRecording(session);
    setPhase('paused');
    setStatusText((prev) => prev || 'Paused — click Resume to continue.');
  }

  function resumeSession() {
    const session = sessionRef.current;
    if (!session) return;
    session.isPaused = false;
    session.lastCountedChantAt = Date.now();
    setPhase('running');
    setStatusText('Listening…');
    session.pollTimer = window.setInterval(() => pollSession(session), VYAS_POLL_INTERVAL_MS);
  }

  function finishSession(session: VyasChantSession) {
    setStatusText('Complete! 🕉');
    stopChantingSession(session, false);
    onComplete();
  }

  function stopChantingSession(session: VyasChantSession, userInitiated = true) {
    if (sessionRef.current !== session) return;
    if (session.pollTimer) window.clearInterval(session.pollTimer);
    if (session.currentRecorder && session.currentRecorder.state === 'recording') session.currentRecorder.stop();
    session.stream.getTracks().forEach((track) => track.stop());
    void session.audioContext.close();

    sessionRef.current = null;
    setPhase('idle');
    if (userInitiated) setStatusText('Session stopped.');
  }

  function handleStart() {
    if (mode === 'vyas') void startVyasChantingMode();
    else void startChantingSession();
  }

  function handleStop() {
    if (mode === 'vyas') stopVyasChantingMode();
    else {
      const session = sessionRef.current;
      if (session) stopChantingSession(session, true);
    }
  }

  return (
    <RoomFrame item={item}>
      <span className="room-kicker">{roomKicker}</span>
      <h1>{displayLabel}</h1>
      {isSamadhan && <span className="samadhan-note">Recommended for your selected category</span>}

      <div className="vyas-figure">
        {!videoVisible && <img src="/vyas-portrait.png" alt="Vyas, a seated sage beneath a banyan tree" />}
        <div className="vyas-video-wrap" hidden={!videoVisible}>
          <div ref={ytContainerRef} />
        </div>
      </div>
      <p className="vyas-status">{statusText || (phase === 'idle' ? 'Vyas is ready.' : '')}</p>

      <div className="mode-toggle">
        <button type="button" className={`mode-btn ${mode === 'user' ? 'active' : ''}`} disabled={phase !== 'idle'} onClick={() => setMode('user')}>You Chant</button>
        <button type="button" className={`mode-btn ${mode === 'vyas' ? 'active' : ''}`} disabled={phase !== 'idle'} onClick={() => setMode('vyas')}>Vyas Chants</button>
      </div>

      {phase === 'idle' && (
        <label className="target-count-label">
          Number of chants (1–{VYAS_MAX_CHANTS})
          <input
            type="number"
            min={1}
            max={VYAS_MAX_CHANTS}
            value={targetCount}
            onChange={(e) => setTargetCount(Number(e.target.value))}
            onBlur={(e) => setTargetCount(clampTarget(Number(e.target.value)))}
          />
        </label>
      )}

      {remaining !== null && phase !== 'idle' && (
        <div className="session-counter-wrap">
          <div className="session-counter">{remaining}</div>
          <p className="session-counter-label">chants remaining</p>
        </div>
      )}

      <div className="room-actions">
        {phase === 'idle' && <button type="button" onClick={handleStart}>Start</button>}
        {phase === 'running' && <button type="button" onClick={handleStop}>Stop</button>}
        {phase === 'paused' && <button type="button" onClick={resumeSession}>Resume</button>}
      </div>

      {errorText && <div className="error">{errorText}</div>}
    </RoomFrame>
  );
}

function MeditationRoom({ item, onComplete }: { item: PracticeCard; onComplete: () => void }) {
  const [completed, setCompleted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);

  function logCompletionOnce() {
    if (completed) return;
    setCompleted(true);
    playerRef.current?.pauseVideo?.();
    onComplete();
  }

  useEffect(() => {
    if (!item.youtubeId || !containerRef.current) return;
    let cancelled = false;

    loadYouTubeApi().then((YT) => {
      if (cancelled || !containerRef.current) return;
      playerRef.current = new YT.Player(containerRef.current, {
        width: '100%',
        height: '100%',
        videoId: item.youtubeId,
        // No user control at all — no scrub bar, no click-to-pause (that's
        // also why the iframe has pointer-events:none in CSS), no keyboard
        // shortcuts. Starts itself; the only way to stop it early is
        // Mark Complete, which explicitly calls pauseVideo() above.
        playerVars: { playsinline: 1, rel: 0, controls: 0, disablekb: 1, modestbranding: 1, autoplay: 1 },
        events: {
          onReady: (event: any) => event.target.playVideo(),
          onStateChange: (event: any) => {
            if (event.data === YT.PlayerState.ENDED) logCompletionOnce();
          }
        }
      });
    });

    return () => {
      cancelled = true;
      if (playerRef.current && playerRef.current.destroy) playerRef.current.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  if (!item.youtubeId) {
    return <RoomFrame item={item}>
      <span className="room-kicker">Meditation Room</span><h1>{item.label}</h1>
      <p className="room-desc">Video coming soon for this practice.</p>
    </RoomFrame>;
  }

  return <RoomFrame item={item}>
    <span className="room-kicker">Meditation Room</span><h1>{item.label}</h1>
    <div className="meditation-video-wrap"><div ref={containerRef} /></div>
    <div className="room-actions">
      <button type="button" onClick={logCompletionOnce} disabled={completed}>
        <Check size={16} /> {completed ? 'Completed' : 'Mark Complete'}
      </button>
    </div>
  </RoomFrame>;
}

function RoomFrame({ item, children }: { item: PracticeCard; children: React.ReactNode }) {
  return <div className="room-wrap"><section className="room-card" style={{ background: `linear-gradient(145deg, ${item.theme.dark}, ${item.theme.accent})` }}><div className="room-content">{children}</div></section></div>;
}

function PageHead({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <section className="page-head"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></section>;
}

export default App;
