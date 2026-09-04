import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, RotateCcw, Send, Sparkles, User, Users } from 'lucide-react';
import { vedApi } from './api';
import { practices, preferences, SOLO_JAAP_TARGET } from './data';
import { connectToChantModule } from './connector';
import type { ChantMode } from './connector';
import type { FlowType, PracticeCard, Screen } from './types';

const prompts = [
  'Main shant hoon.',
  'Main kaafi hoon.',
  'Main apne aap par bharosa karta hoon.',
  'Aaj main gratitude choose karta hoon.'
];

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [flow, setFlow] = useState<FlowType | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [promptIndex, setPromptIndex] = useState(0);
  const [toast, setToast] = useState('');
  const [expertStep, setExpertStep] = useState(0);

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
    setScreen('home'); setFlow(null); setSelectedId(null); setCount(0); setExpertStep(0);
  }

  function goBack() {
    if (screen === 'room') {
      if (flow === 'samadhan' || flow === 'mantra') { setScreen('expert'); setCount(0); return; }
      setScreen('choices'); setSelectedId(null); setCount(0); return;
    }
    if (screen === 'expert') { setExpertStep(0); setScreen(flow === 'mantra' ? 'mantraPath' : 'chat'); return; }
    if (screen === 'mantraPath') { setScreen('choices'); setSelectedId(null); return; }
    if (screen === 'chat') { setScreen('choices'); setSelectedId(null); return; }
    if (screen === 'choices') { setScreen('preferences'); setFlow(null); return; }
    goHome();
  }

  function chooseFlow(type: FlowType) {
    setFlow(type); setScreen('choices');
  }

  function selectCategory(item: PracticeCard) {
    if (!flow) return;
    setSelectedId(item.id); setCount(0);
    if (flow === 'samadhan') {
      setScreen('chat');
      return;
    }
    if (flow === 'mantra') {
      setScreen('mantraPath');
      return;
    }
    setScreen('room');
    void vedApi.start({ type: flow, item_id: item.id, count: 0 });
  }

  function choosePath(path: ChantMode) {
    if (!flow || !selectedId) return;
    if (path === 'astro_ved') {
      void vedApi.start({ type: flow, item_id: selectedId, count: 0 });
      // Samadhan: the chat continues the conversation itself — no navigation.
      // Mantra Chant (no chat thread): this is the hand-off point to the module — back to Home for now.
      if (flow === 'mantra') { goHome(); }
      return;
    }
    setExpertStep(0);
    setScreen('expert');
  }

  function advanceExpert() {
    if (!flow || !selectedId) return;
    if (expertStep >= 2) {
      setExpertStep(0); setCount(0); setScreen('room');
      void vedApi.start({ type: flow, item_id: selectedId, count: 0 });
      return;
    }
    setExpertStep((value) => value + 1);
  }

  function addCount() {
    if (!flow || !selectedId) return;
    const next = count + 1;
    setCount(next);
    if (next % 9 === 0) void vedApi.progress({ type: flow, item_id: selectedId, count: next });
  }

  function complete() {
    if (!flow || !selectedId) return;
    void vedApi.complete({ type: flow, item_id: selectedId, count });
    setToast('Practice complete · Shubh din ✦');
  }

  return (
    <main className="app-shell">
      <Topbar showBack={screen !== 'home'} onBack={goBack} />
      <div className="page-transition" key={screen + (selectedId ?? '')}>
        {screen === 'home' && <Home onOpen={() => setScreen('preferences')} />}
        {screen === 'preferences' && <Preferences onChoose={chooseFlow} />}
        {screen === 'choices' && flow && <Choices flow={flow} onChoose={selectCategory} />}
        {screen === 'chat' && selected && <SamadhanChat item={selected} onChoosePath={choosePath} />}
        {screen === 'mantraPath' && selected && <MantraChantPath item={selected} onChoosePath={choosePath} />}
        {screen === 'expert' && selected && <ExpertIntro item={selected} step={expertStep} onNext={advanceExpert} />}
        {screen === 'room' && flow && selected && (
          flow === 'meditation'
            ? <MeditationRoom item={selected} promptIndex={promptIndex} onNextPrompt={() => setPromptIndex((value) => (value + 1) % prompts.length)} />
            : <MantraRoom flow={flow} item={selected} count={count} target={(flow === 'samadhan' || flow === 'mantra') ? SOLO_JAAP_TARGET : undefined} onCount={addCount} onReset={() => setCount(0)} onComplete={complete} />
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
      {preferences.map((item, index) => {
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

function Choices({ flow, onChoose }: { flow: FlowType; onChoose: (item: PracticeCard) => void }) {
  const headings = {
    mantra: ['Mantra Chant', 'Kaunsa mantra aaj aapke saath chalega?', '4 canonical mantras'],
    meditation: ['Meditation', 'Apne mood ke hisaab se practice chunein.', '4 mindful practices'],
    samadhan: ['Mantra Samadhan', 'Kis baat ka samadhan dhoondh rahe hain?', 'Choose what feels closest']
  } satisfies Record<FlowType, [string, string, string]>;
  const [eyebrow, title, description] = headings[flow];
  return <>
    <PageHead eyebrow={eyebrow} title={title} description={`${description} — card par tap karte hi room shuru ho jayega.`} />
    <section className="choice-grid">
      {practices[flow].map((item) => {
        const Icon = item.icon;
        return <button className="choice-card" type="button" key={item.id} onClick={() => onChoose(item)} style={{ borderColor: `${item.theme.accent}22` }}>
          <span className="choice-icon" style={{ background: `linear-gradient(135deg, ${item.theme.dark}, ${item.theme.accent})` }}><Icon size={22} /></span>
          <span className="choice-copy"><h2>{item.label}</h2><p>{item.description}</p></span>
        </button>;
      })}
    </section>
  </>;
}

function MantraRoom({ flow, item, count, target, onCount, onReset, onComplete }: { flow: FlowType; item: PracticeCard; count: number; target?: number; onCount: () => void; onReset: () => void; onComplete: () => void }) {
  const isSamadhan = flow === 'samadhan';
  const reached = !target || count >= target;
  return <RoomFrame item={item}>
    <span className="room-kicker">{isSamadhan ? `${item.label} · Aapka mantra samadhan` : 'Mantra Room'}</span>
    <h1>{isSamadhan ? item.mantra : item.label}</h1>
    <p className="room-desc">{isSamadhan ? 'Is mantra ko shraddha aur steady breath ke saath repeat karein.' : item.description}</p>
    {target && <span className="samadhan-note">Aaj ka lakshya: {target} jaap</span>}
    <button className="jaap-button" type="button" onClick={onCount} aria-label="Count one mantra repetition">
      <span><b>{count}{target ? <i className="jaap-target">/{target}</i> : null}</b><small>Tap to count</small></span>
    </button>
    <div className="room-actions">
      <button type="button" onClick={onReset}><RotateCcw size={16} /> Reset</button>
      <button type="button" onClick={onComplete} disabled={!reached}><Check size={16} /> Complete</button>
    </div>
  </RoomFrame>;
}

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

    if (mode === 'solo') {
      // Solo practice is a real, already-built flow — hand off to the expert-intro/jaap-counter screens.
      onChoosePath(mode);
      return;
    }

    // Astro Ved: no separate screen — the conversation just continues right here.
    // (Placeholder for now; this is where the real module plugs in later.)
    onChoosePath(mode);
    await say('Aap live na bhi ho, tab bhi yeh chant poora karke aapko yahin update kar diya jaayega.', 2000);
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

function MeditationRoom({ item, promptIndex, onNextPrompt }: { item: PracticeCard; promptIndex: number; onNextPrompt: () => void }) {
  return <RoomFrame item={item}>
    <span className="room-kicker">Meditation Room</span><h1>{item.label}</h1>
    {item.id === 'vagus' && <><div className="breath-stage"><div className="wave">{Array.from({ length: 7 }).map((_, index) => <i key={index} />)}</div></div><p className="room-desc">Wave upar jaaye toh inhale, neeche aaye toh exhale.</p></>}
    {item.id === 'guided' && <><div className="breath-stage"><div className="breath-orb"><span>◉</span></div></div><p className="room-desc">Mere saath: dheere inhale… hold… aur gently exhale.</p></>}
    {item.id === 'affirmation' && <><div className="breath-stage"><div><div className="prompt">{prompts[promptIndex]}</div><div className="prompt-dots">{prompts.map((_, index) => <i key={index} className={index === promptIndex ? 'active' : ''} />)}</div></div></div><div className="room-actions"><button type="button" onClick={onNextPrompt}>Next prompt <ChevronRight size={16} /></button></div></>}
    {item.id === 'box' && <><div className="breath-stage"><div className="breath-orb box-breath"><span>4 · 4 · 4 · 4</span></div></div><p className="room-desc">Inhale · Hold · Exhale · Hold — har step 4 counts.</p></>}
  </RoomFrame>;
}

function RoomFrame({ item, children }: { item: PracticeCard; children: React.ReactNode }) {
  return <div className="room-wrap"><section className="room-card" style={{ background: `linear-gradient(145deg, ${item.theme.dark}, ${item.theme.accent})` }}><div className="room-content">{children}</div></section></div>;
}

function PageHead({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <section className="page-head"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></section>;
}

export default App;
