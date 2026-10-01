import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Seal } from './Seal';

/** 兜底：任何页面崩溃都不会让整个应用白屏，作品数据在本地数据库里安然无恙。 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[inkloom]', error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <Seal chars="小憩" size={64} />
        <div className="font-serif text-xl">页面出错了</div>
        <p className="max-w-md text-[13px] leading-relaxed text-ink-3">页面出了点意外，但你的作品都安全地保存在本地。可以返回重试。</p>
        <code className="max-w-lg truncate rounded-lg bg-ink/[.05] px-3 py-1.5 text-[11px] text-ink-3">{this.state.error.message}</code>
        <div className="flex gap-2">
          <button className="rounded-xl border border-line-2 px-4 py-2 text-sm hover:bg-paper-2" onClick={() => this.setState({ error: null })}>
            重试
          </button>
          <button className="rounded-xl bg-ink px-4 py-2 text-sm text-paper" onClick={() => location.assign('/')}>
            回到书架
          </button>
        </div>
      </div>
    );
  }
}
