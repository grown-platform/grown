import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A callback whose identity never changes but which always calls the latest
 * `fn` passed in.
 *
 * FortuneSheet's <Workbook> must get stable `onOp`/`onChange` props: its
 * internal `setContext` is memoised on `onOp`, and effects keyed on
 * `setContext` (the sheet tab's scroll/selection restore among them) re-run
 * whenever it changes. A fresh `onOp` on every editor render (the 1s presence
 * tick, dialog state, …) therefore cleared the selection and FortuneSheet
 * restored the sheet's saved one, snapping the grid back to A1.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic over any callback.
export function useStableCallback<A extends any[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}
