// whip.ts — browser-side WebRTC publishing to MediaMTX over WHIP.
//
// WHIP (WebRTC-HTTP Ingestion Protocol) is a tiny signaling handshake: the
// browser creates an RTCPeerConnection with the media tracks, generates an SDP
// offer, POSTs it (Content-Type: application/sdp) to the WHIP endpoint, and
// applies the SDP answer the server returns. MediaMTX implements WHIP at
// <whip_url> = "/live-webrtc/<path>/whip" (proxied under grown's origin).
//
// We send the stream key as the bearer credential. MediaMTX's HTTP auth webhook
// (grown's /api/v1/live/auth) receives it and checks it against the stream's
// stream_key. NOTE (unverified without running MediaMTX): MediaMTX maps the
// WHIP Authorization header / query to the auth webhook's user/password fields;
// we pass the key BOTH as a Bearer token and as a "?key=" query param so the
// webhook's keyMatches (which checks password, user, and the query) accepts it
// regardless of which mapping MediaMTX uses. Confirm against your MediaMTX
// version's WHIP auth behavior.

export interface WhipSession {
  pc: RTCPeerConnection;
  /** The local media being published (so the UI can preview/stop it). */
  stream: MediaStream;
  /** Stops publishing: closes the peer connection and the media tracks. The
   *  DELETE to the WHIP resource is best-effort (MediaMTX also notices the ICE
   *  teardown and fires runOnNotReady). */
  stop: () => Promise<void>;
}

export type CaptureKind = "camera" | "screen";

/** captureMedia grabs the webcam (+mic) or the screen for publishing. */
export async function captureMedia(kind: CaptureKind): Promise<MediaStream> {
  if (kind === "screen") {
    // getDisplayMedia: screen/window/tab. Audio capture support varies by
    // browser; request it but tolerate audio-less screen shares.
    return navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  }
  return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
}

/** publishWhip starts publishing `stream` to the WHIP endpoint and resolves to
 *  a session handle. `streamKey` is the publish secret (sent as bearer + query).
 */
export async function publishWhip(
  whipUrl: string,
  stream: MediaStream,
  streamKey: string,
): Promise<WhipSession> {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  // Publish: we only send. Add each track sendonly.
  for (const track of stream.getTracks()) {
    pc.addTransceiver(track, { direction: "sendonly", streams: [stream] });
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGathering(pc);

  const url = appendKey(whipUrl, streamKey);
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/sdp",
      Authorization: `Bearer ${streamKey}`,
    },
    body: pc.localDescription?.sdp ?? offer.sdp ?? "",
    credentials: "same-origin",
  });
  if (!resp.ok) {
    pc.close();
    throw new Error(`WHIP publish failed: HTTP ${resp.status}`);
  }
  const answerSdp = await resp.text();
  // The WHIP resource URL (for teardown) is returned in the Location header.
  const resourceLoc = resp.headers.get("Location");
  const resourceUrl = resourceLoc
    ? new URL(resourceLoc, new URL(url, window.location.origin)).toString()
    : null;

  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  const stop = async () => {
    try {
      if (resourceUrl) {
        await fetch(resourceUrl, {
          method: "DELETE",
          credentials: "same-origin",
        });
      }
    } catch {
      /* best-effort: ICE teardown alone ends the publish */
    }
    for (const t of stream.getTracks()) t.stop();
    pc.close();
  };

  return { pc, stream, stop };
}

/** appendKey adds ?key=<streamKey> to a URL, preserving any existing query. */
function appendKey(url: string, key: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}key=${encodeURIComponent(key)}`;
}

/** waitForIceGathering resolves once ICE candidate gathering completes (or after
 *  a 2s cap, so a stalled STUN doesn't hang Go Live). We send a non-trickle
 *  offer because the simple WHIP POST flow doesn't carry trickled candidates. */
function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(done, 2000);
  });
}
