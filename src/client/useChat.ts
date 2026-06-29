import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActiveTask, BranchData, CompareColumn, DisplayItem, Message, Profile,
  SessionMeta, Settings, TaskStage,
} from './types';
import { COMMAND_REGEX, COMMANDS, TASK_STAGES, TASK_STAGE_LABELS } from './constants';

export interface Store {
  sessions: SessionMeta[];
  sessionId: string | null;
  history: Message[];          // current conversation — sent to the API and persisted
  transcript: DisplayItem[];   // what is rendered (messages + local system notes)
  streaming: boolean;
  streamController: AbortController | null;
  liveId: string | null;       // id of the in-flight assistant item in the transcript

  strategy: string;
  slidingWindowSize: number;
  facts: Record<string, string>;
  branches: BranchData[];
  activeBranchId: string | null;

  shortMemory: string[];
  workingMemory: string[];
  longTermMemory: string[];

  profiles: Profile[];
  activeProfileId: string | null;
  invariants: string[];

  activeTask: ActiveTask | null;

  lastInputTokens: number;
  sessionOutputTokens: number;

  // settings
  model: string;
  maxTokens: number;
  temperature: number;
  stopSequencesRaw: string;
  mcpEnabled: boolean;         // expose the OMDb MCP server's tools to the agent

  // UI
  sidebarCollapsed: boolean;
  settingsOpen: boolean;
  memoryCollapsed: boolean;
  profilesCollapsed: boolean;
  invariantsCollapsed: boolean;
  compare: CompareColumn[] | null;
}

function initialStore(): Store {
  return {
    sessions: [],
    sessionId: null,
    history: [],
    transcript: [],
    streaming: false,
    streamController: null,
    liveId: null,
    strategy: 'default',
    slidingWindowSize: 10,
    facts: {},
    branches: [],
    activeBranchId: null,
    shortMemory: [],
    workingMemory: [],
    longTermMemory: [],
    profiles: [],
    activeProfileId: null,
    invariants: [],
    activeTask: null,
    lastInputTokens: 0,
    sessionOutputTokens: 0,
    model: 'claude-sonnet-4-6',
    maxTokens: 16000,
    temperature: 1,
    stopSequencesRaw: '',
    mcpEnabled: false,
    sidebarCollapsed: false,
    settingsOpen: false,
    memoryCollapsed: false,
    profilesCollapsed: false,
    invariantsCollapsed: false,
    compare: null,
  };
}

const uid = () => crypto.randomUUID();

