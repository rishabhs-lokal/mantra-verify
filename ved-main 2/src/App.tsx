import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, RotateCcw, Sparkles } from 'lucide-react';
import { vedApi } from './api';
import { practices, preferences } from './data';
import type { FlowType, OfferingStats, PracticeCard } from './types';
import { useBackNavigation } from './useBackNavigation';
import { getUserId } from './uid';
import { loadYouTubeApi } from './youtube';

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

function MeditationRoom({ item, onComplete }: { item: PracticeCard; onComplete: () => void }) {
  const [completed, setCompleted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);

  function logCompletionOnce() {
    if (completed) return;
    setCompleted(true);
    onComplete();
  }

  useEffect(() => {
    if (!item.youtubeId || !containerRef.current) return;
    let cancelled = false;

    loadYouTubeApi().then((YT) => {
      if (cancelled || !containerRef.current) return;
      playerRef.current = new YT.Player(containerRef.current, {
        videoId: item.youtubeId,
        playerVars: { playsinline: 1, rel: 0 },
        events: {
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
