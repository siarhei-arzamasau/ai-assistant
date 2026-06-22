// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TaskBar } from '../../src/client/components/TaskBar';
import type { Store } from '../../src/client/useChat';

const storeWith = (activeTask: Store['activeTask']) => ({ activeTask } as unknown as Store);

describe('TaskBar', () => {
  it('is hidden when there is no active task', () => {
    const { container } = render(<TaskBar s={storeWith(null)} />);
    expect(container.querySelector('.task-bar')).not.toHaveClass('visible');
  });

  it('shows the stage badge, description and review hint for the planning stage', () => {
    const { container, getByText } = render(
      <TaskBar s={storeWith({ description: 'build a thing', state: 'planning', outputs: {} })} />,
    );
    expect(container.querySelector('.task-bar')).toHaveClass('visible');
    expect(getByText('Stage 1/4 · Planning')).toBeInTheDocument();
    expect(getByText('build a thing')).toBeInTheDocument();
    expect(container.querySelector('.task-bar-hint')?.textContent).toContain('стоп');
  });

  it('reflects later stages in the badge', () => {
    const { getByText } = render(
      <TaskBar s={storeWith({ description: 'x', state: 'validation', outputs: {} })} />,
    );
    expect(getByText('Stage 3/4 · Validation')).toBeInTheDocument();
  });

  it('shows a completion hint when done', () => {
    const { container } = render(
      <TaskBar s={storeWith({ description: 'x', state: 'done', outputs: {} })} />,
    );
    expect(container.querySelector('.task-bar-hint')?.textContent).toBe('Task complete');
  });
});
