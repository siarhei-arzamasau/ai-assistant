interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface Settings {
  model: string;
  maxTokens: number;
  temperature: number;
  stopSequences: string[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderMarkdown(raw: string): string {
  let s = escapeHtml(raw);

  // Fenced code blocks
  s = s.replace(
    /```(?:\w+)?\n?([\s\S]*?)```/g,
    (_, code) => `<pre><code>${code.trimEnd()}</code></pre>`,
  );

  // Inline code
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Bold
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Newlines outside pre blocks
  const segments = s.split(/(<pre>[\s\S]*?<\/pre>)/g);
  s = segments
    .map((seg, i) => (i % 2 === 0 ? seg.replace(/\n/g, '<br>') : seg))
    .join('');

  return s;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

class Chat {
  private contextSummary = ''; // system prompt built from summaries of previous sessions
  private history: Message[] = [];        // current session — displayed and saved
  private sessionId: string | null = null;
  private streaming = false;

  private lastInputTokens = 0;   // input tokens from the previous request in this session
  private sessionOutputTokens = 0; // accumulated output tokens for this session

  private messagesEl = document.getElementById('messages') as HTMLDivElement;
  private welcomeEl = document.getElementById('welcome') as HTMLDivElement;
  private inputEl = document.getElementById('userInput') as HTMLTextAreaElement;
  private sendBtn = document.getElementById('sendBtn') as HTMLButtonElement;
  private clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;

  private settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
  private settingsPanel = document.getElementById('settingsPanel') as HTMLDivElement;
  private modelEl = document.getElementById('modelSelect') as HTMLSelectElement;
  private maxTokensEl = document.getElementById('maxTokens') as HTMLInputElement;
  private maxTokensValEl = document.getElementById('maxTokensVal') as HTMLSpanElement;
  private temperatureEl = document.getElementById('temperature') as HTMLInputElement;
  private tempValEl = document.getElementById('tempVal') as HTMLSpanElement;
  private tempHintEl = document.getElementById('tempHint') as HTMLDivElement;
  private stopSeqsEl = document.getElementById('stopSeqs') as HTMLInputElement;

  private sidebarEl = document.getElementById('sidebar') as HTMLElement;
  private sessionListEl = document.getElementById('sessionList') as HTMLElement;
  private sidebarToggleBtn = document.getElementById('sidebarToggleBtn') as HTMLButtonElement;
  private sessionStatsEl = document.getElementById('sessionStats') as HTMLElement;

  constructor() {
    this.sendBtn.addEventListener('click', () => this.send());
    this.clearBtn.addEventListener('click', () => this.newChat());

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!this.sendBtn.disabled) this.send();
      }
    });

    this.inputEl.addEventListener('input', () => {
      this.autoResize();
      this.syncSendBtn();
    });

    this.settingsBtn.addEventListener('click', () => this.toggleSettings());
    this.modelEl.addEventListener('change', () => this.onModelChange());

    this.maxTokensEl.addEventListener('input', () => {
      this.maxTokensValEl.textContent = this.maxTokensEl.value;
    });

    this.temperatureEl.addEventListener('input', () => {
      this.tempValEl.textContent = parseFloat(this.temperatureEl.value).toFixed(2);
    });

    this.sidebarToggleBtn.addEventListener('click', () => this.toggleSidebar());

    this.initContext();
  }

  private async initContext() {
    await this.loadContext();
    await this.loadSessions();
  }

  private async loadContext(excludeId?: string) {
    try {
      const url = excludeId ? `/api/history?exclude=${excludeId}` : '/api/history';
      const res = await fetch(url);
      const data = await res.json();
      this.contextSummary = data.system ?? '';
    } catch {
      this.contextSummary = '';
    }
  }

  private toggleSidebar() {
    const collapsed = this.sidebarEl.classList.toggle('collapsed');
    this.sidebarToggleBtn.setAttribute('aria-expanded', String(!collapsed));
  }

  private toggleSettings() {
    const open = this.settingsPanel.classList.toggle('open');
    this.settingsBtn.classList.toggle('active', open);
    this.settingsBtn.setAttribute('aria-expanded', String(open));
  }

  private onModelChange() {
    const model = this.modelEl.value;
    const isOpus  = model === 'claude-opus-4-8';
    const isHaiku = model === 'claude-haiku-4-5-20251001';

    this.temperatureEl.disabled = isOpus;
    if (isOpus) {
      this.temperatureEl.value = '1';
      this.tempValEl.textContent = '1.00';
      this.tempHintEl.textContent = 'n/a — temperature not supported';
    } else if (isHaiku) {
      this.tempHintEl.textContent = 'thinking not available on Haiku';
    } else {
      this.tempHintEl.textContent = '1.0 = thinking on';
    }
  }

  private getSettings(): Settings {
    return {
      model: this.modelEl.value,
      maxTokens: parseInt(this.maxTokensEl.value, 10),
      temperature: parseFloat(this.temperatureEl.value),
      stopSequences: this.stopSeqsEl.value
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0),
    };
  }

  private autoResize() {
    this.inputEl.style.height = 'auto';
    this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 200) + 'px';
  }

  private syncSendBtn() {
    this.sendBtn.disabled = this.streaming || !this.inputEl.value.trim();
  }

  private setStreaming(on: boolean) {
    this.streaming = on;
    this.inputEl.disabled = on;
    this.syncSendBtn();
  }

  private async newChat() {
    this.sessionId = null;
    this.history = [];
    this.lastInputTokens = 0;
    this.sessionOutputTokens = 0;
    this.updateSessionStats();
    await this.loadContext(); // reload — now picks up the just-generated summary
    this.renderHistory();
    await this.refreshSessionList();
    this.inputEl.focus();
  }

  private updateSessionStats() {
    if (this.lastInputTokens === 0 && this.sessionOutputTokens === 0) {
      this.sessionStatsEl.hidden = true;
      return;
    }
    this.sessionStatsEl.hidden = false;
    this.sessionStatsEl.textContent =
      `Session: ${this.sessionOutputTokens.toLocaleString()} out total · ${this.lastInputTokens.toLocaleString()} ctx`;
  }

  private renderHistory() {
    this.messagesEl.innerHTML = '';
    if (this.history.length === 0) {
      const welcome = document.createElement('div');
      welcome.id = 'welcome';
      welcome.className = 'welcome';
      welcome.innerHTML = `
        <div class="welcome-glyph">&#9670;</div>
        <h1>How can I help you today?</h1>
        <p>Powered by Claude via the Anthropic API</p>
      `;
      this.messagesEl.appendChild(welcome);
      this.welcomeEl = welcome;
      return;
    }
    for (const msg of this.history) {
      const bubble = this.addBubble(msg.role, false);
      if (msg.role === 'user') {
        bubble.textContent = msg.content;
      } else {
        bubble.innerHTML = renderMarkdown(msg.content);
      }
    }
    this.scrollBottom();
  }

  private hideWelcome() {
    this.welcomeEl?.remove();
  }

  private addBubble(role: 'user' | 'assistant', scroll = true): HTMLElement {
    this.hideWelcome();

    const row = document.createElement('div');
    row.className = `message message-${role}`;

    if (role === 'assistant') {
      row.innerHTML = `
        <div class="avatar avatar-assistant">&#9670;</div>
        <div class="bubble bubble-assistant"></div>
      `;
    } else {
      row.innerHTML = `<div class="bubble bubble-user"></div>`;
    }

    this.messagesEl.appendChild(row);
    if (scroll) this.scrollBottom();
    return row.querySelector('.bubble') as HTMLElement;
  }

  private scrollBottom() {
    const main = document.querySelector('.main') as HTMLElement;
    main.scrollTop = main.scrollHeight;
  }

  private async loadSessions() {
    try {
      const res = await fetch('/api/sessions');
      const sessions: SessionMeta[] = await res.json();
      this.renderSessionList(sessions);
    } catch {
      // silently ignore — history unavailable
    }
  }

  private async refreshSessionList() {
    await this.loadSessions();
  }

  private renderSessionList(sessions: SessionMeta[]) {
    this.sessionListEl.innerHTML = '';

    if (sessions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'session-empty';
      empty.textContent = 'No history yet';
      this.sessionListEl.appendChild(empty);
      return;
    }

    for (const s of sessions) {
      const item = document.createElement('div');
      item.className = 'session-item' + (s.id === this.sessionId ? ' active' : '');

      const info = document.createElement('div');
      info.className = 'session-info';
      info.innerHTML = `
        <div class="session-title">${escapeHtml(s.title)}</div>
        <div class="session-date">${formatDate(s.updatedAt)}</div>
      `;
      info.addEventListener('click', () => this.openSession(s.id));

      const del = document.createElement('button');
      del.className = 'session-delete';
      del.setAttribute('aria-label', 'Delete session');
      del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteSession(s.id);
      });

      item.appendChild(info);
      item.appendChild(del);
      this.sessionListEl.appendChild(item);
    }
  }

  private async openSession(id: string) {
    try {
      const [sessionRes] = await Promise.all([
        fetch(`/api/sessions/${id}`),
        this.loadContext(id), // load all sessions except this one as background context
      ]);
      if (!sessionRes.ok) return;
      const session = await sessionRes.json();
      this.sessionId = id;
      this.history = session.messages;
      this.renderHistory();
      await this.refreshSessionList();
    } catch {
      // ignore
    }
  }

  private async saveSession() {
    if (this.history.length === 0) return;
    try {
      if (this.sessionId) {
        await fetch(`/api/sessions/${this.sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: this.history }),
        });
      } else {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: this.history }),
        });
        const data = await res.json();
        this.sessionId = data.id;
      }
      await this.refreshSessionList();
    } catch {
      // ignore — save failure is non-fatal
    }
  }

  private async deleteSession(id: string) {
    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (this.sessionId === id) {
        this.sessionId = null;
        this.history = [];
        this.renderHistory();
      }
      await this.refreshSessionList();
    } catch {
      // ignore
    }
  }

  private async send() {
    const text = this.inputEl.value.trim();
    if (!text || this.streaming) return;

    this.history.push({ role: 'user', content: text });
    const userBubble = this.addBubble('user');
    userBubble.textContent = text;

    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
    this.setStreaming(true);

    const assistantBubble = this.addBubble('assistant');
    assistantBubble.classList.add('streaming');

    let accumulated = '';
    let usage: { input: number; output: number } | null = null;
    const startTime = Date.now();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: this.history,
          settings: this.getSettings(),
          ...(this.contextSummary && { system: this.contextSummary }),
        }),
      });

      if (!res.ok) {
        throw new Error(`Server error ${res.status}: ${await res.text()}`);
      }
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') continue;

          let parsed: { text?: string; error?: string; thinking?: boolean; usage?: { input: number; output: number } };
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }

          if (parsed.error) throw new Error(parsed.error);
          if (parsed.usage) usage = parsed.usage;

          if (parsed.thinking === true && !accumulated) {
            assistantBubble.setAttribute('data-thinking', '1');
          }
          if (parsed.thinking === false) {
            assistantBubble.removeAttribute('data-thinking');
          }

          if (parsed.text) {
            assistantBubble.removeAttribute('data-thinking');
            accumulated += parsed.text;
            assistantBubble.textContent = accumulated;
            this.scrollBottom();
          }
        }
      }

      this.history.push({ role: 'assistant', content: accumulated });
      assistantBubble.innerHTML = renderMarkdown(accumulated);
      await this.saveSession();
      if (this.sessionId && (this.history.length / 2) % 3 === 0) {
        fetch(`/api/sessions/${this.sessionId}/summarize`, { method: 'POST' }).catch(() => {});
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected error';
      assistantBubble.textContent = msg;
      assistantBubble.classList.add('error');
      this.history.pop(); // remove user message that failed
    } finally {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      const timeEl = document.createElement('div');
      timeEl.className = 'bubble-time';
      if (usage) {
        const reqIn = usage.input - this.lastInputTokens;
        this.lastInputTokens = usage.input;
        this.sessionOutputTokens += usage.output;
        this.updateSessionStats();
        timeEl.textContent =
          `${elapsed}s · req: ${reqIn.toLocaleString()} in / ${usage.output.toLocaleString()} out · ctx: ${usage.input.toLocaleString()} total`;
      } else {
        timeEl.textContent = `${elapsed}s`;
      }
      assistantBubble.appendChild(timeEl);

      assistantBubble.classList.remove('streaming');
      this.setStreaming(false);
      this.inputEl.focus();
    }
  }
}

new Chat();
