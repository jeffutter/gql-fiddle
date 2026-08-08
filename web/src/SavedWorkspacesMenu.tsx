import { useWorkspace, activeWorkspace } from "./store";
import {
  useSavedWorkspaceLibrary,
  openSavedWorkspace,
  renameSavedWorkspace,
  deleteSavedWorkspace,
} from "./sync";
import { EditableTab } from "./EditableTab";
import type { WorkspaceEntry } from "./share";

type SavedEntry = WorkspaceEntry & { id: string };

export interface SavedWorkspacesMenuProps {
  /** Called after the user picks a workspace to open/switch to, so the
   *  caller can close the dropdown — mirrors how every other action in the
   *  Workspace/Share header menus closes itself on click. */
  onOpened: () => void;
}

/**
 * Panel content for the "Saved Workspaces" header menu (TASK-126.4): lists
 * every workspace the logged-in user has marked Saved, whether it's
 * currently open as a tab or closed. Each row reuses EditableTab — the same
 * rename-on-dblclick affordance the tab strip itself uses — with its "x"
 * repurposed here to mean permanent delete (behind a confirmation, since
 * unlike closing a tab this can't be undone).
 */
export function SavedWorkspacesMenu({ onOpened }: SavedWorkspacesMenuProps) {
  const workspaces = useWorkspace((s) => s.workspaces);
  const activeId = useWorkspace((s) => activeWorkspace(s).id ?? null);
  const closedEntries = useSavedWorkspaceLibrary((s) => s.entries);

  // Open-tab entries and the closed library are two disjoint partitions of
  // the same logical set (see sync.ts's mergeWorkspaces/mergeSavedLibrary),
  // so a plain concatenation can't double-list one workspace. The `.saved`
  // filter on `workspaces` is what actually excludes non-saved open tabs;
  // it's redundant-but-defensive on `closedEntries`, which is only ever
  // populated with saved+closed rows by construction. Sorted by name for a
  // stable order independent of tab position or pull order.
  const entries: SavedEntry[] = [...workspaces, ...closedEntries]
    .filter((w): w is SavedEntry => !!w.saved && !!w.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (entries.length === 0) {
    return <p className="saved-workspaces-menu__empty">No saved workspaces yet.</p>;
  }

  return (
    <div className="saved-workspaces-menu">
      {entries.map((ws) => (
        <EditableTab
          key={ws.id}
          name={ws.name}
          active={ws.id === activeId}
          onSelect={() => {
            openSavedWorkspace(ws.id);
            onOpened();
          }}
          onRename={(name) => renameSavedWorkspace(ws.id, name)}
          onRemove={() => {
            if (window.confirm(`Permanently delete "${ws.name}"? This can't be undone.`)) {
              deleteSavedWorkspace(ws.id);
            }
          }}
          testId={`saved-workspace-${ws.id}`}
          removeAriaLabel={`Delete ${ws.name}`}
          removeTestId={`saved-workspace-delete-${ws.id}`}
        />
      ))}
    </div>
  );
}
