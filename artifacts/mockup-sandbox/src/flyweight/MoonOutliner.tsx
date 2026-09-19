import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { MoonEditor, AddKind } from "./moonEditor";
import type { SceneEditorNode } from "./vendor/blender-to-threejs/stage/scene-editor";

/**
 * The Outliner, as a panel beside the viewport.
 *
 * It renders `editor.tree()` and nothing else: the editor owns selection, so a
 * row click, a viewport pick and a G/S/R gesture all agree by construction.
 * Rows are keyed by id, never by name or index, both of which move.
 */
const ADD: { kind: AddKind; label: string }[] = [
  { kind: "star", label: "Star" },
  { kind: "crescent", label: "Crescent" },
  { kind: "planet", label: "Planet" },
  { kind: "saturn", label: "Saturn" },
  { kind: "arch", label: "Arch" },
  { kind: "boulder", label: "Boulder" },
  { kind: "monolith", label: "Monolith" },
  { kind: "block", label: "Block" },
];

function Rows({ nodes, depth, onPick }: { nodes: SceneEditorNode[]; depth: number; onPick: (id: string) => void }) {
  return (
    <>
      {nodes.map((n) => (
        <div key={n.id}>
          <button
            className={n.selected ? "outliner-row selected" : "outliner-row"}
            style={{ paddingLeft: 10 + depth * 13 }}
            onClick={() => onPick(n.id)}
          >
            <span className="outliner-type">{n.type === "Group" ? "▣" : "◈"}</span>
            <span className="outliner-name">{n.name}</span>
          </button>
          {n.children.length > 0 && <Rows nodes={n.children} depth={depth + 1} onPick={onPick} />}
        </div>
      ))}
    </>
  );
}

export function MoonOutliner({ editor }: { editor: MoonEditor }) {
  const [tree, setTree] = useState<SceneEditorNode[]>(() => editor.tree());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setTree(editor.tree());
    return editor.onChange(() => setTree(editor.tree()));
  }, [editor]);

  const selected = (function find(nodes: SceneEditorNode[]): SceneEditorNode | null {
    for (const n of nodes) {
      if (n.selected) return n;
      const c = find(n.children);
      if (c) return c;
    }
    return null;
  })(tree);

  const copy = async () => {
    const text = editor.layout();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      console.log(text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return createPortal(
    <aside className="moon-editor mono" aria-label="Scene editor">
      <div className="moon-editor-head">
        <span>OUTLINER</span>
        <span>{tree.length} ROOTS</span>
      </div>
      <div className="outliner-list">
        <Rows nodes={tree} depth={0} onPick={(id) => editor.select(id)} />
      </div>

      <div className="moon-editor-head">
        <span>ADD</span>
        <span>drops in front of camera</span>
      </div>
      <div className="moon-editor-add">
        {ADD.map(({ kind, label }) => (
          <button key={kind} onClick={() => editor.add(kind)}>+ {label}</button>
        ))}
      </div>

      <div className="moon-editor-head">
        <span>SELECTED</span>
        <span>{selected ? selected.name : "-"}</span>
      </div>
      <div className="moon-editor-actions">
        <button onClick={copy}>{copied ? "copied ✓" : "copy layout"}</button>
        <button
          disabled={!selected}
          onClick={() => selected && editor.remove(selected.id)}
        >
          delete
        </button>
      </div>

      <p className="moon-editor-keys">
        Click to select. <b>G</b> move · <b>S</b> scale · <b>R</b> rotate · <b>X/Y/Z</b> axis
        (again for local, again to clear) · <b>Shift</b> precision · type a number ·
        <b> Enter</b> confirm · <b>Esc</b> cancel.
        <br />
        The ink-boil filter is off while editing so clicks land where you see them.
      </p>
    </aside>,
    document.body,
  );
}
