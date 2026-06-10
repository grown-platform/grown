import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  useEffect,
} from "react";
import type { ReactNode } from "react";
import { streamUrl } from "./api";
import type { Track } from "./types";

export type RepeatMode = "off" | "all" | "one";

/** PlayerState is the public surface of the music player, consumed by the
 *  library/playlist views (to start playback) and the player bar (to render
 *  + control it). A single persistent <audio> element backs the whole app so
 *  playback survives navigation between the library and playlist pages. */
export interface PlayerState {
  /** The active play queue (e.g. the library or a playlist), in order. */
  queue: Track[];
  /** Index into queue of the currently-loaded track, or -1 when idle. */
  index: number;
  current: Track | null;
  playing: boolean;
  /** currentTime / duration in seconds. */
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  /** Shuffle mode — when true, next/prev pick random tracks. */
  shuffle: boolean;
  /** Repeat mode: off, all (loop queue), one (loop current track). */
  repeat: RepeatMode;
  /** Load a queue and start playback at startIndex. */
  playQueue: (queue: Track[], startIndex: number) => void;
  /** Play a single track with no surrounding queue. */
  playTrack: (track: Track) => void;
  /** Insert a track immediately after the current position (Play next). */
  playNext: (track: Track) => void;
  /** Append a track to the end of the current queue (Add to queue). */
  addToQueue: (track: Track) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  /** Drop a track from the queue if present (e.g. after delete). */
  removeFromQueue: (trackId: string) => void;
}

const Ctx = createContext<PlayerState | null>(null);

/** usePlayer returns the player state; throws if used outside the provider. */
export function usePlayer(): PlayerState {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlayer must be used within <PlayerProvider>");
  return v;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVol] = useState(1);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");

  // Use refs for queue/index/repeat/shuffle inside callbacks so they see
  // current values without being stale closures.
  const queueRef = useRef(queue);
  const indexRef = useRef(index);
  const repeatRef = useRef(repeat);
  const shuffleRef = useRef(shuffle);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  useEffect(() => {
    repeatRef.current = repeat;
  }, [repeat]);
  useEffect(() => {
    shuffleRef.current = shuffle;
  }, [shuffle]);

  const current = index >= 0 && index < queue.length ? queue[index] : null;

  // Lazily create the single backing <audio> element.
  if (!audioRef.current && typeof Audio !== "undefined") {
    audioRef.current = new Audio();
  }

  const loadAndPlay = useCallback((track: Track) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = streamUrl(track.id);
    audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }, []);

  const playQueue = useCallback(
    (q: Track[], startIndex: number) => {
      setQueue(q);
      setIndex(startIndex);
      const t = q[startIndex];
      if (t) loadAndPlay(t);
    },
    [loadAndPlay],
  );

  const playTrack = useCallback(
    (track: Track) => {
      playQueue([track], 0);
    },
    [playQueue],
  );

  const playNext = useCallback(
    (track: Track) => {
      setQueue((q) => {
        const cur = indexRef.current;
        const insert = cur >= 0 ? cur + 1 : q.length;
        const nq = [...q.slice(0, insert), track, ...q.slice(insert)];
        // If nothing is playing, start the track.
        if (cur === -1) {
          setIndex(0);
          loadAndPlay(track);
        }
        return nq;
      });
    },
    [loadAndPlay],
  );

  const addToQueue = useCallback(
    (track: Track) => {
      setQueue((q) => {
        const nq = [...q, track];
        // If nothing is playing, start the track.
        if (indexRef.current === -1) {
          setIndex(0);
          loadAndPlay(track);
        }
        return nq;
      });
    },
    [loadAndPlay],
  );

  const nextTrackIndex = useCallback((): number => {
    const q = queueRef.current;
    const i = indexRef.current;
    if (q.length === 0) return -1;
    if (shuffleRef.current) {
      // Pick a random index other than the current one (if possible).
      if (q.length === 1) return 0;
      let r = Math.floor(Math.random() * (q.length - 1));
      if (r >= i) r++;
      return r;
    }
    const ni = i + 1;
    if (ni < q.length) return ni;
    if (repeatRef.current === "all") return 0;
    return -1;
  }, []);

  const next = useCallback(() => {
    const ni = nextTrackIndex();
    if (ni === -1) return;
    setIndex(ni);
    loadAndPlay(queueRef.current[ni]);
  }, [nextTrackIndex, loadAndPlay]);

  const prev = useCallback(() => {
    const audio = audioRef.current;
    // If we're more than 3s into the track, restart it instead of going back.
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const q = queueRef.current;
    const i = indexRef.current;
    if (shuffleRef.current) {
      // Shuffle: go to a random different track.
      if (q.length > 1) {
        let r = Math.floor(Math.random() * (q.length - 1));
        if (r >= i) r++;
        setIndex(r);
        loadAndPlay(q[r]);
      }
      return;
    }
    const pi = i - 1;
    if (pi >= 0) {
      setIndex(pi);
      loadAndPlay(q[pi]);
    } else if (repeatRef.current === "all" && q.length > 0) {
      const last = q.length - 1;
      setIndex(last);
      loadAndPlay(q[last]);
    }
  }, [loadAndPlay]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused)
      audio
        .play()
        .then(() => setPlaying(true))
        .catch(() => {});
    else {
      audio.pause();
      setPlaying(false);
    }
  }, [current]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (audio && isFinite(seconds)) audio.currentTime = seconds;
  }, []);

  const setVolume = useCallback((v: number) => {
    const audio = audioRef.current;
    const clamped = Math.min(1, Math.max(0, v));
    setVol(clamped);
    if (audio) {
      audio.volume = clamped;
      if (clamped > 0) {
        audio.muted = false;
        setMuted(false);
      }
    }
  }, []);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    setMuted((m) => {
      const nm = !m;
      if (audio) audio.muted = nm;
      return nm;
    });
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle((s) => !s);
  }, []);

  const cycleRepeat = useCallback(() => {
    setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"));
  }, []);

  const removeFromQueue = useCallback((trackId: string) => {
    setQueue((q) => {
      const at = q.findIndex((t) => t.id === trackId);
      if (at === -1) return q;
      const nq = q.filter((t) => t.id !== trackId);
      setIndex((i) => {
        if (at < i) return i - 1;
        if (at === i) {
          // The current track was removed: stop playback.
          const audio = audioRef.current;
          if (audio) {
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
          }
          setPlaying(false);
          return -1;
        }
        return i;
      });
      return nq;
    });
  }, []);

  // Wire the audio element's events to React state.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setPosition(audio.currentTime);
    const onMeta = () =>
      setDuration(isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      if (repeatRef.current === "one") {
        // Restart the current track.
        const audio = audioRef.current;
        if (audio) {
          audio.currentTime = 0;
          audio.play().catch(() => {});
        }
      } else {
        next();
      }
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [next]);

  // Pause + release the element when the provider unmounts (leaving the app).
  useEffect(() => {
    return () => {
      const a = audioRef.current;
      if (a) {
        a.pause();
        a.removeAttribute("src");
      }
    };
  }, []);

  const value: PlayerState = {
    queue,
    index,
    current,
    playing,
    position,
    duration,
    volume,
    muted,
    shuffle,
    repeat,
    playQueue,
    playTrack,
    playNext,
    addToQueue,
    toggle,
    next,
    prev,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    removeFromQueue,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
