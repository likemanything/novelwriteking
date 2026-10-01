/**
 * 生成式封面：每本书是一册「线装书」。
 * 布面的纹样由书的种子织出，右侧是四眼订线，左上是竖排的题签。
 */
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { useMemo, type PointerEvent } from 'react';
import type { CoverSpec } from '@/lib/types';
import { cx, seededRandom } from '@/lib/util';
import { Seal } from './Seal';

function pattern(spec: CoverSpec) {
  const r = seededRandom(spec.seed);
  const lines: string[] = [];
  switch (spec.pattern) {
    case 'wave':
      for (let i = 0; i < 16; i++) {
        const y = 30 + i * 24;
        const amp = 4 + r() * 10;
        const f = 0.02 + r() * 0.02;
        const ph = r() * 6;
        let d = `M0 ${y}`;
        for (let x = 0; x <= 300; x += 10) d += ` L${x} ${(y + Math.sin(x * f + ph) * amp).toFixed(1)}`;
        lines.push(d);
      }
      break;
    case 'knot': {
      const cx0 = 90 + r() * 120;
      const cy0 = 200 + r() * 120;
      for (let i = 1; i < 16; i++) {
        const rad = i * 18;
        lines.push(`M${cx0 - rad} ${cy0} a${rad} ${rad * (0.8 + r() * 0.3)} 0 1 0 ${rad * 2} 0 a${rad} ${rad} 0 1 0 ${-rad * 2} 0`);
      }
      break;
    }
    case 'rain':
      for (let i = 0; i < 40; i++) {
        const x = r() * 300;
        const y = r() * 400;
        const len = 30 + r() * 110;
        lines.push(`M${x.toFixed(1)} ${y.toFixed(1)} l${(-len * 0.18).toFixed(1)} ${len.toFixed(1)}`);
      }
      break;
    default: {
      // weave：经纬交织
      for (let i = 0; i < 14; i++) {
        const y = 20 + i * 28;
        let d = `M0 ${y}`;
        for (let x = 0; x <= 300; x += 30) d += ` Q${x + 15} ${y + (Math.floor(x / 30) % 2 ? 7 : -7)} ${x + 30} ${y}`;
        lines.push(d);
      }
      for (let i = 0; i < 10; i++) lines.push(`M${15 + i * 30} 0 L${15 + i * 30} 400`);
    }
  }
  return lines;
}

export function Cover({ spec, title, width = 180, className, tilt = true, author }: { spec: CoverSpec; title: string; width?: number | string; className?: string; tilt?: boolean; author?: string }) {
  const paths = useMemo(() => pattern(spec), [spec]);
  const h = spec.hue;
  const cloth = `hsl(${h} 34% 27%)`;
  const cloth2 = `hsl(${(h + 18) % 360} 38% 19%)`;
  const threadColor = `hsl(${h} 42% 62%)`;
  const chars = [...(title || '未命名')].slice(0, 10);
  const fs = Math.min(26, 172 / Math.max(4, chars.length));

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [7, -7]), { stiffness: 220, damping: 20 });
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-9, 9]), { stiffness: 220, damping: 20 });
  const glareX = useTransform(mx, [-0.5, 0.5], ['0%', '100%']);
  const glare = useTransform(glareX, (x) => `radial-gradient(circle at ${x} 20%, rgba(255,255,255,.55), transparent 55%)`);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!tilt) return;
    const rect = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - rect.left) / rect.width - 0.5);
    my.set((e.clientY - rect.top) / rect.height - 0.5);
  };
  const onLeave = () => {
    mx.set(0);
    my.set(0);
  };

  return (
    <div className={cx('[perspective:900px]', className)} style={{ width }} onPointerMove={onMove} onPointerLeave={onLeave}>
      <motion.div style={{ rotateX: rx, rotateY: ry, transformStyle: 'preserve-3d' }} className="relative">
        <svg viewBox="0 0 300 400" className="block w-full rounded-[3px_6px_6px_3px] shadow-[0_2px_4px_rgba(0,0,0,.18),0_18px_40px_-12px_rgba(20,10,0,.45)]" role="img" aria-label={`《${title}》封面`}>
          <defs>
            <linearGradient id={`g${spec.seed}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={cloth} />
              <stop offset="1" stopColor={cloth2} />
            </linearGradient>
          </defs>
          <rect width="300" height="400" fill={`url(#g${spec.seed})`} />
          <g stroke={threadColor} strokeWidth="1.1" fill="none" opacity=".32">
            {paths.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
          {/* 右侧订线：四眼装 */}
          <line x1="268" y1="0" x2="268" y2="400" stroke="#000" strokeOpacity=".25" />
          <rect x="268" y="0" width="32" height="400" fill="#000" fillOpacity=".12" />
          <line x1="284" y1="0" x2="284" y2="400" stroke="#efe4cf" strokeOpacity=".85" strokeWidth="2" />
          {[60, 150, 250, 340].map((y) => (
            <g key={y}>
              <line x1="284" y1={y} x2="300" y2={y} stroke="#efe4cf" strokeOpacity=".85" strokeWidth="2" />
              <circle cx="284" cy={y} r="3" fill="#1a120a" fillOpacity=".75" />
            </g>
          ))}
          {/* 题签 */}
          <rect x="26" y="26" width="62" height="226" fill="#f3ead8" />
          <rect x="30" y="30" width="54" height="218" fill="none" stroke="#6b4f2a" strokeOpacity=".5" strokeWidth="1" />
          {chars.map((ch, i) => (
            <text key={i} x="57" y={58 + i * (fs + 3)} textAnchor="middle" fontSize={fs} fontWeight="600" fill="#231a10" fontFamily="'Noto Serif SC','Songti SC',serif">
              {ch}
            </text>
          ))}
          {author && (
            <text x="120" y="380" fontSize="11" fill="#efe4cf" fillOpacity=".7" fontFamily="'Noto Serif SC',serif" letterSpacing="3">
              {author}
            </text>
          )}
        </svg>
        <div className="pointer-events-none absolute right-[14%] bottom-[7%]" style={{ width: '14%' }}>
          <Seal chars="墨织" size={999} fine className="h-auto w-full opacity-90" seed={spec.seed % 9} />
        </div>
        {tilt && (
          <motion.div
            className="pointer-events-none absolute inset-0 rounded-[3px_6px_6px_3px] mix-blend-soft-light"
            style={{ background: glare }}
          />
        )}
      </motion.div>
    </div>
  );
}
