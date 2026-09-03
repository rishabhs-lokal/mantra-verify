import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, RotateCcw, Sparkles } from 'lucide-react';
import { vedApi } from './api';
import { practices, preferences } from './data';
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
    setScreen('home'); setFlow(null); setSelectedId(null); setCount(0);
  }

  function goBack() {
    if (screen === 'room') { setScreen('choices'); setSelectedId(null); setCount(0); return; }
    if (screen === 'choices') { setScreen('preferences'); setFlow(null); return; }
    goHome();
  }

  function chooseFlow(type: FlowType) {
    setFlow(type); setScreen('choices');
  }

  function enterRoom(item: PracticeCard) {
    if (!flow) return;
    setSelectedId(item.id); setCount(0); setScreen('room');
    void vedApi.start({ type: flow, item_id: item.id, count: 0 });
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
        {screen === 'choices' && flow && <Choices flow={flow} onChoose={enterRoom} />}
        {screen === 'room' && flow && selected && (
          flow === 'meditation'
            ? <MeditationRoom item={selected} promptIndex={promptIndex} onNextPrompt={() => setPromptIndex((value) => (value + 1) % prompts.length)} />
            : <MantraRoom flow={flow} item={selected} count={count} onCount={addCount} onReset={() => setCount(0)} onComplete={complete} />
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

function MantraRoom({ flow, item, count, onCount, onReset, onComplete }: { flow: FlowType; item: PracticeCard; count: number; onCount: () => void; onReset: () => void; onComplete: () => void }) {
  const isSamadhan = flow === 'samadhan';
  return <RoomFrame item={item}>
    <span className="room-kicker">{isSamadhan ? `${item.label} · Aapka mantra samadhan` : 'Mantra Room'}</span>
    <h1>{isSamadhan ? item.mantra : item.label}</h1>
    <p className="room-desc">{isSamadhan ? 'Is mantra ko shraddha aur steady breath ke saath repeat karein.' : item.description}</p>
    {isSamadhan && <span className="samadhan-note">Recommended for your selected category</span>}
    <button className="jaap-button" type="button" onClick={onCount} aria-label="Count one mantra repetition"><span><b>{count}</b><small>Tap to count</small></span></button>
    <div className="room-actions"><button type="button" onClick={onReset}><RotateCcw size={16} /> Reset</button><button type="button" onClick={onComplete}><Check size={16} /> Complete</button></div>
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
