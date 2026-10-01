/**
 * 首页动画的音效：全部用 Web Audio 现场合成，没有任何音频文件。
 * 浏览器规定必须有用户操作之后才能出声，所以默认静音，点「开启声音」后才创建 AudioContext。
 */

const KEY = 'inkloom.sound';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let pad: { stop: () => void } | null = null;
let on = false;

export function soundPreferred(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function ensure(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    const len = ctx.sampleRate;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return ctx;
}

/** 开 / 关声音。必须在用户点击等手势里调用才能生效。 */
export async function setSound(enabled: boolean) {
  try {
    localStorage.setItem(KEY, enabled ? '1' : '0');
  } catch {
    /* 忽略 */
  }
  on = enabled;
  if (enabled) {
    const c = ensure();
    if (!c) return;
    await c.resume().catch(() => {});
    startPad();
    chime([523.25, 659.25], 0.05, 0.12);
  } else {
    pad?.stop();
    pad = null;
  }
}

export function soundOn() {
  return on && !!ctx && ctx.state === 'running';
}

/** 之前开启过声音时，在用户的第一次操作后恢复。 */
export function resumeOnGesture(): () => void {
  if (!soundPreferred()) return () => {};
  const go = () => void setSound(true);
  window.addEventListener('pointerdown', go, { once: true });
  window.addEventListener('keydown', go, { once: true });
  return () => {
    window.removeEventListener('pointerdown', go);
    window.removeEventListener('keydown', go);
  };
}

function ok(): boolean {
  return on && !!ctx && ctx.state === 'running' && !!master;
}

function burst(opts: { freq: number; q: number; dur: number; gain: number; when?: number }) {
  if (!ok()) return;
  const c = ctx!;
  const t = c.currentTime + (opts.when ?? 0);
  const src = c.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = opts.freq;
  f.Q.value = opts.q;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(opts.gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  src.connect(f).connect(g).connect(master!);
  src.start(t, Math.random() * 0.5);
  src.stop(t + opts.dur + 0.02);
}

function tone(freq: number, o: { dur: number; gain: number; type?: OscillatorType; when?: number; slideTo?: number }) {
  if (!ok()) return;
  const c = ctx!;
  const t = c.currentTime + (o.when ?? 0);
  const osc = c.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t + o.dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g).connect(master!);
  osc.start(t);
  osc.stop(t + o.dur + 0.05);
}

function chime(freqs: number[], gain = 0.08, gap = 0.09) {
  freqs.forEach((f, i) => tone(f, { dur: 1.1, gain, when: i * gap, type: 'sine' }));
}

/** 一个字落笔：毛笔沙沙一下，带一点点木桌的磕声。 */
export function sfxStroke() {
  burst({ freq: 2600 + Math.random() * 1400, q: 1.2, dur: 0.07, gain: 0.11 });
  if (Math.random() < 0.35) tone(180 + Math.random() * 40, { dur: 0.05, gain: 0.03, type: 'triangle' });
}

/** 灵光一闪：叮 */
export function sfxIdea() {
  chime([880, 1318.5, 1760], 0.06, 0.07);
}

/** 卡壳：低低的一声「嗯？」 */
export function sfxHmm() {
  tone(220, { dur: 0.32, gain: 0.07, type: 'triangle', slideTo: 165 });
  tone(247, { dur: 0.3, gain: 0.05, type: 'triangle', slideTo: 196, when: 0.18 });
}

/** 盖章：闷闷的一声「咚」 */
export function sfxThump() {
  tone(140, { dur: 0.28, gain: 0.3, slideTo: 48 });
  burst({ freq: 500, q: 0.8, dur: 0.12, gain: 0.18 });
}

/** 完稿欢呼：上行琶音 */
export function sfxCheer() {
  [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, { dur: 0.7, gain: 0.07, type: 'triangle', when: i * 0.075 }));
}

/** 很轻的底噪：像深夜书房里细细的雨。 */
function startPad() {
  if (pad || !ok()) return;
  const c = ctx!;
  const src = c.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 900;
  const g = c.createGain();
  g.gain.value = 0.0;
  g.gain.linearRampToValueAtTime(0.018, c.currentTime + 2);
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.12;
  const lg = c.createGain();
  lg.gain.value = 250;
  lfo.connect(lg).connect(f.frequency);
  src.connect(f).connect(g).connect(master!);
  src.start();
  lfo.start();
  pad = {
    stop: () => {
      g.gain.cancelScheduledValues(c.currentTime);
      g.gain.linearRampToValueAtTime(0, c.currentTime + 0.3);
      setTimeout(() => {
        src.stop();
        lfo.stop();
      }, 400);
    },
  };
}
