import { useEffect, useRef } from 'react';
import type { Store } from '../useChat';
import type { DisplayItem } from '../types';
import { escapeHtml, renderMarkdown } from '../markdown';

function AssistantBubble({ item }: { item: Extract<DisplayItem, { kind: 'message' }> }) {
  if (item.streaming) {
    return (
      <div
        className="bubble bubble-assistant streaming"
        data-thinking={item.thinking ? '1' : undefined}
      >
        {item.content}
      </div>
    );
  }

  const body = item.error ? escapeHtml(item.content) : renderMarkdown(item.content);
  const timeHtml = item.time ? `<div class="bubble-time">${escapeHtml(item.time)}</div>` : '';
  const tagHtml = item.interrupted
    ? `<div class="bubble-interrupted-tag">${item.content ? 'Stopped' : 'Stopped before any response'}</div>`
    : '';

  return (
    <div
      className={'bubble bubble-assistant' + (item.error ? ' error' : '') + (item.interrupted ? ' interrupted' : '')}
      dangerouslySetInnerHTML={{ __html: body + timeHtml + tagHtml }}
    />
  );
}

function Item({ item }: { item: DisplayItem }) {
  if (item.kind === 'system') {
    const cls = 'bubble bubble-system' + (item.align === 'left' ? ' align-left' : '') + (item.mono ? ' mono' : '');
    return (
      <div className="message message-system">
        <div className={cls}>{item.text}</div>
      </div>
    );
  }

  if (item.role === 'user') {
    return (
      <div className="message message-user">
        <div className="bubble bubble-user">{item.content}</div>
      </div>
    );
  }

  return (
    <div className="message message-assistant">
      <div className="avatar avatar-assistant">&#9670;</div>
      <div className="assistant-col">
        {item.stageLabel && <div className="bubble-stage-label">{item.stageLabel}</div>}
        <AssistantBubble item={item} />
      </div>
    </div>
  );
}

export function Transcript({ s }: { s: Store }) {
  const mainRef = useRef<HTMLElement>(null);

  // Mirror the original behaviour: keep the view pinned to the latest content.
  useEffect(() => {
    const el = mainRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  return (
    <main className="main" ref={mainRef}>
      <div className="messages">
        {s.transcript.length === 0 ? (
          <div className="welcome">
            <div className="welcome-glyph">&#9670;</div>
            <h1>How can I help you today?</h1>
            <p>Powered by Claude via the Anthropic API</p>
          </div>
        ) : (
          s.transcript.map(item => <Item key={item.id} item={item} />)
        )}
      </div>
    </main>
  );
}
