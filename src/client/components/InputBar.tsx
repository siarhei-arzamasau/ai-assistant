import { useEffect, useRef, useState } from 'react';
import type { Store, ChatActions } from '../useChat';

export function InputBar({ s, a }: { s: Store; a: ChatActions }) {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  };

  // Re-focus the input once streaming finishes (it is disabled while streaming).
  useEffect(() => {
    if (!s.streaming) taRef.current?.focus();
  }, [s.streaming]);

  const submit = () => {
    const t = text.trim();
    if (!t || s.streaming) return;
    setText('');
    requestAnimationFrame(autoResize);
    void a.send(t);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!s.streaming && text.trim()) submit();
    }
  };

  const onButtonClick = () => {
    if (s.streaming) a.stopStreaming();
    else submit();
  };

  const buttonDisabled = s.streaming ? false : !text.trim();
  const showStats = !(s.lastInputTokens === 0 && s.sessionOutputTokens === 0);

  return (
    <footer className="footer">
      <div className="input-shell">
        <textarea
          ref={taRef}
          className="input"
          placeholder="Message Claude…"
          rows={1}
          autoFocus
          value={text}
          disabled={s.streaming}
          onChange={e => { setText(e.target.value); autoResize(); }}
          onKeyDown={onKeyDown}
        />
        <button
          className={'btn-send' + (s.streaming ? ' streaming' : '')}
          aria-label={s.streaming ? 'Stop' : 'Send'}
          disabled={buttonDisabled}
          onClick={onButtonClick}
        >
          <svg className="icon-send" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
          <svg className="icon-stop" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      </div>
      {showStats && (
        <div className="session-stats">
          {`Session: ${s.sessionOutputTokens.toLocaleString()} out total · ${s.lastInputTokens.toLocaleString()} ctx`}
        </div>
      )}
      <p className="footer-note">
        Claude can make mistakes. Verify important information. · Type <strong>/help</strong> to see all commands
      </p>
    </footer>
  );
}
