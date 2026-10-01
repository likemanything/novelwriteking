import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// 聚光：给带 data-spot 的卡片写入光标位置，CSS 用它画一团跟着鼠标走的柔光
let spotRaf = 0;
window.addEventListener(
  'pointermove',
  (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.('[data-spot], .surface') as HTMLElement | null;
    if (!el) return;
    cancelAnimationFrame(spotRaf);
    spotRaf = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  },
  { passive: true },
);

// 请求持久化存储，避免浏览器在空间紧张时清理作品数据
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
