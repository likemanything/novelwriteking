/**
 * 首页动画：小墨团（一滴会写字的墨）在深夜的书桌前写小说。
 * 一个约 15 秒的循环：登场 → 灵光一闪 → 落笔 → 卡壳挠头 → 文思泉涌 → 盖「完」字章 → 欢呼。
 * 所有画面由同一个时间轴 t 推导，音效在对应时刻触发，所以画面和声音始终对得上。
 *
 * 声音默认静音（浏览器要求用户操作后才能出声），右下角按钮开启；偏好会被记住。
 */
import { Play, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { resumeOnGesture, setSound, soundOn, soundPreferred, sfxCheer, sfxHmm, sfxIdea, sfxStroke, sfxThump } from '@/lib/sfx';
import { cx } from '@/lib/util';
import { useSettings } from '@/store/settings';

const LOOP = 15.5;
const LINES = ['雾港的夜，邮差', '推开了灯塔的门。', '信封里，是十年前', '那熟悉的笔迹……'];
const CHARS = LINES.map((l) => [...l]);
const TOTAL = CHARS.reduce((n, l) => n + l.length, 0);
/** 第 idx 个字（从 0 开始）在第几行、第几列 */
function locate(idx: number): { line: number; col: number } {
  let rest = idx;
  for (let i = 0; i < CHARS.length; i++) {
    if (rest < CHARS[i].length) return { line: i, col: rest };
    rest -= CHARS[i].length;
  }
  return { line: CHARS.length - 1, col: CHARS[CHARS.length - 1].length - 1 };
}
const GLYPHS = ['墨', '梦', '雾', '诗', '光', '信'];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const bounce = (x: number) => {
  x = clamp01(x);
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
};

/** 已写出的字数（带小数，用于逐字出现） */
function written(t: number): number {
  if (t < 2.8) return 0;
  const half = TOTAL / 2;
  if (t < 6.2) return (half * (t - 2.8)) / 3.4;
  if (t < 7.8) return half;
  if (t < 11.0) return half + (half * (t - 7.8)) / 3.2;
  return TOTAL;
}

type Phase = 'enter' | 'idea' | 'write' | 'stuck' | 'write2' | 'wait' | 'stamp' | 'cheer' | 'rest';
function phaseOf(t: number): Phase {
  if (t < 1.2) return 'enter';
  if (t < 2.8) return 'idea';
  if (t < 6.2) return 'write';
  if (t < 7.8) return 'stuck';
  if (t < 11.0) return 'write2';
  if (t < 11.6) return 'wait';
  if (t < 12.0) return 'stamp';
  if (t < 14.2) return 'cheer';
  return 'rest';
}

function Scene({ t, still }: { t: number; still: boolean }) {
  const ph = phaseOf(t);
  const n = written(t);
  const whole = Math.floor(n);
  const writing = ph === 'write' || ph === 'write2';
  const fade = t > 14.2 ? 1 - clamp01((t - 14.2) / 1) : 1;

  // 笔尖位置
  const idx = Math.max(0, Math.min(TOTAL - 1, whole - 1));
  const { line, col } = locate(idx);
  const wob = writing ? Math.sin(t * 22) * 2.5 : 0;
  const tip = writing && whole > 0 ? { x: 262 + col * 20.5 + 24 + wob, y: 242 + line * 24 + Math.cos(t * 30) * 2 } : { x: 360, y: 292 - (ph === 'stuck' ? 6 : 0) };

  // 身体：登场弹跳、呼吸、欢呼跳跃
  const enterY = ph === 'enter' ? -(1 - bounce(t / 1.2)) * 150 : 0;
  const cheerT = t - 12.0;
  const jump = ph === 'cheer' ? -Math.abs(Math.sin(cheerT * 5.2)) * 34 * (1 - cheerT / 3) : 0;
  const squash = ph === 'cheer' ? 1 + Math.cos(cheerT * 10.4) * 0.03 : 1 + Math.sin(t * 2.4) * 0.012;
  const bodyY = enterY + jump;

  // 眼睛：看向笔尖 / 向上想 / 向左上卡壳；周期性眨眼
  const target = ph === 'idea' ? { x: 130, y: 60 } : ph === 'stuck' ? { x: 90, y: 150 } : ph === 'cheer' ? { x: 150, y: 190 } : tip;
  const gx = Math.max(-4, Math.min(4, (target.x - 150) / 40));
  const gy = Math.max(-3, Math.min(4, (target.y - 255) / 40));
  const blinkPhase = (t * 1000) % 3100;
  const blink = blinkPhase < 130 ? 0.12 : 1;
  const happy = ph === 'cheer' || ph === 'stamp';

  // 手臂：右手握笔，欢呼时双手举起
  const shoulder = { x: 200, y: 288 + bodyY * 0.6 };
  const hand = ph === 'cheer' ? { x: 248, y: 205 + bodyY + Math.sin(cheerT * 10) * 8 } : { x: tip.x - 16, y: tip.y - 40 };
  const handCtrl = { x: (shoulder.x + hand.x) / 2 + 6, y: Math.max(shoulder.y, hand.y) + 22 };
  const lShoulder = { x: 100, y: 288 + bodyY * 0.6 };
  const lHand = ph === 'cheer' ? { x: 52, y: 205 + bodyY + Math.cos(cheerT * 10) * 8 } : ph === 'stuck' ? { x: 128, y: 168 + bodyY } : { x: 92, y: 322 };

  // 想法气泡
  const bubble = ph === 'idea' ? ease((t - 1.2) / 0.35) : ph === 'stuck' ? ease((t - 6.2) / 0.3) * (1 - ease((t - 7.6) / 0.2)) : 0;

  // 盖章
  const stampT = (t - 11.6) / 0.4;
  const stampShown = t >= 11.6 && t < 14.9;
  const stampScale = t < 12.0 ? 2.4 - 1.4 * ease(stampT) : 1 + Math.max(0, 0.12 - (t - 12.0) * 0.5);
  const stampDrop = t < 12.0 ? -(1 - ease(stampT)) * 70 : 0;
  const ripple = t >= 12.0 ? clamp01((t - 12.0) / 0.9) : 0;

  const visible = still ? TOTAL : whole;
  let left = visible;
  const text = CHARS.map((l) => {
    const take = Math.max(0, Math.min(l.length, left));
    left -= l.length;
    return l.slice(0, take).join('');
  });

  // 火苗
  const flame = 1 + Math.sin(t * 9) * 0.08 + Math.sin(t * 17) * 0.05;

  return (
    <svg viewBox="0 0 560 440" className="h-full w-full" role="img" aria-label="一滴会写字的小墨团，在深夜的书桌前写小说">
      <defs>
        <radialGradient id="ws-glow" cx="50%" cy="55%" r="55%">
          <stop offset="0" stopColor="var(--gold)" stopOpacity=".22" />
          <stop offset="1" stopColor="var(--gold)" stopOpacity="0" />
        </radialGradient>
        <clipPath id="ws-paper">
          <rect x="246" y="206" width="244" height="128" rx="5" />
        </clipPath>
      </defs>

      <ellipse cx="300" cy="260" rx="270" ry="190" fill="url(#ws-glow)" />

      {/* 窗外的星 */}
      {[[60, 70], [120, 36], [470, 60], [520, 120], [420, 30]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={1.6 + (i % 2)} fill="var(--ink)" opacity={0.18 + 0.18 * Math.abs(Math.sin(t * 1.3 + i))} />
      ))}

      {/* 身体（墨滴） */}
      <g transform={`translate(0 ${bodyY}) translate(150 335) scale(${1 / squash} ${squash}) translate(-150 -335)`}>
        <path d="M150 112 C 152 126 218 208 218 270 C 218 314 189 338 150 338 C 111 338 82 314 82 270 C 82 208 148 126 150 112 Z" fill="var(--ink)" />
        <path d="M150 112 C 160 104 170 106 172 114" fill="none" stroke="var(--ink)" strokeWidth="7" strokeLinecap="round" />
        <path d="M108 190 C 100 214 98 236 104 258" fill="none" stroke="var(--paper)" strokeWidth="5" strokeLinecap="round" opacity=".18" />
        {/* 脸 */}
        <g transform={`translate(0 ${0})`}>
          {[128, 172].map((ex) => (
            <g key={ex} transform={`translate(${ex} 256) scale(1 ${blink}) translate(${-ex} -256)`}>
              <circle cx={ex} cy={256} r={14} fill="var(--paper)" />
              <circle cx={ex + gx} cy={256 + gy} r={6.5} fill="var(--ink)" />
              <circle cx={ex + gx + 2} cy={256 + gy - 2} r={2} fill="var(--paper)" />
            </g>
          ))}
          <circle cx="110" cy="282" r="8" fill="var(--seal)" opacity=".5" />
          <circle cx="190" cy="282" r="8" fill="var(--seal)" opacity=".5" />
          {happy ? (
            <path d="M136 282 Q150 302 164 282 Z" fill="var(--paper)" />
          ) : ph === 'stuck' || ph === 'idea' ? (
            <ellipse cx="150" cy="290" rx="5" ry="6" fill="var(--paper)" />
          ) : (
            <path d="M138 286 Q150 296 162 286" fill="none" stroke="var(--paper)" strokeWidth="3.5" strokeLinecap="round" />
          )}
          {ph === 'stuck' && <path d="M206 232 q6 12 0 18 q-6 -6 0 -18" fill="#7cc3e8" opacity=".9" />}
        </g>
      </g>

      {/* 书桌 */}
      <rect x="30" y="330" width="500" height="20" rx="10" fill="#b98a5a" />
      <rect x="30" y="330" width="500" height="6" rx="3" fill="#d4a974" />
      <rect x="62" y="348" width="14" height="70" rx="4" fill="#9a7048" />
      <rect x="484" y="348" width="14" height="70" rx="4" fill="#9a7048" />

      {/* 烛台 */}
      <rect x="510" y="282" width="12" height="48" rx="3" fill="var(--paper-2)" stroke="var(--line-2)" />
      <g transform={`translate(516 280) scale(${flame} ${flame})`}>
        <path d="M0 -26 C 7 -14 8 -6 0 0 C -8 -6 -7 -14 0 -26 Z" fill="var(--gold)" />
        <path d="M0 -14 C 3 -9 3 -5 0 -2 C -3 -5 -3 -9 0 -14 Z" fill="#fff6d0" />
      </g>

      {/* 稿纸 */}
      <g transform="rotate(-2 368 270)">
        <rect x="246" y="206" width="244" height="128" rx="5" fill="var(--paper-2)" stroke="var(--line-2)" strokeWidth="1.5" />
        {[0, 1, 2, 3].map((i) => (
          <line key={i} x1="258" x2="478" y1={250 + i * 24} y2={250 + i * 24} stroke="var(--line)" strokeWidth="1" />
        ))}
        <g clipPath="url(#ws-paper)" opacity={fade}>
          {text.map((s, i) => (
            <text key={i} x="262" y={246 + i * 24} fontSize="18" letterSpacing="2.4" fill="var(--ink)" style={{ fontFamily: 'var(--font-serif)' }}>
              {s}
            </text>
          ))}
        </g>
        {/* 盖章 */}
        {stampShown && (
          <g transform={`translate(452 ${300 + stampDrop}) scale(${stampScale})`} opacity={t < 11.7 ? ease((t - 11.6) / 0.1) : 1}>
            {ripple > 0 && ripple < 1 && <circle r={26 + ripple * 34} fill="none" stroke="var(--seal)" strokeWidth="2" opacity={0.5 * (1 - ripple)} />}
            <rect x="-24" y="-24" width="48" height="48" rx="5" fill="var(--seal)" transform="rotate(-6)" />
            <rect x="-19" y="-19" width="38" height="38" rx="3" fill="none" stroke="var(--paper)" strokeWidth="1.5" opacity=".6" transform="rotate(-6)" />
            <text x="0" y="9" textAnchor="middle" fontSize="26" fill="var(--paper)" transform="rotate(-6)" style={{ fontFamily: 'var(--font-serif)', fontWeight: 700 }}>
              完
            </text>
          </g>
        )}
      </g>

      {/* 右手 + 毛笔 */}
      {ph !== 'cheer' && <line x1={hand.x} y1={hand.y} x2={tip.x} y2={tip.y} stroke="#6b4a2f" strokeWidth="5" strokeLinecap="round" />}
      {ph !== 'cheer' && <line x1={tip.x - 1} y1={tip.y - 6} x2={tip.x} y2={tip.y} stroke="var(--seal)" strokeWidth="6" strokeLinecap="round" />}
      <path d={`M${shoulder.x} ${shoulder.y} Q ${handCtrl.x} ${handCtrl.y} ${hand.x} ${hand.y}`} fill="none" stroke="var(--ink)" strokeWidth="11" strokeLinecap="round" />
      <circle cx={hand.x} cy={hand.y} r="8" fill="var(--ink)" />
      {/* 左手 */}
      <path d={`M${lShoulder.x} ${lShoulder.y} Q ${(lShoulder.x + lHand.x) / 2 - 8} ${Math.max(lShoulder.y, lHand.y) + 10} ${lHand.x} ${lHand.y}`} fill="none" stroke="var(--ink)" strokeWidth="11" strokeLinecap="round" />
      <circle cx={lHand.x} cy={lHand.y} r="8" fill="var(--ink)" />

      {/* 升起的字 */}
      {writing &&
        GLYPHS.map((g, i) => {
          const life = ((t * 0.9 + i / GLYPHS.length) % 1) as number;
          return (
            <text key={g} x={290 + i * 36} y={226 - life * 70} fontSize="17" fill="var(--seal)" opacity={Math.sin(life * Math.PI) * 0.7} style={{ fontFamily: 'var(--font-serif)' }}>
              {g}
            </text>
          );
        })}

      {/* 想法气泡 */}
      {bubble > 0 && (
        <g transform={`translate(70 70) scale(${bubble})`} opacity={bubble}>
          <circle cx="58" cy="92" r="4" fill="var(--paper-2)" stroke="var(--line-2)" />
          <circle cx="48" cy="104" r="2.6" fill="var(--paper-2)" stroke="var(--line-2)" />
          <ellipse cx="68" cy="40" rx="46" ry="34" fill="var(--paper-2)" stroke="var(--line-2)" strokeWidth="1.5" />
          {ph === 'idea' ? (
            <g transform="translate(68 38)">
              <circle r="13" fill="var(--gold)" />
              <rect x="-6" y="11" width="12" height="7" rx="2" fill="var(--ink)" opacity=".6" />
              {[0, 60, 120, 180, 240, 300].map((a) => (
                <line key={a} x1="0" y1="-19" x2="0" y2="-26" stroke="var(--gold)" strokeWidth="3" strokeLinecap="round" transform={`rotate(${a + t * 40})`} />
              ))}
            </g>
          ) : (
            <text x="68" y="54" textAnchor="middle" fontSize="40" fill="var(--ink)" opacity=".7" style={{ fontFamily: 'var(--font-serif)' }}>
              ？
            </text>
          )}
        </g>
      )}

      {/* 欢呼的彩点 */}
      {ph === 'cheer' &&
        Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2 + i;
          const r = 20 + cheerT * (70 + (i % 4) * 22);
          const colors = ['var(--seal)', 'var(--gold)', 'var(--jade)', 'var(--indigo)'];
          return <circle key={i} cx={452 + Math.cos(a) * r} cy={290 + Math.sin(a) * r * 0.8 + cheerT * cheerT * 16} r={3.2 - cheerT * 0.8} fill={colors[i % 4]} opacity={Math.max(0, 1 - cheerT / 2.2)} />;
        })}
    </svg>
  );
}

