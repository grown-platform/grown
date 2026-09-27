// The Presence chip must reflect the socket's real state even when the
// provider's one-off "connected" status event fires before Presence has
// subscribed. Regression: on a production build the WebSocket could open
// between Presence's first render (which read wsconnected=false) and its
// effect attaching the "status" listener; the event went unheard and the
// chip said "connecting" for the life of the page (about 1 reload in 30 in
// docs-collab-reconnect.spec.ts).
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ObservableV2 } from "lib0/observable";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import type { WebsocketProvider } from "y-websocket";
import { Presence } from "../Presence";

afterEach(cleanup);

class FakeProvider extends ObservableV2<{ status: (e: { status: string }) => void }> {
  awareness = new Awareness(new Y.Doc());
  wsconnected = false;
  open(emit: boolean) {
    this.wsconnected = true;
    if (emit) this.emit("status", [{ status: "connected" }]);
  }
}

const chip = () => screen.getByTestId("collab-status").textContent;

describe("Presence status chip", () => {
  it("shows connected when the socket opened before the listener was attached", () => {
    const p = new FakeProvider();
    let first = true;
    // The socket opens (its "connected" event reaching no listener) right
    // after the first render reads wsconnected, before Presence's effect runs.
    Object.defineProperty(p, "wsconnected", {
      get() {
        if (first) {
          first = false;
          return false;
        }
        return true;
      },
      configurable: true,
    });
    render(<Presence provider={p as unknown as WebsocketProvider} />);
    expect(chip()).toBe("connected");
  });

  it("follows later status events", () => {
    const p = new FakeProvider();
    render(<Presence provider={p as unknown as WebsocketProvider} />);
    expect(chip()).toBe("connecting");
    act(() => p.open(true));
    expect(chip()).toBe("connected");
    act(() => {
      p.wsconnected = false;
      p.emit("status", [{ status: "disconnected" }]);
    });
    expect(chip()).toBe("disconnected");
  });
});
