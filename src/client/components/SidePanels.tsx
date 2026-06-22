import type { Store, ChatActions } from '../useChat';

function MemoryList({ entries, command, onDelete }: { entries: string[]; command: string; onDelete: (i: number) => void }) {
  if (entries.length === 0) {
    return <div className="memory-empty">{`Empty — try ${command} <text>`}</div>;
  }
  return (
    <>
      {entries.map((entry, i) => (
        <div className="memory-item" key={i}>
          <span className="memory-item-text">{entry}</span>
          <button className="memory-item-delete" aria-label="Remove entry" onClick={() => onDelete(i)}>×</button>
        </div>
      ))}
    </>
  );
}

function CollapseTab({ collapsed, label, onClick }: { collapsed: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={'panel-collapse-tab' + (collapsed ? ' collapsed' : '')}
      aria-label={`Collapse ${label} panel`}
      aria-expanded={!collapsed}
      onClick={onClick}
    >
      ‹
    </button>
  );
}

export function FactsPanel({ s }: { s: Store }) {
  const entries = Object.entries(s.facts);
  return (
    <aside className={'facts-panel' + (s.strategy === 'sticky-facts' ? ' visible' : '')}>
      <div className="facts-header">Sticky Facts</div>
      <div className="facts-list">
        {entries.length === 0 ? (
          <div className="facts-empty">No facts yet</div>
        ) : (
          entries.map(([key, value]) => (
            <div className="facts-item" key={key}>
              <span className="facts-key">{key}</span>
              <span className="facts-value">{value}</span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

export function InvariantsPanel({ s, a }: { s: Store; a: ChatActions }) {
  return (
    <div className="panel-wrap">
      <aside className={'invariants-panel' + (s.invariantsCollapsed ? ' collapsed' : '')}>
        <div className="invariants-header">Invariants <span className="memory-hint">global, always enforced</span></div>
        <div className="memory-list">
          <MemoryList entries={s.invariants} command="/add-invariant" onDelete={a.deleteInvariant} />
        </div>
      </aside>
      <CollapseTab collapsed={s.invariantsCollapsed} label="invariants" onClick={() => a.togglePanel('invariants')} />
    </div>
  );
}

export function ProfilesPanel({ s, a }: { s: Store; a: ChatActions }) {
  return (
    <div className="panel-wrap">
      <aside className={'profiles-panel' + (s.profilesCollapsed ? ' collapsed' : '')}>
        <div className="profiles-header">Profiles</div>
        <div className="profiles-list">
          {s.profiles.length === 0 ? (
            <div className="profiles-empty">No profiles yet — try /create-profile &lt;name&gt; &lt;definition&gt;</div>
          ) : (
            s.profiles.map(profile => (
              <div key={profile.id} className={'profile-item' + (profile.id === s.activeProfileId ? ' active' : '')}>
                <div className="profile-item-info" onClick={() => a.switchProfile(profile.id)}>
                  <div className="profile-item-name">{profile.name}</div>
                  <div className="profile-item-def">{profile.definition}</div>
                </div>
                <button
                  className="profile-item-delete"
                  aria-label="Delete profile"
                  onClick={e => { e.stopPropagation(); a.deleteProfile(profile.id); }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </aside>
      <CollapseTab collapsed={s.profilesCollapsed} label="profiles" onClick={() => a.togglePanel('profiles')} />
    </div>
  );
}

export function MemoryPanel({ s, a }: { s: Store; a: ChatActions }) {
  return (
    <div className="panel-wrap">
      <aside className={'memory-panel' + (s.memoryCollapsed ? ' collapsed' : '')}>
        <div className="memory-header">Memory Layers</div>
        <div className="memory-section">
          <div className="memory-section-title">Short-term <span className="memory-hint">this dialog</span></div>
          <div className="memory-list">
            <MemoryList entries={s.shortMemory} command="/short-memory" onDelete={a.deleteShortMemory} />
          </div>
        </div>
        <div className="memory-section">
          <div className="memory-section-title">Working <span className="memory-hint">this task</span></div>
          <div className="memory-list">
            <MemoryList entries={s.workingMemory} command="/work-memory" onDelete={a.deleteWorkingMemory} />
          </div>
        </div>
        <div className="memory-section">
          <div className="memory-section-title">Long-term <span className="memory-hint">always</span></div>
          <div className="memory-list">
            <MemoryList entries={s.longTermMemory} command="/long-memory" onDelete={a.deleteLongTermMemory} />
          </div>
        </div>
      </aside>
      <CollapseTab collapsed={s.memoryCollapsed} label="memory" onClick={() => a.togglePanel('memory')} />
    </div>
  );
}
