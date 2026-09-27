import { renderHook } from "@testing-library/react";
import { useStableCallback } from "./useStableCallback";

describe("useStableCallback", () => {
  it("keeps one identity across renders", () => {
    const { result, rerender } = renderHook(({ n }) => useStableCallback(() => n), {
      initialProps: { n: 1 },
    });
    const first = result.current;
    rerender({ n: 2 });
    rerender({ n: 3 });
    expect(result.current).toBe(first);
  });

  it("calls the latest function with its arguments", () => {
    const { result, rerender } = renderHook(
      ({ k }) => useStableCallback((x: number) => x * k),
      { initialProps: { k: 2 } },
    );
    expect(result.current(5)).toBe(10);
    rerender({ k: 3 });
    expect(result.current(5)).toBe(15);
  });
});
