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
  strategy?: string;
  slidingWindowSize?: number;
}

interface BranchData {
  id: string;
  label: string;
  createdAt: string;
  messages: Message[];
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

function strategyLabel(strategy?: string, slidingWindowSize?: number): string {
  switch (strategy) {
    case 'sliding-window': return `Sliding Window (${slidingWindowSize ?? '?'})`;
    case 'sticky-facts':   return 'Sticky Facts';
    case 'branching':      return 'Branching';
    default:               return 'default';
  }
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
  private history: Message[] = [];        // current session — displayed and saved
  private sessionId: string | null = null;
  private streaming = false;

  private strategy = 'default';
  private slidingWindowSize = 10;
  private facts: Record<string, string> = {};
  private branches: BranchData[] = [];
  private activeBranchId: string | null = null;

  // Memory layers: short-term (this dialog only, never persisted), working
  // (this task/session, persisted with the session) and long-term (global,
  // persisted across all sessions).
  private shortMemory: string[] = [];
  private workingMemory: string[] = [];
  private longTermMemory: string[] = [];

  private lastInputTokens = 0;   // input tokens from the previous request in this session
  private sessionOutputTokens = 0; // accumulated output tokens for this session

  private get apiMessages(): Message[] {
    if (this.strategy === 'sliding-window') {
      return this.history.slice(-(Math.max(1, this.slidingWindowSize) * 2));
    }
    // For branching: this.history holds only the active branch's messages,
    // so each branch talks to Claude in isolation.
    return this.history;
  }

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

  private strategyToggleEl = document.getElementById('strategyToggle') as HTMLElement;
  private slidingWindowConfigEl = document.getElementById('slidingWindowConfig') as HTMLElement;
  private slidingWindowSizeEl = document.getElementById('slidingWindowSize') as HTMLInputElement;
  private factsPanelEl = document.getElementById('factsPanel') as HTMLElement;
  private factsListEl = document.getElementById('factsList') as HTMLElement;

  private shortMemoryListEl = document.getElementById('shortMemoryList') as HTMLElement;
  private workingMemoryListEl = document.getElementById('workingMemoryList') as HTMLElement;
  private longMemoryListEl = document.getElementById('longMemoryList') as HTMLElement;

  private branchBarEl = document.getElementById('branchBar') as HTMLElement;
  private branchTabsEl = document.getElementById('branchTabs') as HTMLElement;
  private createBranchBtn = document.getElementById('createBranchBtn') as HTMLButtonElement;
  private compareBtn = document.getElementById('compareBtn') as HTMLButtonElement;
  private compareModalEl = document.getElementById('compareModal') as HTMLElement;
  private compareBodyEl = document.getElementById('compareBody') as HTMLElement;
  private compareCloseBtnEl = document.getElementById('compareCloseBtn') as HTMLButtonElement;
  private compareOverlayEl = document.getElementById('compareOverlay') as HTMLElement;

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

    this.strategyToggleEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.strategy-btn') as HTMLButtonElement | null;
      if (!btn) return;
      const clicked = btn.dataset.strategy!;
      this.strategy = this.strategy === clicked ? 'default' : clicked;
      this.updateStrategyUI();
    });

    this.updateStrategyUI();

    this.createBranchBtn.addEventListener('click', () => this.createBranch());
    this.compareBtn.addEventListener('click', () => this.openCompare());
    this.compareCloseBtnEl.addEventListener('click', () => this.closeCompare());
    this.compareOverlayEl.addEventListener('click', () => this.closeCompare());

    this.slidingWindowSizeEl.addEventListener('input', () => {
      const val = parseInt(this.slidingWindowSizeEl.value, 10);
      if (!isNaN(val) && val >= 1) this.slidingWindowSize = val;
    });

    this.initContext();
  }

  private async initContext() {
    await this.loadSessions();
    await this.loadLongTermMemory();
  }

  private async loadLongTermMemory() {
    try {
      const res = await fetch('/api/long-term-memory');
      const data = await res.json();
      this.longTermMemory = data.entries ?? [];
      this.renderMemoryPanel();
    } catch {
      // silently ignore — long-term memory unavailable
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
    this.facts = {};
    this.branches = [];
    this.activeBranchId = null;
    this.shortMemory = [];
    this.workingMemory = [];
    this.renderFacts();
    this.renderMemoryPanel();
    this.renderBranchTabs();
    this.lastInputTokens = 0;
    this.sessionOutputTokens = 0;
    this.updateSessionStats();
    this.updateStrategyUI();
    this.renderHistory();
    await this.refreshSessionList();
    this.inputEl.focus();
  }

  private updateStrategyUI() {
    this.strategyToggleEl.querySelectorAll('.strategy-btn').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.strategy === this.strategy);
    });
    this.slidingWindowConfigEl.hidden = this.strategy !== 'sliding-window';
    this.factsPanelEl.classList.toggle('visible', this.strategy === 'sticky-facts');
    const isBranching = this.strategy === 'branching';
    this.branchBarEl.classList.toggle('visible', isBranching);
  }

  private renderFacts() {
    this.factsListEl.innerHTML = '';
    const entries = Object.entries(this.facts);
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'facts-empty';
      empty.textContent = 'No facts yet';
      this.factsListEl.appendChild(empty);
      return;
    }
    for (const [key, value] of entries) {
      const item = document.createElement('div');
      item.className = 'facts-item';
      item.innerHTML = `<span class="facts-key">${escapeHtml(key)}</span><span class="facts-value">${escapeHtml(value)}</span>`;
      this.factsListEl.appendChild(item);
    }
  }

  private renderMemoryPanel() {
    this.renderMemoryList(this.shortMemoryListEl, this.shortMemory, '/short-memory', (i) => this.deleteShortMemory(i));
    this.renderMemoryList(this.workingMemoryListEl, this.workingMemory, '/work-memory', (i) => this.deleteWorkingMemory(i));
    this.renderMemoryList(this.longMemoryListEl, this.longTermMemory, '/long-memory', (i) => this.deleteLongTermMemory(i));
  }

  private renderMemoryList(listEl: HTMLElement, entries: string[], command: string, onDelete: (index: number) => void) {
    listEl.innerHTML = '';
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'memory-empty';
      empty.textContent = `Empty — try ${command} <text>`;
      listEl.appendChild(empty);
      return;
    }
    entries.forEach((entry, i) => {
      const item = document.createElement('div');
      item.className = 'memory-item';
      const text = document.createElement('span');
      text.className = 'memory-item-text';
      text.textContent = entry;
      const del = document.createElement('button');
      del.className = 'memory-item-delete';
      del.setAttribute('aria-label', 'Remove entry');
      del.textContent = '×';
      del.addEventListener('click', () => onDelete(i));
      item.appendChild(text);
      item.appendChild(del);
      listEl.appendChild(item);
    });
  }

  private deleteShortMemory(index: number) {
    this.shortMemory.splice(index, 1);
    this.renderMemoryPanel();
  }

  private deleteWorkingMemory(index: number) {
    this.workingMemory.splice(index, 1);
    this.renderMemoryPanel();
    this.saveSession();
  }

  private async deleteLongTermMemory(index: number) {
    try {
      const res = await fetch(`/api/long-term-memory/${index}`, { method: 'DELETE' });
      const data = await res.json();
      this.longTermMemory = data.entries ?? this.longTermMemory;
      this.renderMemoryPanel();
    } catch {
      // ignore
    }
  }

  private addSystemNote(text: string) {
    this.hideWelcome();
    const row = document.createElement('div');
    row.className = 'message message-system';
    row.innerHTML = `<div class="bubble bubble-system"></div>`;
    row.querySelector('.bubble')!.textContent = text;
    this.messagesEl.appendChild(row);
    this.scrollBottom();
  }

  private async handleMemoryCommand(command: string, content: string): Promise<void> {
    if (!content) {
      this.addSystemNote(`Usage: /${command} <text>`);
      return;
    }
    if (command === 'short-memory') {
      this.shortMemory.push(content);
      this.addSystemNote(`Added to short-term memory: "${content}"`);
    } else if (command === 'work-memory') {
      this.workingMemory.push(content);
      this.addSystemNote(`Added to working memory: "${content}"`);
      await this.saveSession();
    } else if (command === 'long-memory') {
      try {
        const res = await fetch('/api/long-term-memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entry: content }),
        });
        const data = await res.json();
        this.longTermMemory = data.entries ?? this.longTermMemory;
        this.addSystemNote(`Added to long-term memory: "${content}"`);
      } catch {
        this.addSystemNote('Failed to save to long-term memory');
      }
    }
    this.renderMemoryPanel();
  }

  private buildSystemPrompt(): string {
    const parts: string[] = [];

    const factsEntries = Object.entries(this.facts);
    if (this.strategy === 'sticky-facts' && factsEntries.length > 0) {
      parts.push('Key facts from this conversation:\n' + factsEntries.map(([k, v]) => `- ${k}: ${v}`).join('\n'));
    }
    if (this.shortMemory.length > 0) {
      parts.push('Short-term memory (this conversation only):\n' + this.shortMemory.map(e => `- ${e}`).join('\n'));
    }
    if (this.workingMemory.length > 0) {
      parts.push('Working memory (persists across this task):\n' + this.workingMemory.map(e => `- ${e}`).join('\n'));
    }
    if (this.longTermMemory.length > 0) {
      parts.push('Long-term memory (always remembered, across all conversations):\n' + this.longTermMemory.map(e => `- ${e}`).join('\n'));
    }

    return parts.join('\n\n');
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
        <div class="session-meta">
          <span class="session-date">${formatDate(s.updatedAt)}</span>
          <span class="session-strategy${s.strategy ? ' session-strategy--active' : ''}">${strategyLabel(s.strategy, s.slidingWindowSize)}</span>
        </div>
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
      const sessionRes = await fetch(`/api/sessions/${id}`);
      if (!sessionRes.ok) return;
      const session = await sessionRes.json();
      this.sessionId = id;
      this.strategy = session.strategy ?? 'default';
      this.slidingWindowSize = session.slidingWindowSize ?? 10;
      this.facts = session.facts ?? {};
      this.branches = session.branches ?? [];
      this.activeBranchId = session.activeBranchId ?? null;
      this.workingMemory = session.workingMemory ?? [];
      this.shortMemory = []; // short-term memory never persists across dialogs
      if (this.activeBranchId) {
        const active = this.branches.find(b => b.id === this.activeBranchId);
        this.history = active ? [...active.messages] : [...session.messages];
      } else {
        this.history = [...session.messages];
      }
      this.renderFacts();
      this.renderMemoryPanel();
      this.renderBranchTabs();
      this.updateStrategyUI();
      this.renderHistory();
      await this.refreshSessionList();
    } catch {
      // ignore
    }
  }

  private async saveSession() {
    if (this.history.length === 0 && this.branches.length === 0 && this.workingMemory.length === 0) return;
    try {
      const strategy = (this.strategy === 'none' || this.strategy === 'default') ? undefined : this.strategy;
      const slidingWindowSize = strategy === 'sliding-window' ? this.slidingWindowSize : undefined;
      const facts = strategy === 'sticky-facts' ? this.facts : undefined;
      const workingMemory = this.workingMemory.length > 0 ? this.workingMemory : undefined;

      // Keep active branch in sync before saving
      let branches: BranchData[] | undefined;
      let activeBranchId: string | undefined;
      if (strategy === 'branching' && this.branches.length > 0) {
        branches = this.branches.map(b =>
          b.id === this.activeBranchId ? { ...b, messages: this.history } : b
        );
        activeBranchId = this.activeBranchId ?? undefined;
      }

      const body = {
        messages: this.history,
        strategy,
        slidingWindowSize,
        facts,
        workingMemory,
        ...(branches && { branches, activeBranchId }),
      };

      if (this.sessionId) {
        await fetch(`/api/sessions/${this.sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
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

  private nextBranchLabel(): string {
    return String.fromCharCode(65 + this.branches.length); // A, B, C, …
  }

  private createBranch() {
    if (this.branches.length === 0) {
      // First branch: wrap current history as Branch A, create Branch B as copy
      const now = new Date().toISOString();
      const branchA: BranchData = {
        id: crypto.randomUUID(),
        label: 'Branch A',
        createdAt: now,
        messages: [...this.history],
      };
      const branchB: BranchData = {
        id: crypto.randomUUID(),
        label: 'Branch B',
        createdAt: now,
        messages: [...this.history],
      };
      this.branches = [branchA, branchB];
      this.activeBranchId = branchB.id;
    } else {
      // Sync active branch first
      if (this.activeBranchId) {
        this.branches = this.branches.map(b =>
          b.id === this.activeBranchId ? { ...b, messages: [...this.history] } : b
        );
      }
      const newBranch: BranchData = {
        id: crypto.randomUUID(),
        label: `Branch ${this.nextBranchLabel()}`,
        createdAt: new Date().toISOString(),
        messages: [...this.history],
      };
      this.branches = [...this.branches, newBranch];
      this.activeBranchId = newBranch.id;
    }
    this.renderBranchTabs();
    this.updateStrategyUI();
    this.saveSession();
  }

  private switchBranch(id: string) {
    if (id === this.activeBranchId) return;
    // Sync current history into active branch
    if (this.activeBranchId) {
      this.branches = this.branches.map(b =>
        b.id === this.activeBranchId ? { ...b, messages: [...this.history] } : b
      );
    }
    const target = this.branches.find(b => b.id === id);
    if (!target) return;
    this.activeBranchId = id;
    this.history = [...target.messages];
    this.renderBranchTabs();
    this.renderHistory();
    this.saveSession();
  }

  private renderBranchTabs() {
    this.branchTabsEl.innerHTML = '';
    for (const branch of this.branches) {
      const tab = document.createElement('button');
      tab.className = 'branch-tab' + (branch.id === this.activeBranchId ? ' active' : '');
      tab.textContent = branch.label;
      tab.addEventListener('click', () => this.switchBranch(branch.id));
      this.branchTabsEl.appendChild(tab);
    }
    this.compareBtn.hidden = this.branches.length < 2;
  }

  private openCompare() {
    this.compareBodyEl.innerHTML = '';

    // Sync active branch before comparing
    const branches = this.branches.map(b =>
      b.id === this.activeBranchId ? { ...b, messages: [...this.history] } : b
    );

    // Find fork point: longest common prefix across all branches
    let forkIdx = 0;
    const minLen = Math.min(...branches.map(b => b.messages.length));
    outer: for (let i = 0; i < minLen; i++) {
      const ref = branches[0].messages[i].content;
      const sameRole = branches[0].messages[i].role;
      for (const branch of branches.slice(1)) {
        if (branch.messages[i].content !== ref || branch.messages[i].role !== sameRole) break outer;
      }
      forkIdx = i + 1;
    }

    for (const branch of branches) {
      const col = document.createElement('div');
      col.className = 'compare-col';

      const header = document.createElement('div');
      header.className = 'compare-col-header';
      header.textContent = branch.label + (branch.id === this.activeBranchId ? ' ✦' : '');
      col.appendChild(header);

      const body = document.createElement('div');
      body.className = 'compare-col-body';

      for (let i = 0; i < branch.messages.length; i++) {
        if (i === forkIdx && forkIdx < branch.messages.length) {
          const marker = document.createElement('div');
          marker.className = 'compare-fork-marker';
          marker.textContent = '— fork point —';
          body.appendChild(marker);
        }
        const msg = branch.messages[i];
        const msgEl = document.createElement('div');
        msgEl.className = 'compare-msg';
        msgEl.innerHTML = `
          <div class="compare-msg-role ${msg.role}">${msg.role}</div>
          <div class="compare-msg-content">${escapeHtml(msg.content)}</div>
        `;
        body.appendChild(msgEl);
      }
      col.appendChild(body);
      this.compareBodyEl.appendChild(col);
    }

    this.compareModalEl.hidden = false;
  }

  private closeCompare() {
    this.compareModalEl.hidden = true;
  }

  private async send() {
    const text = this.inputEl.value.trim();
    if (!text || this.streaming) return;

    const cmdMatch = text.match(/^\/(short-memory|work-memory|long-memory)(?:\s+([\s\S]+))?$/);
    if (cmdMatch) {
      this.inputEl.value = '';
      this.inputEl.style.height = 'auto';
      this.syncSendBtn();
      await this.handleMemoryCommand(cmdMatch[1], (cmdMatch[2] ?? '').trim());
      return;
    }

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
      const system = this.buildSystemPrompt();

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: this.apiMessages,
          settings: this.getSettings(),
          ...(system && { system }),
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
      if (this.strategy === 'branching' && this.activeBranchId) {
        this.branches = this.branches.map(b =>
          b.id === this.activeBranchId ? { ...b, messages: [...this.history] } : b
        );
      }
      if (this.strategy === 'sliding-window') {
        const maxMsgs = Math.max(1, this.slidingWindowSize) * 2;
        if (this.history.length > maxMsgs) {
          this.history = this.history.slice(-maxMsgs);
        }
      }
      assistantBubble.innerHTML = renderMarkdown(accumulated);
      await this.saveSession();

      if (this.strategy === 'sticky-facts' && this.sessionId) {
        const userMsg = this.history[this.history.length - 2]?.content ?? '';
        fetch(`/api/sessions/${this.sessionId}/extract-facts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userMessage: userMsg, assistantMessage: accumulated }),
        })
          .then(r => r.json())
          .then(data => { this.facts = data.facts ?? {}; this.renderFacts(); })
          .catch(() => {});
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
