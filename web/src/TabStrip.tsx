import type { ReactNode } from "react";

export interface TabStripTab {
  key: string;
  label: ReactNode;
  active: boolean;
  onClick: () => void;
}

/**
 * A simple content-switch tab bar: plain label buttons that flip which pane
 * is shown, plus an optional trailing element (export/expand buttons, etc.)
 * rendered after the tab buttons.
 */
export function TabStrip({ tabs, trailing }: { tabs: TabStripTab[]; trailing?: ReactNode }) {
  return (
    <nav className="tab-strip">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={tab.onClick}
          aria-pressed={tab.active}
          className={tab.active ? "tab is-active" : "tab"}
        >
          {tab.label}
        </button>
      ))}
      {trailing}
    </nav>
  );
}
