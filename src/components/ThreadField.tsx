/**
 * 丝线场：首页与开书页背后流动的彩色丝线。
 *
 * - energy（0–1）：作者打字时丝线加速、振幅变大，像织机被踩动；
 * - converge（0–1）：生成时所有丝线向中心收拢，汇成一股——“把灵感织成书”；
 * - 指针靠近时丝线会被轻轻拨开。
 * 尊重「减少动态效果」：只绘制静止的一帧。
 */
import { useEffect, useRef } from 'react';
import { SILK } from '@/lib/util';
import { useSettings } from '@/store/settings';

interface Props {
  energy?: number;
  converge?: number;
  count?: number;
  className?: string;
  opacity?: number;
}

export function ThreadField({ energy = 0, converge = 0, count = 9, className, opacity = 1 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const props = useRef({ energy, converge });
  props.current = { energy, converge };
  const reduced = useSettings((s) => s.reducedMotion);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const prefersReduced = reduced || matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let raf = 0;
    const pointer = { x: -9999, y: -9999 };
    const live = { energy: 0, converge: 0 };

    const threads = Array.from({ length: count }, (_, i) => ({
      color: SILK[i % SILK.length].hex,
      base: (i + 1) / (count + 1),
      amp: 18 + ((i * 37) % 30),
      freq: 0.0016 + ((i * 13) % 7) * 0.00035,
      speed: 0.00018 + ((i * 7) % 5) * 0.00006,
      phase: i * 1.7,
      width: i % 3 === 0 ? 1.6 : 1,
    }));

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (t: number) => {
      // 平滑逼近目标值，避免突变
      live.energy += (props.current.energy - live.energy) * 0.06;
      live.converge += (props.current.converge - live.converge) * 0.035;
      ctx.clearRect(0, 0, w, h);
      const dark = document.documentElement.classList.contains('dark');
      const e = live.energy;
      const c = live.converge;
      const mid = h * 0.5;
      for (const th of threads) {
        ctx.beginPath();
        ctx.strokeStyle = th.color;
        ctx.globalAlpha = (dark ? 0.6 : 0.42) * (0.75 + e * 0.25);
        ctx.lineWidth = th.width * (1 + c * 0.6);
        const time = t * th.speed * (1 + e * 2.6);
        for (let x = -10; x <= w + 10; x += 7) {
          const nx = x / Math.max(1, w);
          // 收拢时：两端保持散开，中段汇成一股
          const pinch = c * Math.sin(Math.PI * Math.min(1, Math.max(0, nx * 1.15 - 0.075)));
          const baseY = th.base * h * (1 - pinch) + mid * pinch;
          const amp = th.amp * (1 + e * 1.8) * (1 - pinch * 0.85);
          let y = baseY + Math.sin(x * th.freq * 6 + time * 6 + th.phase) * amp + Math.sin(x * th.freq * 2.3 - time * 3 + th.phase * 2) * amp * 0.6;
          const dx = x - pointer.x;
          const dy = y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 26000) y += (dy / Math.sqrt(d2 + 1)) * 34 * (1 - d2 / 26000);
          if (x === -10) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (!prefersReduced) raf = requestAnimationFrame(draw);
    };

    const onPointer = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ev.clientX - rect.left;
      pointer.y = ev.clientY - rect.top;
    };
    const onLeave = () => {
      pointer.x = -9999;
      pointer.y = -9999;
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (prefersReduced) draw(0);
    });
    ro.observe(canvas);
    window.addEventListener('pointermove', onPointer);
    document.addEventListener('pointerleave', onLeave);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [count, reduced]);

  return <canvas ref={canvasRef} className={className} style={{ opacity }} aria-hidden="true" />;
}
