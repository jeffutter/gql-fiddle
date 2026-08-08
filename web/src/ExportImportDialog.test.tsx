import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExportDialog, ImportDialog } from "./ExportImportDialog";
import { useWorkspace } from "./store";
import { encodeExport } from "./share";
import type { WorkspaceEntry } from "./share";

function makeWorkspace(name: string, overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    name,
    id: `id-${name}`,
    version: 1,
    subgraphs: [{ name: "users", sdl: "type Query { me: String }" }],
    activeSubgraph: 0,
    queryTabs: [{ name: "Query 1", query: "query { me }" }],
    activeQueryTab: 0,
    seed: 42,
    mockConfig: "",
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  useWorkspace.setState({
    workspaces: [makeWorkspace("Workspace 1")],
    activeWorkspaceIndex: 0,
    supergraphSdl: null,
    composeErrors: null,
    composeHints: 0,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ExportDialog", () => {
  it("closes on Escape (AC#5)", () => {
    const onClose = vi.fn();
    render(<ExportDialog workspaces={[makeWorkspace("Workspace 1")]} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("checks all workspaces by default and disables Download when none are selected", () => {
    const workspaces = [makeWorkspace("Workspace 1"), makeWorkspace("Workspace 2")];
    render(<ExportDialog workspaces={workspaces} onClose={vi.fn()} />);

    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((cb) => cb.checked)).toBe(true);

    const downloadBtn = screen.getByRole("button", { name: "Download" });
    expect(downloadBtn).not.toBeDisabled();

    for (const cb of checkboxes) fireEvent.click(cb);
    expect(downloadBtn).toBeDisabled();
  });

  it("triggers a gzip blob download named gql-fiddle-export-YYYY-MM-DD.json.gz", () => {
    if (!URL.createObjectURL) URL.createObjectURL = () => "blob:mock";
    if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};
    const created: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      created.push(b as Blob);
      return "blob:mock";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    let downloadName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadName = this.download;
    });

    const onClose = vi.fn();
    const workspaces = [makeWorkspace("Workspace 1")];
    render(<ExportDialog workspaces={workspaces} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    expect(created).toHaveLength(1);
    expect(created[0].type).toBe("application/gzip");
    const today = new Date().toISOString().slice(0, 10);
    expect(downloadName).toBe(`gql-fiddle-export-${today}.json.gz`);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ImportDialog", () => {
  it("closes on Escape (AC#5)", () => {
    const onClose = vi.fn();
    render(<ImportDialog onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  function selectFile(bytes: Uint8Array, filename = "export.json.gz") {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    // ArrayBufferLike -> ArrayBuffer copy keeps the File constructor happy under jsdom.
    const file = new File([bytes.slice()], filename);
    fireEvent.change(input, { target: { files: [file] } });
  }

  it("shows the parsed workspace list, all checked by default, after picking a valid file", async () => {
    const bytes = encodeExport([makeWorkspace("Imported WS")]);
    render(<ImportDialog onClose={vi.fn()} />);

    await act(async () => selectFile(bytes));

    await waitFor(() => {
      expect(screen.getByText("Imported WS")).toBeInTheDocument();
    });
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("imports selected workspaces with new UUIDs and switches to the first imported workspace", async () => {
    const bytes = encodeExport([makeWorkspace("Imported WS")]);
    const onClose = vi.fn();
    render(<ImportDialog onClose={onClose} />);

    await act(async () => selectFile(bytes));
    await waitFor(() => expect(screen.getByText("Imported WS")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    const state = useWorkspace.getState();
    expect(state.workspaces).toHaveLength(2);
    expect(state.workspaces[1].name).toBe("Imported WS");
    expect(state.workspaces[1].id).not.toBe("id-Imported WS");
    expect(state.activeWorkspaceIndex).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renames on name collision with an '(imported)' suffix", async () => {
    useWorkspace.setState({
      workspaces: [makeWorkspace("Workspace 1")],
      activeWorkspaceIndex: 0,
    });
    const bytes = encodeExport([makeWorkspace("Workspace 1")]);
    render(<ImportDialog onClose={vi.fn()} />);

    await act(async () => selectFile(bytes));
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    const state = useWorkspace.getState();
    expect(state.workspaces.map((w) => w.name)).toEqual(["Workspace 1", "Workspace 1 (imported)"]);
  });

  it("shows a friendly error step for a corrupt file", async () => {
    const onClose = vi.fn();
    render(<ImportDialog onClose={onClose} />);

    await act(async () => selectFile(new Uint8Array([1, 2, 3, 4])));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/not valid JSON/);
    });
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("closes without changing state when Import is confirmed with zero selections", async () => {
    const bytes = encodeExport([makeWorkspace("Imported WS")]);
    const onClose = vi.fn();
    render(<ImportDialog onClose={onClose} />);

    await act(async () => selectFile(bytes));
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox"));
    const before = useWorkspace.getState().workspaces;
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(useWorkspace.getState().workspaces).toBe(before);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
