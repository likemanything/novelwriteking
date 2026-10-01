/** 未登录时的首页：先让人看到产品是什么，再引导登录。 */
import { motion } from 'motion/react';
import { ArrowRight, BookOpen, Clapperboard, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { BrandMark } from '@/components/Brand';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui';
import { Hero } from './Hero';

const FEATURES = [
  { icon: BookOpen, title: '写长篇，不迷路', text: '先定人物、世界观和大纲，再一章一章写、审、改。每次生成用了哪些设定和前文，全部可见、可调。' },
  { icon: Clapperboard, title: '一键改编成短剧', text: '小说进去，分集大纲、剧本、分镜出来。无限画布上每一步都能改、能重跑，剧本里每场戏都能追溯到原文。' },
  { icon: Users, title: '团队一起写', text: '主编、作者、协作者各司其职；同一章同一时间只有一个人编辑，云端同步，断网也能继续写。' },
];

export default function Landing() {
  const navigate = useNavigate();
  const toLogin = (next?: string) => navigate(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  return (
    <div className="h-full overflow-y-auto">
      <Hero
        topBar={
          <header className="relative z-30 flex h-16 items-center gap-4 px-6">
            <BrandMark />
            <div className="flex-1" />
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={() => toLogin()}>
              登录
            </Button>
          </header>
        }
        onStart={(seed) => toLogin(`/genesis?seed=${encodeURIComponent(seed)}`)}
      />

      <section className="mx-auto max-w-5xl px-6 pb-20">
        <ul className="grid gap-6 md:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.li key={f.title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ delay: i * 0.1, duration: 0.6 }} className="surface rounded-3xl p-6">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-seal/10 text-seal">
                <f.icon className="size-5" strokeWidth={1.8} />
              </span>
              <h3 className="mt-4 font-serif text-[18px] font-semibold">{f.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{f.text}</p>
            </motion.li>
          ))}
        </ul>

        <div className="mt-16 flex flex-col items-center gap-4 text-center">
          <h2 className="font-serif text-[26px] font-semibold">现在就写下第一句</h2>
          <p className="max-w-md text-[13.5px] leading-relaxed text-ink-3">登录后，你的作品会保存在云端。目前为邀请制内测，需要邀请码或团队邀请链接注册。</p>
          <Button variant="seal" size="lg" onClick={() => toLogin()} icon={<ArrowRight className="size-4" />}>
            登录 / 注册
          </Button>
          <Link to="/login" className="sr-only">
            登录
          </Link>
        </div>
      </section>
    </div>
  );
}
