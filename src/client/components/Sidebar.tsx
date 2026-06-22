import type { Store, ChatActions } from '../useChat';
import { strategyLabel, formatDate } from '../format';

export function Sidebar({ s, a }: { s: Store; a: ChatActions }) {
  return (
    <aside className={'sidebar' + (s.sidebarCollapsed ? ' collapsed' : '')}>
      <div className="sidebar-header">History</div>
      <div className="sidebar-sessions">
        {s.sessions.length === 0 ? (
          <div className="session-empty">No history yet</div>
        ) : (
          s.sessions.map(session => (
            <div key={session.id} className={'session-item' + (session.id === s.sessionId ? ' active' : '')}>
              <div className="session-info" onClick={() => a.openSession(session.id)}>
                <div className="session-title">{session.title}</div>
                <div className="session-meta">
                  <span className="session-date">{formatDate(session.updatedAt)}</span>
                  <span className={'session-strategy' + (session.strategy ? ' session-strategy--active' : '')}>
                    {strategyLabel(session.strategy, session.slidingWindowSize)}
                  </span>
                </div>
              </div>
              <button
                className="session-delete"
                aria-label="Delete session"
                onClick={e => { e.stopPropagation(); a.deleteSession(session.id); }}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
