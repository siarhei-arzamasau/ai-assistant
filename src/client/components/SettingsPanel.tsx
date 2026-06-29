import type { Store, ChatActions } from '../useChat';
import { MODELS, STRATEGIES } from '../constants';

export function SettingsPanel({ s, a }: { s: Store; a: ChatActions }) {
  const isOpus = s.model === 'claude-opus-4-8';
  const isHaiku = s.model === 'claude-haiku-4-5-20251001';
  const tempHint = isOpus
    ? 'n/a — temperature not supported'
    : isHaiku
      ? 'thinking not available on Haiku'
      : '1.0 = thinking on';

  return (
    <div className={'settings-panel' + (s.settingsOpen ? ' open' : '')}>
      <div className="settings-inner">
        <div className="setting-item setting-item--model">
          <div className="setting-label"><span>Model</span></div>
          <select className="setting-select" value={s.model} onChange={e => a.setModel(e.target.value)}>
            {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div className="setting-item">
          <div className="setting-label">
            <span>Max tokens</span>
            <span className="setting-val">{s.maxTokens}</span>
          </div>
          <input
            type="range" className="setting-range" min={100} max={16000} step={100}
            value={s.maxTokens} onChange={e => a.setMaxTokens(parseInt(e.target.value, 10))}
          />
        </div>
        <div className="setting-item">
          <div className="setting-label">
            <span>Temperature</span>
            <span className="setting-val">{s.temperature.toFixed(2)}</span>
          </div>
          <input
            type="range" className="setting-range" min={0} max={1} step={0.05}
            value={s.temperature} disabled={isOpus}
            onChange={e => a.setTemperature(parseFloat(e.target.value))}
          />
          <div className="setting-hint setting-hint--below">{tempHint}</div>
        </div>
        <div className="setting-item setting-item--wide">
          <div className="setting-label">
            <span>Stop sequences</span>
            <span className="setting-hint">comma-separated</span>
          </div>
          <input
            type="text" className="setting-text" placeholder="e.g. END, STOP"
            value={s.stopSequencesRaw} onChange={e => a.setStopSequences(e.target.value)}
          />
        </div>
        <div className="setting-item setting-item--strategy">
          <div className="setting-label-inline">Strategy</div>
          <div className="strategy-toggle">
            {STRATEGIES.map(st => (
              <button
                key={st.value}
                className={'strategy-btn' + (s.strategy === st.value ? ' active' : '')}
                onClick={() => a.setStrategy(st.value)}
              >
                {st.label}
              </button>
            ))}
          </div>
          {s.strategy === 'sliding-window' && (
            <div className="sw-config">
              <span className="setting-hint">Window:</span>
              <input
                type="number" className="sw-input" min={1} max={100}
                value={s.slidingWindowSize}
                onChange={e => a.setSlidingWindowSize(parseInt(e.target.value, 10))}
              />
              <span className="setting-hint">Q&amp;A pairs</span>
            </div>
          )}
        </div>
        <div className="setting-item setting-item--mcp">
          <div className="setting-label-inline">Tools</div>
          <button
            className={'mcp-toggle' + (s.mcpEnabled ? ' active' : '')}
            aria-pressed={s.mcpEnabled}
            onClick={a.toggleMcp}
          >
            <span className="mcp-toggle-dot" />
            OMDb MCP server {s.mcpEnabled ? 'on' : 'off'}
          </button>
          <div className="setting-hint setting-hint--below">
            Lets the agent search movies &amp; fetch details via the OMDb MCP server
          </div>
        </div>
      </div>
    </div>
  );
}
