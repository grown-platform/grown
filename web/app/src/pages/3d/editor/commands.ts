/**
 * A minimal command/history stack for the 3D editor's undo/redo.
 *
 * Every mutating editor action (add primitive, delete, transform, paint,
 * push/pull) is expressed as a Command with do()/undo(). The History runs a
 * command and pushes it; undo() reverses the top command and moves it to the
 * redo stack; redo() re-runs it. This keeps undo/redo trivially correct as long
 * as each command's undo() exactly reverses its do().
 *
 * Transform/paint/push-pull commands are typically captured as
 * "before -> after" snapshots and pushed *already applied* (the gizmo has
 * already moved the object). For those we use `pushApplied`, which records the
 * command without re-running do().
 */
export interface Command {
  /** Human label (shown in the status line / future history panel). */
  readonly label: string;
  /** Apply the change. Must be idempotent enough to survive redo. */
  do(): void;
  /** Exactly reverse `do()`. */
  undo(): void;
}

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<() => void>();
  /** Cap the stack so long sessions don't grow unbounded. */
  private readonly limit = 200;

  /** Run a command and record it (clears the redo stack). */
  run(cmd: Command): void {
    cmd.do();
    this.pushApplied(cmd);
  }

  /**
   * Record an already-applied command without re-running do() (used when the
   * mutation happened interactively, e.g. a TransformControls drag we snapshot
   * on drag-end). Clears the redo stack.
   */
  pushApplied(cmd: Command): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit();
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
    this.emit();
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.do();
    this.undoStack.push(cmd);
    this.emit();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit();
  }

  /** Subscribe to stack changes (for enabling/disabling UI). Returns unsub. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

/** Build a one-off command from inline do/undo closures. */
export function command(
  label: string,
  doFn: () => void,
  undoFn: () => void,
): Command {
  return { label, do: doFn, undo: undoFn };
}
