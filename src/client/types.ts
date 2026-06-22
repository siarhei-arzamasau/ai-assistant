export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  strategy?: string;
  slidingWindowSize?: number;
}

export interface BranchData {
  id: string;
  label: string;
  createdAt: string;
  messages: Message[];
}

export interface Profile {
  id: string;
  name: string;
  definition: string;
  createdAt: string;
}

export type TaskStage = 'planning' | 'execution' | 'validation' | 'done';

export interface ActiveTask {
  description: string;
  state: TaskStage;
  outputs: Partial<Record<Exclude<TaskStage, 'done'>, string>>;
}

export interface Settings {
  model: string;
  maxTokens: number;
  temperature: number;
  stopSequences: string[];
}

/**
 * A single rendered row in the transcript. Real conversation turns are
 * `message` items (also kept in `history` for the API and persistence);
 * `system` items are local command output never sent to the model.
 */
export type DisplayItem =
  | {
      kind: 'message';
      id: string;
      role: 'user' | 'assistant';
      content: string;
      stageLabel?: string;
      thinking?: boolean;
      streaming?: boolean;
      error?: boolean;
      interrupted?: boolean;
      time?: string;
    }
  | {
      kind: 'system';
      id: string;
      text: string;
      align?: 'left' | 'center';
      mono?: boolean;
    };

export interface CompareColumn {
  label: string;
  active: boolean;
  messages: Message[];
  forkIdx: number;
}
