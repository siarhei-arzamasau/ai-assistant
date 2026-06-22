import type { Store } from '../useChat';
import { TASK_STAGES, TASK_STAGE_LABELS } from '../constants';

export function TaskBar({ s }: { s: Store }) {
  const task = s.activeTask;
  if (!task) return <div className="task-bar" />;

  const idx = TASK_STAGES.indexOf(task.state) + 1;
  const badge = `Stage ${idx}/4 · ${TASK_STAGE_LABELS[task.state]}`;
  let hint: string;
  if (task.state === 'done') {
    hint = 'Task complete';
  } else {
    const next = TASK_STAGES[TASK_STAGES.indexOf(task.state) + 1];
    hint = `Reply to approve & move to ${TASK_STAGE_LABELS[next]}, describe changes to revise, or type “стоп” to stop.`;
  }

  return (
    <div className="task-bar visible">
      <div className="task-bar-info">
        <span className="task-stage-badge">{badge}</span>
        <span className="task-desc">{task.description}</span>
      </div>
      <div className="task-bar-hint">{hint}</div>
    </div>
  );
}