export function WritingScene({ className }: { className?: string }) {
  const prefersReduced = useSettings((s) => s.reducedMotion) || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  // 偏好「减少动态效果」的人默认看静态画面，但可以自己点「播放动画」
  const [forcePlay, setForcePlay] = useState(false);
  const reduced = prefersReduced && !forcePlay;
  const [t, setT] = useState(prefersReduced ? 13 : 0);
  const [sound, setSoundState] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const visible = useRef(true);
  const fired = useRef(new Set<string>());
  const lastWhole = useRef(0);

  useEffect(() => resumeOnGesture(), []);
  useEffect(() => {
    const id = setInterval(() => setSoundState(soundOn()), 400);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (reduced || !box.current) return;
    const io = new IntersectionObserver(([e]) => (visible.current = e.isIntersecting));
    io.observe(box.current);
    return () => io.disconnect();
  }, [reduced]);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let last = performance.now();
    let clock = 0;
    let lastPaint = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (document.hidden || !visible.current) return;
      clock += dt;
      if (clock >= LOOP) {
        clock -= LOOP;
        fired.current.clear();
        lastWhole.current = 0;
      }
      // 音效与画面共用同一个时间轴
      const w = Math.floor(written(clock));
      if (w > lastWhole.current) {
        sfxStroke();
        lastWhole.current = w;
      }
      const cues: [string, number, () => void][] = [['idea', 1.4, sfxIdea], ['hmm', 6.4, sfxHmm], ['thump', 12.0, sfxThump], ['cheer', 12.1, sfxCheer]];
      for (const [k, at, fn] of cues) {
        if (clock >= at && !fired.current.has(k)) {
          fired.current.add(k);
          if (clock - at < 0.4) fn();
        }
      }
      if (now - lastPaint > 28) {
        lastPaint = now;
        setT(clock);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const toggle = async () => {
    const next = !soundOn();
    await setSound(next);
    setSoundState(soundOn());
  };

  return (
    <div ref={box} className={cx('relative select-none', className)}>
      <Scene t={t} still={reduced} />
      {prefersReduced && !forcePlay && (
        <button type="button" onClick={() => setForcePlay(true)} className="absolute bottom-1 left-1 flex items-center gap-1.5 rounded-full border border-line bg-paper-2/80 px-3 py-1.5 text-[12px] text-ink-2 backdrop-blur transition hover:border-line-2 hover:text-ink">
          <Play className="size-3.5" />
          播放动画
        </button>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-pressed={sound}
        className="absolute right-1 bottom-1 flex items-center gap-1.5 rounded-full border border-line bg-paper-2/80 px-3 py-1.5 text-[12px] text-ink-2 backdrop-blur transition hover:border-line-2 hover:text-ink"
      >
        {sound ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
        {sound ? '声音已开' : soundPreferred() ? '点一下恢复声音' : '开启声音'}
      </button>
    </div>
  );
}
