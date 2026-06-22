import { Fragment } from 'react';
import type { Store, ChatActions } from '../useChat';

export function CompareModal({ s, a }: { s: Store; a: ChatActions }) {
  if (!s.compare) return null;

  return (
    <div className="compare-modal">
      <div className="compare-overlay" onClick={a.closeCompare} />
      <div className="compare-dialog">
        <div className="compare-header">
          <span>Branch Comparison</span>
          <button className="compare-close" onClick={a.closeCompare}>×</button>
        </div>
        <div className="compare-body">
          {s.compare.map((col, ci) => (
            <div className="compare-col" key={ci}>
              <div className="compare-col-header">{col.label + (col.active ? ' ✦' : '')}</div>
              <div className="compare-col-body">
                {col.messages.map((msg, i) => (
                  <Fragment key={i}>
                    {i === col.forkIdx && col.forkIdx < col.messages.length && (
                      <div className="compare-fork-marker">— fork point —</div>
                    )}
                    <div className="compare-msg">
                      <div className={`compare-msg-role ${msg.role}`}>{msg.role}</div>
                      <div className="compare-msg-content">{msg.content}</div>
                    </div>
                  </Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