export interface ChatActions {
  init(): void;
  // UI toggles
  toggleSidebar(): void;
  toggleSettings(): void;
  togglePanel(panel: 'memory' | 'profiles' | 'invariants'): void;
  // settings
  setModel(model: string): void;
  setMaxTokens(n: number): void;
  setTemperature(n: number): void;
  setStopSequences(raw: string): void;
  setSlidingWindowSize(n: number): void;
  setStrategy(strategy: string): void;
  toggleMcp(): void;
  // sessions
  newChat(): void;
  openSession(id: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  // memory / profiles / invariants
  deleteShortMemory(i: number): void;
  deleteWorkingMemory(i: number): void;
  deleteLongTermMemory(i: number): Promise<void>;
  deleteInvariant(i: number): Promise<void>;
  switchProfile(id: string): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  // branches
  createBranch(): void;
  switchBranch(id: string): void;
  openCompare(): void;
  closeCompare(): void;
  // tasks
  stopTask(): void;
  // messaging
  send(text: string): Promise<void>;
  stopStreaming(): void;
}

export function useChat(): { s: Store; a: ChatActions } {
  const storeRef = useRef<Store>(initialStore());
  const [, setVersion] = useState(0);

  const actions = useMemo<ChatActions>(() => {
    const s = () => storeRef.current;
    const render = () => setVersion(v => v + 1);

    // ---- transcript helpers -------------------------------------------------
    function addSystemNote(text: string, opts: { align?: 'left' | 'center'; mono?: boolean } = {}) {
      s().transcript.push({ kind: 'system', id: uid(), text, align: opts.align, mono: opts.mono });
      render();
    }

    function setTranscriptFromHistory() {
      s().transcript = s().history.map<DisplayItem>(m => ({
        kind: 'message', id: uid(), role: m.role, content: m.content,
      }));
    }

    // ---- loaders ------------------------------------------------------------
    async function loadSessions() {
      try {
        const res = await fetch('/api/sessions');
        s().sessions = await res.json();
        render();
      } catch { /* history unavailable */ }
    }

    async function loadLongTermMemory() {
      try {
        const res = await fetch('/api/long-term-memory');
        const data = await res.json();
        s().longTermMemory = data.entries ?? [];
        render();
      } catch { /* unavailable */ }
    }

    async function loadProfiles() {
      try {
        const res = await fetch('/api/profiles');
        const data = await res.json();
        s().profiles = data.profiles ?? [];
        s().activeProfileId = data.activeProfileId ?? null;
        render();
      } catch { /* unavailable */ }
    }

    async function loadInvariants() {
      try {
        const res = await fetch('/api/invariants');
        const data = await res.json();
        s().invariants = data.entries ?? [];
        render();
      } catch { /* unavailable */ }
    }

    // ---- settings / api -----------------------------------------------------
    function buildSettings(): Settings {
      const st = s();
      return {
        model: st.model,
        maxTokens: st.maxTokens,
        temperature: st.temperature,
        stopSequences: st.stopSequencesRaw.split(',').map(x => x.trim()).filter(x => x.length > 0),
      };
    }

    function apiMessages(): Message[] {
      const st = s();
      if (st.strategy === 'sliding-window') {
        return st.history.slice(-(Math.max(1, st.slidingWindowSize) * 2));
      }
      return st.history;
    }

    function buildSystemPrompt(): string {
      const st = s();
      const parts: string[] = [];

      if (st.invariants.length > 0) {
        parts.push(
          'INVARIANTS — hard constraints that must hold at all times, across this entire conversation:\n' +
          st.invariants.map(e => `- ${e}`).join('\n') +
          '\n\nBefore answering, explicitly check your reasoning and any proposed solution against every invariant above. ' +
          'If a solution would violate one or more invariants, do not propose it — state which invariant it violates and propose an alternative that satisfies all of them instead.'
        );
      }

      const activeProfile = st.profiles.find(p => p.id === st.activeProfileId);
      if (activeProfile) {
        parts.push(`User profile "${activeProfile.name}" — follow this style, format and constraints for all responses:\n${activeProfile.definition}`);
      }

      const factsEntries = Object.entries(st.facts);
      if (st.strategy === 'sticky-facts' && factsEntries.length > 0) {
        parts.push('Key facts from this conversation:\n' + factsEntries.map(([k, v]) => `- ${k}: ${v}`).join('\n'));
      }
      if (st.shortMemory.length > 0) {
        parts.push('Short-term memory (this conversation only):\n' + st.shortMemory.map(e => `- ${e}`).join('\n'));
      }
      if (st.workingMemory.length > 0) {
        parts.push('Working memory (persists across this task):\n' + st.workingMemory.map(e => `- ${e}`).join('\n'));
      }
      if (st.longTermMemory.length > 0) {
        parts.push('Long-term memory (always remembered, across all conversations):\n' + st.longTermMemory.map(e => `- ${e}`).join('\n'));
      }

      return parts.join('\n\n');
    }

    // ---- persistence --------------------------------------------------------
    async function saveSession() {
      const st = s();
      if (st.history.length === 0 && st.branches.length === 0 && st.workingMemory.length === 0) return;
      try {
        const strategy = (st.strategy === 'none' || st.strategy === 'default') ? undefined : st.strategy;
        const slidingWindowSize = strategy === 'sliding-window' ? st.slidingWindowSize : undefined;
        const facts = strategy === 'sticky-facts' ? st.facts : undefined;
        const workingMemory = st.workingMemory.length > 0 ? st.workingMemory : undefined;

        let branches: BranchData[] | undefined;
        let activeBranchId: string | undefined;
        if (strategy === 'branching' && st.branches.length > 0) {
          branches = st.branches.map(b => b.id === st.activeBranchId ? { ...b, messages: st.history } : b);
          activeBranchId = st.activeBranchId ?? undefined;
        }

        const body = {
          messages: st.history, strategy, slidingWindowSize, facts, workingMemory,
          ...(branches && { branches, activeBranchId }),
        };

        if (st.sessionId) {
          await fetch(`/api/sessions/${st.sessionId}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
        } else {
          const res = await fetch('/api/sessions', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
          const data = await res.json();
          st.sessionId = data.id;
        }
        await loadSessions();
      } catch { /* save failure is non-fatal */ }
    }

    // ---- conversation core --------------------------------------------------
    function commitAssistantMessage(content: string) {
      const st = s();
      st.history.push({ role: 'assistant', content });
      if (st.strategy === 'branching' && st.activeBranchId) {
        st.branches = st.branches.map(b => b.id === st.activeBranchId ? { ...b, messages: [...st.history] } : b);
      }
      if (st.strategy === 'sliding-window') {
        const maxMsgs = Math.max(1, st.slidingWindowSize) * 2;
        if (st.history.length > maxMsgs) st.history = st.history.slice(-maxMsgs);
      }
    }

    async function sendMessage(text: string, opts: { stageLabel?: string; extraSystem?: string } = {}): Promise<string> {
      const st = s();
      st.history.push({ role: 'user', content: text });
      st.transcript.push({ kind: 'message', id: uid(), role: 'user', content: text });

      const liveId = uid();
      const live: Extract<DisplayItem, { kind: 'message' }> = {
        kind: 'message', id: liveId, role: 'assistant', content: '', streaming: true, stageLabel: opts.stageLabel,
      };
      st.transcript.push(live);
      st.liveId = liveId;
      st.streaming = true;
      const controller = new AbortController();
      st.streamController = controller;
      render();

      let accumulated = '';
      let usage: { input: number; output: number } | null = null;
      let interrupted = false;
      const startTime = Date.now();

      try {
        const baseSystem = buildSystemPrompt();
        const system = opts.extraSystem ? [baseSystem, opts.extraSystem].filter(Boolean).join('\n\n') : baseSystem;

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: apiMessages(), settings: buildSettings(), useTools: st.mcpEnabled, ...(system && { system }) }),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error(`Server error ${res.status}: ${await res.text()}`);
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

            let parsed: {
              text?: string; error?: string; thinking?: boolean;
              usage?: { input: number; output: number };
              tool_use?: { id: string; name: string; input: unknown };
              tool_result?: { id: string; name: string; content: string; isError: boolean };
            };
            try { parsed = JSON.parse(payload); } catch { continue; }

            if (parsed.error) throw new Error(parsed.error);
            if (parsed.usage) usage = parsed.usage;
            if (parsed.thinking === true && !accumulated) { live.thinking = true; render(); }
            if (parsed.thinking === false) { live.thinking = false; render(); }
            if (parsed.tool_use) {
              // Show the tool call as its own row, just above the live answer bubble.
              const tu = parsed.tool_use;
              const liveIdx = st.transcript.indexOf(live);
              const insertAt = liveIdx === -1 ? st.transcript.length : liveIdx;
              st.transcript.splice(insertAt, 0, {
                kind: 'tool', id: tu.id, name: tu.name, input: tu.input, status: 'running',
              });
              live.thinking = false;
              render();
            }
            if (parsed.tool_result) {
              const tr = parsed.tool_result;
              const item = st.transcript.find(i => i.kind === 'tool' && i.id === tr.id);
              if (item && item.kind === 'tool') {
                item.status = tr.isError ? 'error' : 'done';
                item.result = tr.content;
              }
              render();
            }
            if (parsed.text) {
              live.thinking = false;
              accumulated += parsed.text;
              live.content = accumulated;
              render();
            }
          }
        }

        commitAssistantMessage(accumulated);
        live.content = accumulated;
        live.streaming = false;
        await saveSession();

        if (st.strategy === 'sticky-facts' && st.sessionId) {
          const userMsg = st.history[st.history.length - 2]?.content ?? '';
          fetch(`/api/sessions/${st.sessionId}/extract-facts`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userMessage: userMsg, assistantMessage: accumulated }),
          })
            .then(r => r.json())
            .then(data => { st.facts = data.facts ?? {}; render(); })
            .catch(() => {});
        }
      } catch (err) {
        const isAbort = controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError');
        if (isAbort) {
          interrupted = true;
          if (accumulated) {
            commitAssistantMessage(accumulated);
            live.content = accumulated;
            await saveSession();
          } else {
            st.history.pop();
            live.content = '';
          }
          live.interrupted = true;
          live.streaming = false;
        } else {
          live.content = err instanceof Error ? err.message : 'Unexpected error';
          live.error = true;
          live.streaming = false;
          st.history.pop();
          accumulated = '';
        }
      } finally {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        if (usage) {
          const reqIn = usage.input - st.lastInputTokens;
          st.lastInputTokens = usage.input;
          st.sessionOutputTokens += usage.output;
          live.time = `${elapsed}s · req: ${reqIn.toLocaleString()} in / ${usage.output.toLocaleString()} out · ctx: ${usage.input.toLocaleString()} total`;
        } else {
          live.time = `${elapsed}s`;
        }
        live.streaming = false;
        void interrupted;
        st.streaming = false;
        st.streamController = null;
        st.liveId = null;
        render();
      }

      return accumulated;
    }

    // ---- task FSM -----------------------------------------------------------
    function isApproval(text: string): boolean {
      return /^(да|ок|окей|хорошо|подходит|годится|норм|approve(?:d)?|ok(?:ay)?|good|great|fine|works|sounds good|looks good|go ahead|proceed|next|continue|yes)(?=[\s,.!?:;]|$)/i.test(text.trim());
    }

    function isStopWord(text: string): boolean {
      return /^(стоп|стой|отмена|отмени|отменить|прекрати|прекратить|хватит|stop|cancel|abort|quit|halt)(?=[\s,.!?:;]|$)/i.test(text.trim());
    }

    function buildStageInstructions(task: ActiveTask, stage: TaskStage, feedback?: string): string {
      const idx = TASK_STAGES.indexOf(stage) + 1;
      const lines = [`Task workflow stage ${idx}/4: ${TASK_STAGE_LABELS[stage].toUpperCase()}.\nTask: "${task.description}"`];

      if (task.outputs.planning && stage !== 'planning') lines.push(`Plan (stage 1 — planning):\n${task.outputs.planning}`);
      if (task.outputs.execution && (stage === 'validation' || stage === 'done')) lines.push(`Deliverable (stage 2 — execution):\n${task.outputs.execution}`);
      if (task.outputs.validation && stage === 'done') lines.push(`Validation review (stage 3 — validation):\n${task.outputs.validation}`);

      if (feedback) {
        const previous = stage === 'done' ? '' : task.outputs[stage] ?? '';
        lines.push(`The user reviewed your previous response for this stage and requested changes:\n"${feedback}"\n\nPrevious response for this stage:\n${previous}\n\nRevise your response for this stage accordingly.`);
      } else {
        switch (stage) {
          case 'planning': lines.push('Produce a concise plan: break the task into concrete steps, the approach you will take, and what "done" should look like. Do not execute the task yet — only plan it.'); break;
          case 'execution': lines.push('Execute the approved plan and produce the actual deliverable for the task.'); break;
          case 'validation': lines.push('Critically validate the deliverable against the task and the plan. List concrete gaps, errors or missing pieces, or state explicitly that it fully satisfies the task.'); break;
          case 'done': lines.push('The user approved the validation. Provide the final, consolidated deliverable for the task as your closing response.'); break;
        }
      }
      return lines.join('\n\n');
    }

    async function runTaskStage(userText: string, feedback?: string) {
      const task = s().activeTask;
      if (!task) return;
      const stage = task.state;
      const stageLabel = `Stage ${TASK_STAGES.indexOf(stage) + 1}/4 · ${TASK_STAGE_LABELS[stage]}`;
      const extraSystem = buildStageInstructions(task, stage, feedback);
      const output = await sendMessage(userText, { stageLabel, extraSystem });
      if (!output) return; // request failed — stay on the current stage
      if (stage !== 'done') task.outputs[stage] = output;
      render();
    }

    async function handleTaskCommand(description: string) {
      if (!description) { addSystemNote('Usage: /task <description>'); return; }
      s().activeTask = { description, state: 'planning', outputs: {} };
      render();
      await runTaskStage(description);
    }

    async function handleTaskResponse(text: string) {
      const task = s().activeTask;
      if (!task) return;
      if (isStopWord(text)) { stopTask(); return; }
      if (isApproval(text)) {
        task.state = TASK_STAGES[TASK_STAGES.indexOf(task.state) + 1];
        render();
        await runTaskStage(text);
      } else {
        await runTaskStage(text, text);
      }
    }

    function stopTask() {
      const task = s().activeTask;
      if (!task) return;
      const stageLabel = TASK_STAGE_LABELS[task.state];
      const desc = task.description;
      s().activeTask = null;
      render();
      addSystemNote(`Task stopped at the ${stageLabel} stage: "${desc}". Back to a normal conversation.`);
    }

    // ---- slash commands -----------------------------------------------------
    function handleHelpCommand() {
      const width = Math.max(...COMMANDS.map(c => c.usage.length));
      const lines = COMMANDS.map(c => `${c.usage.padEnd(width)}  —  ${c.description}`);
      addSystemNote(`Available commands:\n\n${lines.join('\n')}`, { align: 'left', mono: true });
    }

    async function handleMemoryCommand(command: string, content: string) {
      if (!content) { addSystemNote(`Usage: /${command} <text>`); return; }
      const st = s();
      if (command === 'short-memory') {
        st.shortMemory.push(content);
        addSystemNote(`Added to short-term memory: "${content}"`);
      } else if (command === 'work-memory') {
        st.workingMemory.push(content);
        addSystemNote(`Added to working memory: "${content}"`);
        await saveSession();
      } else if (command === 'long-memory') {
        try {
          const res = await fetch('/api/long-term-memory', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry: content }),
          });
          const data = await res.json();
          st.longTermMemory = data.entries ?? st.longTermMemory;
          addSystemNote(`Added to long-term memory: "${content}"`);
        } catch { addSystemNote('Failed to save to long-term memory'); }
      }
      render();
    }

    async function handleInvariantCommand(command: string, content: string) {
      const st = s();
      if (command === 'invariants') {
        if (st.invariants.length === 0) addSystemNote('No invariants defined. Use /add-invariant <text>.');
        else addSystemNote('Invariants:\n' + st.invariants.map((e, i) => `${i + 1}. ${e}`).join('\n'));
        return;
      }
      if (!content) { addSystemNote('Usage: /add-invariant <text>'); return; }
      try {
        const res = await fetch('/api/invariants', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry: content }),
        });
        const data = await res.json();
        st.invariants = data.entries ?? st.invariants;
        addSystemNote(`Added invariant: "${content}"`);
      } catch { addSystemNote('Failed to save invariant'); }
      render();
    }

    async function switchProfile(id: string) {
      const st = s();
      if (id === st.activeProfileId) return;
      try {
        const res = await fetch('/api/profiles/active', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
        });
        const data = await res.json();
        st.profiles = data.profiles ?? st.profiles;
        st.activeProfileId = data.activeProfileId ?? null;
        render();
      } catch { /* ignore */ }
    }

    async function handleProfileCommand(command: string, content: string) {
      const st = s();
      if (command === 'create-profile') {
        const spaceIdx = content.indexOf(' ');
        const name = spaceIdx === -1 ? '' : content.slice(0, spaceIdx).trim();
        const definition = spaceIdx === -1 ? '' : content.slice(spaceIdx + 1).trim();
        if (!name || !definition) { addSystemNote('Usage: /create-profile <name> <definition>'); return; }
        try {
          const res = await fetch('/api/profiles', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, definition }),
          });
          const data = await res.json();
          st.profiles = data.profiles ?? st.profiles;
          st.activeProfileId = data.activeProfileId ?? null;
          addSystemNote(`Created and activated profile "${name}": ${definition}`);
        } catch { addSystemNote('Failed to create profile'); }
      } else if (command === 'profile') {
        const active = st.profiles.find(p => p.id === st.activeProfileId);
        if (!active) addSystemNote('No active profile. Use /create-profile <name> <definition>.');
        else addSystemNote(`Active profile "${active.name}": ${active.definition}`);
      } else if (command === 'switch-profile') {
        const names = st.profiles.map(p => p.name).join(', ') || 'none';
        if (!content) { addSystemNote(`Usage: /switch-profile <name>. Available: ${names}`); return; }
        const target = st.profiles.find(p => p.name.toLowerCase() === content.toLowerCase());
        if (!target) { addSystemNote(`Profile "${content}" not found. Available: ${names}`); return; }
        await switchProfile(target.id);
        addSystemNote(`Switched to profile "${target.name}"`);
      }
      render();
    }

    // ---- branches -----------------------------------------------------------
    function nextBranchLabel() { return String.fromCharCode(65 + s().branches.length); }

    function createBranch() {
      const st = s();
      if (st.branches.length === 0) {
        const now = new Date().toISOString();
        const branchA: BranchData = { id: uid(), label: 'Branch A', createdAt: now, messages: [...st.history] };
        const branchB: BranchData = { id: uid(), label: 'Branch B', createdAt: now, messages: [...st.history] };
        st.branches = [branchA, branchB];
        st.activeBranchId = branchB.id;
      } else {
        if (st.activeBranchId) {
          st.branches = st.branches.map(b => b.id === st.activeBranchId ? { ...b, messages: [...st.history] } : b);
        }
        const newBranch: BranchData = { id: uid(), label: `Branch ${nextBranchLabel()}`, createdAt: new Date().toISOString(), messages: [...st.history] };
        st.branches = [...st.branches, newBranch];
        st.activeBranchId = newBranch.id;
      }
      render();
      void saveSession();
    }

    function switchBranch(id: string) {
      const st = s();
      if (id === st.activeBranchId) return;
      if (st.activeBranchId) {
        st.branches = st.branches.map(b => b.id === st.activeBranchId ? { ...b, messages: [...st.history] } : b);
      }
      const target = st.branches.find(b => b.id === id);
      if (!target) return;
      st.activeBranchId = id;
      st.history = [...target.messages];
      setTranscriptFromHistory();
      render();
      void saveSession();
    }

    function openCompare() {
      const st = s();
      const branches = st.branches.map(b => b.id === st.activeBranchId ? { ...b, messages: [...st.history] } : b);

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

      st.compare = branches.map<CompareColumn>(b => ({
        label: b.label, active: b.id === st.activeBranchId, messages: b.messages, forkIdx,
      }));
      render();
    }

    function closeCompare() { s().compare = null; render(); }

    // ---- sessions -----------------------------------------------------------
    async function openSession(id: string) {
      try {
        const res = await fetch(`/api/sessions/${id}`);
        if (!res.ok) return;
        const session = await res.json();
        const st = s();
        st.sessionId = id;
        st.strategy = session.strategy ?? 'default';
        st.slidingWindowSize = session.slidingWindowSize ?? 10;
        st.facts = session.facts ?? {};
        st.branches = session.branches ?? [];
        st.activeBranchId = session.activeBranchId ?? null;
        st.workingMemory = session.workingMemory ?? [];
        st.shortMemory = [];      // short-term memory never persists across dialogs
        st.activeTask = null;     // task FSM is ephemeral, never persisted
        if (st.activeBranchId) {
          const active = st.branches.find(b => b.id === st.activeBranchId);
          st.history = active ? [...active.messages] : [...session.messages];
        } else {
          st.history = [...session.messages];
        }
        setTranscriptFromHistory();
        render();
        await loadSessions();
      } catch { /* ignore */ }
    }

    async function deleteSession(id: string) {
      try {
        await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
        const st = s();
        if (st.sessionId === id) {
          st.sessionId = null;
          st.history = [];
          setTranscriptFromHistory();
        }
        render();
        await loadSessions();
      } catch { /* ignore */ }
    }

    function newChat() {
      const st = s();
      st.sessionId = null;
      st.history = [];
      st.transcript = [];
      st.facts = {};
      st.branches = [];
      st.activeBranchId = null;
      st.shortMemory = [];
      st.workingMemory = [];
      st.activeTask = null;
      st.lastInputTokens = 0;
      st.sessionOutputTokens = 0;
      render();
      void loadSessions();
    }

    // ---- send dispatcher ----------------------------------------------------
    async function send(text: string) {
      text = text.trim();
      if (!text || s().streaming) return;

      const cmdMatch = COMMAND_REGEX.exec(text);
      if (cmdMatch) {
        const command = cmdMatch[1];
        const content = (cmdMatch[2] ?? '').trim();
        if (command === 'help') handleHelpCommand();
        else if (command === 'create-profile' || command === 'profile' || command === 'switch-profile') await handleProfileCommand(command, content);
        else if (command === 'task') await handleTaskCommand(content);
        else if (command === 'add-invariant' || command === 'invariants') await handleInvariantCommand(command, content);
        else await handleMemoryCommand(command, content);
        return;
      }

      const task = s().activeTask;
      if (task && task.state !== 'done') { await handleTaskResponse(text); return; }
      await sendMessage(text);
    }

    function stopStreaming() { s().streamController?.abort(); }

    // ---- simple setters / toggles ------------------------------------------
    return {
      init() { void loadSessions(); void loadLongTermMemory(); void loadProfiles(); void loadInvariants(); },
      toggleSidebar() { s().sidebarCollapsed = !s().sidebarCollapsed; render(); },
      toggleSettings() { s().settingsOpen = !s().settingsOpen; render(); },
      togglePanel(panel) {
        const st = s();
        if (panel === 'memory') st.memoryCollapsed = !st.memoryCollapsed;
        else if (panel === 'profiles') st.profilesCollapsed = !st.profilesCollapsed;
        else st.invariantsCollapsed = !st.invariantsCollapsed;
        render();
      },
      setModel(model) {
        const st = s();
        st.model = model;
        if (model === 'claude-opus-4-8') st.temperature = 1; // opus: temperature not supported
        render();
      },
      setMaxTokens(n) { s().maxTokens = n; render(); },
      setTemperature(n) { s().temperature = n; render(); },
      setStopSequences(raw) { s().stopSequencesRaw = raw; render(); },
      setSlidingWindowSize(n) { if (!isNaN(n) && n >= 1) { s().slidingWindowSize = n; render(); } },
      setStrategy(clicked) { const st = s(); st.strategy = st.strategy === clicked ? 'default' : clicked; render(); },
      toggleMcp() { s().mcpEnabled = !s().mcpEnabled; render(); },
      newChat,
      openSession,
      deleteSession,
      deleteShortMemory(i) { s().shortMemory.splice(i, 1); render(); },
      deleteWorkingMemory(i) { s().workingMemory.splice(i, 1); render(); void saveSession(); },
      async deleteLongTermMemory(i) {
        try {
          const res = await fetch(`/api/long-term-memory/${i}`, { method: 'DELETE' });
          const data = await res.json();
          s().longTermMemory = data.entries ?? s().longTermMemory;
          render();
        } catch { /* ignore */ }
      },
      async deleteInvariant(i) {
        try {
          const res = await fetch(`/api/invariants/${i}`, { method: 'DELETE' });
          const data = await res.json();
          s().invariants = data.entries ?? s().invariants;
          render();
        } catch { /* ignore */ }
      },
      switchProfile,
      async deleteProfile(id) {
        try {
          const res = await fetch(`/api/profiles/${id}`, { method: 'DELETE' });
          const data = await res.json();
          const st = s();
          st.profiles = data.profiles ?? st.profiles;
          st.activeProfileId = data.activeProfileId ?? null;
          render();
        } catch { /* ignore */ }
      },
      createBranch,
      switchBranch,
      openCompare,
      closeCompare,
      stopTask,
      send,
      stopStreaming,
    };
  }, []);

  useEffect(() => { actions.init(); }, [actions]);

  return { s: storeRef.current, a: actions };
}
