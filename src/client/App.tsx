import { useChat } from './useChat';
import { Header } from './components/Header';
import { SettingsPanel } from './components/SettingsPanel';
import { Sidebar } from './components/Sidebar';
import { FactsPanel, InvariantsPanel, ProfilesPanel, MemoryPanel } from './components/SidePanels';
import { TaskBar } from './components/TaskBar';
import { BranchBar } from './components/BranchBar';
import { Transcript } from './components/Transcript';
import { InputBar } from './components/InputBar';
import { CompareModal } from './components/CompareModal';

export function App() {
  const { s, a } = useChat();

  return (
    <div className="app">
      <Header s={s} a={a} />
      <SettingsPanel s={s} a={a} />

      <div className="body">
        <Sidebar s={s} a={a} />
        <FactsPanel s={s} />
        <InvariantsPanel s={s} a={a} />
        <ProfilesPanel s={s} a={a} />
        <MemoryPanel s={s} a={a} />

        <div className="chat-area">
          <TaskBar s={s} />
          <BranchBar s={s} a={a} />
          <Transcript s={s} />
          <InputBar s={s} a={a} />
        </div>
      </div>

      <CompareModal s={s} a={a} />
    </div>
  );
}
