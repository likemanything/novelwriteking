/**
 * 朱砂印章。墨织的视觉签名：品牌标识、定稿盖印、作品封面上的落款都用它。
 * 用 SVG 滤镜模拟印泥的毛边与斑驳，每个印章都像真的盖在纸上。
 */
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useRef } from 'react';
import { cx } from '@/lib/util';

function useSafeId(prefix: string) {
  return prefix + useId().replace(/[^a-zA-Z0-9_-]/g, '');
}

export function Seal({ chars = '墨织', size = 40, className, color = 'var(--seal)', seed = 3, fine }: { chars?: string; size?: number; className?: string; color?: string; seed?: number; fine?: boolean }) {
  const id = useSafeId('seal');
  const list = [...chars].slice(0, 4);
  const two = list.length <= 2;
  // 小尺寸时减弱斑驳与毛边，保证字形清晰
  const small = fine ?? size < 64;
  const blot = small ? '0 0 0 -1.4 1.32' : '0 0 0 -2.4 1.75';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={cx('shrink-0', className)} aria-hidden="true">
      <defs>
        <filter id={id} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={seed} result="grain" />
          <feDisplacementMap in="SourceGraphic" in2="grain" scale={small ? 1.6 : 3} xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="3" seed={seed + 4} result="blot" />
          <feColorMatrix in="blot" type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${blot}`} result="mask" />
          <feComposite in="rough" in2="mask" operator="in" />
        </filter>
      </defs>
      <g filter={`url(#${id})`}>
        <rect x="5" y="5" width="90" height="90" rx="9" fill={color} />
        <rect x="11" y="11" width="78" height="78" rx="4" fill="none" stroke="#fbeee6" strokeWidth="2.6" />
        {list.length === 1 ? (
          <text x="50" y="71" textAnchor="middle" fontSize="60" fontWeight="900" fill="#fbeee6" fontFamily="'Noto Serif SC', 'Songti SC', serif">
            {list[0]}
          </text>
        ) : two ? (
          list.map((ch, i) => (
            <text key={i} x="50" y={i === 0 ? 46 : 81} textAnchor="middle" fontSize={small ? 37 : 34} fontWeight="900" fill="#fbeee6" fontFamily="'Noto Serif SC', 'Songti SC', serif">
              {ch}
            </text>
          ))
        ) : (
          // 四字印：右上起，竖读
          list.map((ch, i) => (
            <text key={i} x={i < 2 ? 69 : 31} y={i % 2 === 0 ? 46 : 80} textAnchor="middle" fontSize="30" fontWeight="900" fill="#fbeee6" fontFamily="'Noto Serif SC', 'Songti SC', serif">
              {ch}
            </text>
          ))
        )}
      </g>
    </svg>
  );
}

/** 定稿盖印的全屏动效：印章从空中落下，重重压在纸上，印泥向外晕开。 */
export function SealStamp({ show, chars = '定稿', onDone }: { show: boolean; chars?: string; onDone: () => void }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => done.current(), 1650);
    return () => clearTimeout(t);
  }, [show]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.5 } }}>
          <motion.div className="absolute inset-0 bg-paper/40" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 1.4, times: [0, 0.3, 1] }} />
          {/* 印泥晕开的环 */}
          <motion.div
            className="absolute size-56 rounded-[28px] border-[10px] border-seal/30"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: [0.8, 1.5], opacity: [0, 0.7, 0] }}
            transition={{ delay: 0.32, duration: 0.9, ease: 'easeOut' }}
          />
          {Array.from({ length: 10 }).map((_, i) => {
            const a = (i / 10) * Math.PI * 2;
            return (
              <motion.span
                key={i}
                className="absolute size-2 rounded-full bg-seal"
                initial={{ x: 0, y: 0, opacity: 0, scale: 1 }}
                animate={{ x: Math.cos(a) * 170, y: Math.sin(a) * 170, opacity: [0, 0.9, 0], scale: [1, 0.4] }}
                transition={{ delay: 0.34, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              />
            );
          })}
          <motion.div
            initial={{ scale: 2.4, rotate: -18, opacity: 0, y: -60 }}
            animate={{ scale: [2.4, 0.92, 1], rotate: [-18, -7, -8], opacity: [0, 1, 1], y: [-60, 0, 0] }}
            transition={{ duration: 0.55, times: [0, 0.62, 1], ease: [0.5, 0, 0.2, 1] }}
            className="drop-shadow-[0_12px_30px_rgba(160,30,20,.35)]"
          >
            <Seal chars={chars} size={200} seed={11} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
