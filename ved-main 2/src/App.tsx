import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, Send, Sparkles, User, Users } from 'lucide-react';
import { vedApi } from './api';
import { practices, preferences, SOLO_JAAP_TARGET } from './data';
import { connectToChantModule } from './connector';
import type { ChantMode } from './connector';
import type { FlowType, OfferingStats, PracticeCard, Screen } from './types';
import { getUserId } from './uid';
import { loadYouTubeApi } from './youtube';
import { vyasMantraConfig } from './vyasMantras';
import { meditationVideoConfig } from './meditationVideos';
import { API_BASE } from './apiBase';

const VYAS_API_BASE = `${API_BASE}/vyas`;
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

// Astro Ved's "chant on your behalf" = Vyas's own "Vyas Chants" mode
// (looped video, no verification); "Solo Mantra Chant" = Vyas's "You
// Chant" mode (mic-verified). Maps the chat/path-screen's ChantMode onto
// VyasMantraRoom's own mode concept for the auto-start handoff.
function vyasModeFor(path: ChantMode): VyasMode {
  return path === 'astro_ved' ? 'vyas' : 'user';
}

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [flow, setFlow] = useState<FlowType | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chantPath, setChantPath] = useState<ChantMode>('solo');
  const [toast, setToast] = useState('');
  const [expertStep, setExpertStep] = useState(0);
  const [stats, setStats] = useState<OfferingStats>(emptyStats);

  const userId = useMemo(() => getUserId(), []);

  const selected = useMemo(
    () => flow && selectedId ? practices[flow].find((item) => item.id === selectedId) ?? null : null,
    [flow, selectedId]
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function goHome() {
    setScreen('home'); setFlow(null); setSelectedId(null); setExpertStep(0);
  }

  function goBack() {
    if (screen === 'room') {
      if (flow === 'samadhan' || flow === 'mantra') { setScreen('expert'); return; }
      setScreen('choices'); setSelectedId(null); return;
    }
    if (screen === 'expert') { setExpertStep(0); setScreen(flow === 'mantra' ? 'mantraPath' : 'chat'); return; }
    if (screen === 'mantraPath') { setScreen('choices'); setSelectedId(null); return; }
    if (screen === 'chat') { setScreen('choices'); setSelectedId(null); return; }
    if (screen === 'choices') { setScreen('preferences'); setFlow(null); return; }
    goHome();
  }

  function chooseFlow(type: FlowType) {
    setFlow(type); setScreen('choices');
    void vedApi.getStats(type, userId).then(setStats);
  }

  function selectCategory(item: PracticeCard) {
    if (!flow) return;
    setSelectedId(item.id);
    if (flow === 'samadhan') {
      setScreen('chat');
      return;
    }
    if (flow === 'mantra') {
      setScreen('mantraPath');
      return;
    }
    setScreen('room');
    void vedApi.start({ type: flow, item_id: item.id, count: 0, user_id: userId });
  }

  function choosePath(path: ChantMode) {
    if (!flow || !selectedId) return;
    setChantPath(path);
    if (path === 'astro_ved') {
      void vedApi.start({ type: flow, item_id: selectedId, count: 0, user_id: userId });
      // Astro Ved chants on your behalf — that's exactly Vyas's own
      // "Vyas Chants" mode (looped video, no verification), so hand off
      // straight into the room, auto-started in that mode.
      setScreen('room');
      return;
    }
    setExpertStep(0);
    setScreen('expert');
  }

  function advanceExpert() {
    if (!flow || !selectedId) return;
    if (expertStep >= 2) {
      setExpertStep(0); setScreen('room');
      void vedApi.start({ type: flow, item_id: selectedId, count: 0, user_id: userId });
      return;
    }
    setExpertStep((value) => value + 1);
  }

  function complete(finalCount = 0) {
    if (!flow || !selectedId) return;
    void vedApi.complete({ type: flow, item_id: selectedId, count: finalCount, user_id: userId });
    setToast('Practice complete · Shubh din ✦');
  }

  return (
    <main className="app-shell">
      <Topbar showBack={screen !== 'home'} onBack={goBack} />
      <div className="page-transition" key={screen + (selectedId ?? '')}>
        {screen === 'home' && <Home onOpen={() => setScreen('preferences')} />}
        {screen === 'preferences' && <Preferences onChoose={chooseFlow} />}
        {screen === 'choices' && flow && <Choices flow={flow} stats={stats} onChoose={selectCategory} />}
        {screen === 'chat' && selected && <SamadhanChat item={selected} onChoosePath={choosePath} />}
        {screen === 'mantraPath' && selected && <MantraChantPath item={selected} onChoosePath={choosePath} />}
        {screen === 'expert' && selected && <ExpertIntro item={selected} step={expertStep} onNext={advanceExpert} />}
        {screen === 'room' && flow && selected && (
          flow === 'meditation'
            ? <MeditationRoom item={selected} onComplete={() => complete()} />
            : <VyasMantraRoom item={selected} flow={flow} sessionId={userId} onComplete={complete} autoStart={{ mode: vyasModeFor(chantPath) }} />
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

// ---- Samadhan chat (Astro Ved) ----

interface ChatMsg { id: number; from: 'bot' | 'user'; text: string; time: string }

function timeNow() {
  return new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function SamadhanChat({ item, onChoosePath }: { item: PracticeCard; onChoosePath: (path: ChantMode) => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [inputEnabled, setInputEnabled] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [connecting, setConnecting] = useState<ChantMode | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(true);
  const idRef = useRef(0);
  // Guards the intro sequence against React StrictMode's dev-mode double
  // effect invocation — without this, "Namaste! Main Astro Ved hoon." (and
  // the question after it) each got appended twice. Refs survive
  // StrictMode's synthetic mount/cleanup/remount within one component
  // instance, so this stays true across the double-invoke and only the
  // real (first) invocation ever runs the sequence.
  const introStartedRef = useRef(false);
  const Icon = item.icon;
  const mantraText = item.mantra ?? item.label;

  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
  }, []);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing, showOptions]);

  function wait(ms: number) {
    return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  }

  async function say(text: string, delay = 700) {
    setTyping(true);
    await wait(delay);
    if (!activeRef.current) return;
    setTyping(false);
    setMessages((prev) => [...prev, { id: ++idRef.current, from: 'bot', text, time: timeNow() }]);
  }

  useEffect(() => {
    if (introStartedRef.current) return;
    introStartedRef.current = true;
    // Human-paced entrance: a brief natural beat, then a Messenger-style typing indicator,
    // before Astro Ved's greeting lands — never an instant/robotic reply.
    (async () => {
      await wait(600);
      if (!activeRef.current) return;
      await say('Namaste! Main Astro Ved hoon.', 1600);
      if (!activeRef.current) return;
      await wait(700);
      if (!activeRef.current) return;
      await say(item.question ?? `Aapke ${item.label.toLowerCase()} mein kya dikkatein aa rahi hain?`, 1800);
      if (activeRef.current) setInputEnabled(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  async function sendAnswer() {
    const text = draft.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { id: ++idRef.current, from: 'user', text, time: timeNow() }]);
    setDraft('');
    setInputEnabled(false);

    // Reply pacing tuned to feel human, not instant/bot-like:
    // 3s silent beat, then ~9s of "typing…" before the reassurance lands.
    await wait(3000);
    if (!activeRef.current) return;
    await say('Hum samajhte hain. Aisa mehsoos hona bilkul normal hai — aap akele nahi hain, aur har uljhan ka ek raasta zaroor hota hai.', 9000);
    if (!activeRef.current) return;

    // ~5s later, the two options land — presented directly (no question),
    // since the user has no way to know what the options even are.
    await wait(3500);
    if (!activeRef.current) return;
    setTyping(true);
    await wait(1500);
    if (!activeRef.current) return;
    setTyping(false);
    setMessages((prev) => [...prev, { id: ++idRef.current, from: 'bot', text: 'Yeh dekhiye, do tareeke jinse aap yeh samadhan paa sakte hain:', time: timeNow() }]);
    setShowOptions(true);
  }

  async function choose(mode: ChantMode, label: string) {
    setShowOptions(false);
    setMessages((prev) => [...prev, { id: ++idRef.current, from: 'user', text: label, time: timeNow() }]);

    // Tap is the identifier that routes to the right module — the connector call below
    // is the placeholder for that hand-off; the sheet masks its (currently simulated) latency.
    setConnecting(mode);
    await connectToChantModule({ mode, mantra: mantraText, targetCount: mode === 'solo' ? SOLO_JAAP_TARGET : undefined });
    if (!activeRef.current) return;
    setConnecting(null);
    onChoosePath(mode);
  }

  return (
    <div className="chat-card">
      <div className="chat-card-header">
        <span className="chat-avatar-lg" style={{ background: `linear-gradient(135deg, ${item.theme.dark}, ${item.theme.accent})` }}>
          <Icon size={20} />
        </span>
        <span className="chat-header-copy">
          <b>Astro Ved</b>
          <small>{item.label} Samadhan</small>
        </span>
      </div>
      <div className="chat-thread" ref={threadRef}>
        <span className="chat-date-pill">Aaj</span>
        {messages.map((message) => (
          <div className={`chat-row ${message.from}`} key={message.id}>
            <span className={`chat-bubble ${message.from}`}>{message.text}</span>
            <span className="chat-time">{message.time}</span>
          </div>
        ))}
        {typing && (
          <div className="chat-row bot">
            <span className="chat-bubble bot chat-typing"><i /><i /><i /></span>
          </div>
        )}
        {showOptions && (
          <div className="chat-row bot">
            <div className="chat-options">
              <button className="chat-option-card" type="button" onClick={() => choose('solo', 'Solo Mantra Chant')} disabled={!!connecting}>
                <b>Solo Mantra Chant</b>
                <span className="chat-option-mantra">{mantraText}</span>
                <small>Ek expert aapko mantra 3 baar sunayenge, phir aap khud shraddha ke saath jaap karenge.</small>
              </button>
              <button className="chat-option-card" type="button" onClick={() => choose('astro_ved', 'Astro Ved')} disabled={!!connecting}>
                <b>Astro Ved</b>
                <span className="chat-option-mantra">{mantraText}</span>
                <small>Astro Ved aapke saath real-time mein yeh mantra chant karega — aap live na ho paayein, tab bhi yeh complete kar diya jaayega.</small>
              </button>
            </div>
          </div>
        )}
      </div>
      {connecting && <ChantConnectingSheet mantra={mantraText} />}
      {inputEnabled && (
        <div className="chat-input-bar">
          <input
            className="chat-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void sendAnswer(); }}
            placeholder="Apna jawaab likhein…"
            aria-label={item.question}
          />
          <button className="chat-send" type="button" onClick={() => void sendAnswer()} disabled={!draft.trim()} aria-label="Send">
            <Send size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

function MantraChantPath({ item, onChoosePath }: { item: PracticeCard; onChoosePath: (path: ChantMode) => void }) {
  const [connecting, setConnecting] = useState<ChantMode | null>(null);
  const mantraText = item.mantra ?? item.label;

  async function choose(mode: ChantMode) {
    setConnecting(mode);
    // Tap is the identifier that routes to the right module — placeholder connector for now.
    await connectToChantModule({ mode, mantra: mantraText, targetCount: mode === 'solo' ? SOLO_JAAP_TARGET : undefined });
    onChoosePath(mode);
  }

  return <>
    <PageHead eyebrow={mantraText} title="Kaise chant karna chahenge?" description="Apne liye ek tareeka chunein." />
    <section className="mode-grid">
      <button className="mode-card" type="button" onClick={() => choose('solo')} disabled={!!connecting}>
        <span className="mode-icon"><User size={22} /></span>
        <span className="mode-copy">
          <h2>Solo Mantra Chant</h2>
          <p>Ek expert aapko mantra 3 baar sunayenge, phir aap khud shraddha ke saath jaap karenge.</p>
        </span>
      </button>
      <button className="mode-card" type="button" onClick={() => choose('astro_ved')} disabled={!!connecting}>
        <span className="mode-icon"><Users size={22} /></span>
        <span className="mode-copy">
          <h2>Astro Ved</h2>
          <p>Astro Ved aapke saath real-time mein yeh mantra chant karega — aap live na ho paayein, tab bhi yeh complete kar diya jaayega.</p>
        </span>
      </button>
    </section>
    {connecting && <ChantConnectingSheet mantra={mantraText} />}
  </>;
}

function ChantConnectingSheet({ mantra }: { mantra: string }) {
  return <div className="sheet-backdrop" role="status" aria-live="polite">
    <div className="sheet">
      <div className="sheet-spinner"><i /><i /><i /></div>
      <p>Badhiya! Main abhi {mantra} ka chant shuru kar raha hoon.</p>
    </div>
  </div>;
}

function ExpertIntro({ item, step, onNext }: { item: PracticeCard; step: number; onNext: () => void }) {
  const mantraText = item.mantra ?? item.label;
  return <RoomFrame item={item}>
    <span className="room-kicker">Expert Aapko Mantra Sunayenge</span>
    <h1>{mantraText}</h1>
    <p className="room-desc">Dhyan se sunein — expert yeh mantra 3 baar bolenge.</p>
    <div className="expert-dots">{Array.from({ length: 3 }).map((_, index) => <i key={index} className={index <= step ? 'active' : ''} />)}</div>
    <div className="room-actions">
      <button type="button" onClick={onNext}><Check size={16} /> Maine sun liya ({step + 1}/3)</button>
    </div>
  </RoomFrame>;
}

// ---- Vyas Mantra Room: real voice-verified / video-looped chanting ----

function VyasMantraRoom({ item, flow, sessionId, onComplete, autoStart }: { item: PracticeCard; flow: FlowType; sessionId: string; onComplete: (count: number) => void; autoStart?: { mode: VyasMode } }) {
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

  const [mode, setMode] = useState<VyasMode>(autoStart?.mode ?? 'user');
  const [targetCount, setTargetCount] = useState(SOLO_JAAP_TARGET);
  const [phase, setPhase] = useState<VyasPhase>(autoStart ? 'running' : 'idle');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [videoVisible, setVideoVisible] = useState(false);

  const sessionRef = useRef<VyasChantSession | null>(null);
  const vyasModeRunningRef = useRef(false);
  const ytPlayerRef = useRef<any>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const ytEndedResolveRef = useRef<(() => void) | null>(null);
  const autoStartedRef = useRef(false);

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
      setPhase('idle');
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
      onComplete(target);
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
      setPhase('idle');
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
    onComplete(session.targetCount);
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

  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return;
    autoStartedRef.current = true;
    if (autoStart.mode === 'vyas') void startVyasChantingMode();
    else void startChantingSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <RoomFrame item={item}>
      <span className="room-kicker">{roomKicker}</span>
      <h1>{displayLabel}</h1>
      {isSamadhan && <span className="samadhan-note">Recommended for your selected category</span>}

      <div className="vyas-figure">
        {!videoVisible && <img src="/vyas-portrait.png" alt="Vyas" />}
        <div className="vyas-video-wrap" hidden={!videoVisible}>
          <div ref={ytContainerRef} />
        </div>
      </div>
      <p className="vyas-status">{statusText || (phase === 'idle' ? 'Vyas is ready.' : '')}</p>

      {!autoStart && (
        <div className="mode-toggle">
          <button type="button" className={`mode-btn ${mode === 'user' ? 'active' : ''}`} disabled={phase !== 'idle'} onClick={() => setMode('user')}>You Chant</button>
          <button type="button" className={`mode-btn ${mode === 'vyas' ? 'active' : ''}`} disabled={phase !== 'idle'} onClick={() => setMode('vyas')}>Vyas Chants</button>
        </div>
      )}

      {!autoStart && phase === 'idle' && (
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
        {phase === 'idle' && !autoStart && <button type="button" onClick={handleStart}>Start</button>}
        {phase === 'running' && <button type="button" onClick={handleStop}>Stop</button>}
        {phase === 'paused' && <button type="button" onClick={resumeSession}>Resume</button>}
      </div>

      {errorText && <div className="error">{errorText}</div>}
    </RoomFrame>
  );
}

function MeditationRoom({ item, onComplete }: { item: PracticeCard; onComplete: () => void }) {
  const youtubeId = meditationVideoConfig[item.id] ?? null;
  const ytPlayerRef = useRef<any>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!youtubeId) return;
    let cancelled = false;

    async function mountPlayer() {
      const YT = await loadYouTubeApi();
      if (cancelled) return;
      // loop:1 + playlist:<same id> is the standard YT embed trick for
      // looping a single video indefinitely — no manual onStateChange/
      // reload handling needed here, unlike the Mantra Room's Vyas Chants
      // mode, which loops because it's counting reps, not just playing.
      const player = new YT.Player(ytContainerRef.current, {
        width: '100%',
        height: '100%',
        videoId: youtubeId,
        // disablekb (plus pointer-events:none in CSS on .vyas-video-wrap
        // iframe) is what makes this genuinely un-controllable by the user
        // rather than just visually hiding YouTube's own controls bar —
        // was an explicit earlier requirement for the meditation video.
        playerVars: { playsinline: 1, rel: 0, controls: 0, disablekb: 1, modestbranding: 1, loop: 1, playlist: youtubeId },
        events: { onReady: (event: any) => event.target.playVideo() }
      });
      ytPlayerRef.current = player;
    }
    void mountPlayer();

    return () => {
      cancelled = true;
      if (ytPlayerRef.current?.destroy) ytPlayerRef.current.destroy();
      ytPlayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youtubeId]);

  return <RoomFrame item={item}>
    <span className="room-kicker">Meditation Room</span><h1>{item.label}</h1>
    <div className="vyas-figure">
      {youtubeId
        ? <div className="vyas-video-wrap"><div ref={ytContainerRef} /></div>
        : <p className="room-desc">No video is set up for this practice yet.</p>}
    </div>
    <div className="room-actions">
      <button type="button" onClick={onComplete}><Check size={16} /> Mark Complete</button>
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
