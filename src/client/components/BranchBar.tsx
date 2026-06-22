import type { Store, ChatActions } from '../useChat';

export function BranchBar({ s, a }: { s: Store; a: ChatActions }) {
  return (
    <div className={'branch-bar' + (s.strategy === 'branching' ? ' visible' : '')}>
      <div className="branch-tabs">
        {s.branches.map(branch => (
          <button
            key={branch.id}
            className={'branch-tab' + (branch.id === s.activeBranchId ? ' active' : '')}
            onClick={() => a.switchBranch(branch.id)}
          >
            {branch.label}
          </button>
        ))}
      </div>
      <button className="btn-branch" onClick={a.createBranch}>+ Branch</button>
      {s.branches.length >= 2 && (
        <button className="btn-compare" onClick={a.openCompare}>Compare</button>
      )}
    </div>
  );
}
