/**
 * Translate — an on-device translator that runs entirely in the browser and
 * can read the translation aloud with Supertonic TTS. No backend involved.
 *
 *   - Translation: the browser's built-in Translator API when present, else
 *     transformers.js (NLLB-200) loaded lazily (see translator.ts).
 *   - Speech: Supertonic (onnxruntime-web, WebGPU→WASM) loaded lazily on first
 *     Speak, with a speechSynthesis fallback (see speak.ts / supertonic.ts).
 *
 * Both ML stacks are dynamically imported so they stay out of the main bundle,
 * and both download their models on first use (cached afterward) — the UI shows
 * progress and never crashes to a blank screen on failure.
 */
import { useRef, useState } from "react";
import {
  Box,
  Container,
  Sheet,
  Stack,
  Typography,
  Select,
  Option,
  Textarea,
  Button,
  IconButton,
  LinearProgress,
  Alert,
  Tooltip,
} from "@mui/joy";
import TranslateIcon from "@mui/icons-material/Translate";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import StopIcon from "@mui/icons-material/Stop";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { LANGUAGES, langByCode } from "./languages";
import {
  translate,
  browserTranslatorAvailable,
  type Engine,
  type TranslateProgress,
} from "./translator";
import { speak, type SpeakProgress } from "./speak";

const ACCENT = "#0E7C86";

export default function TranslateApp({ user }: { user: User }) {
  const [sourceLang, setSourceLang] = useState("en");
  const [targetLang, setTargetLang] = useState("es");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");

  // Translation state.
  const [translating, setTranslating] = useState(false);
  const [translateStatus, setTranslateStatus] =
    useState<TranslateProgress | null>(null);
  const [usedEngine, setUsedEngine] = useState<Engine | null>(null);
  const [translateError, setTranslateError] = useState<string | null>(null);

  // Speech state.
  const [speaking, setSpeaking] = useState(false);
  const [speakStatus, setSpeakStatus] = useState<SpeakProgress | null>(null);
  const [speakError, setSpeakError] = useState<string | null>(null);
  // A long-lived hidden <audio> element Supertonic plays through.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // The active speak handle, so the Stop button can halt playback.
  const stopRef = useRef<(() => void) | null>(null);

  function swapLanguages() {
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
    setInput(output);
    setOutput(input);
  }

  async function handleTranslate() {
    const from = langByCode(sourceLang);
    const to = langByCode(targetLang);
    if (!from || !to || !input.trim()) return;

    setTranslating(true);
    setTranslateError(null);
    setUsedEngine(null);
    setTranslateStatus({ phase: "checking", message: "Preparing…" });
    try {
      const result = await translate(input, from, to, (p) =>
        setTranslateStatus(p),
      );
      setOutput(result.text);
      setUsedEngine(result.engine);
    } catch (e) {
      setTranslateError((e as Error).message);
    } finally {
      setTranslating(false);
      setTranslateStatus(null);
    }
  }

  async function handleSpeak() {
    const to = langByCode(targetLang);
    if (!to || !output.trim()) return;

    // Ensure the audio element exists.
    if (!audioRef.current) audioRef.current = new Audio();

    setSpeaking(true);
    setSpeakError(null);
    setSpeakStatus({ message: "Starting…" });
    try {
      const handle = await speak(output, to, audioRef.current, (p) =>
        setSpeakStatus(p),
      );
      stopRef.current = handle.stop;
      // For the browser engine, playback already kicked off synchronously; for
      // Supertonic, audio.play() resolved before this. Clear the busy state once
      // playback ends so the button returns to "Speak".
      const audio = audioRef.current;
      const done = () => {
        setSpeaking(false);
        setSpeakStatus(null);
      };
      if (handle.engine === "supertonic" && audio) {
        audio.onended = done;
      } else {
        // speechSynthesis has no element event here; just clear the spinner.
        done();
      }
      setSpeakStatus({
        message:
          handle.engine === "supertonic"
            ? `Playing (Supertonic · ${handle.backend?.toUpperCase()})`
            : "Playing (browser voice)",
      });
    } catch (e) {
      setSpeakError((e as Error).message);
      setSpeaking(false);
      setSpeakStatus(null);
    }
  }

  function handleStop() {
    stopRef.current?.();
    stopRef.current = null;
    setSpeaking(false);
    setSpeakStatus(null);
  }

  const targetMeta = langByCode(targetLang);
  const speakLabel =
    targetMeta?.supertonic != null ? "Speak (Supertonic)" : "Speak";

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.body" }}>
      <Header user={user} />
      <Container sx={{ py: 4, maxWidth: 980 }}>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
          <TranslateIcon sx={{ color: ACCENT, fontSize: 30 }} />
          <Typography level="h2">Translate</Typography>
        </Stack>
        <Typography level="body-sm" sx={{ mb: 3, opacity: 0.8 }}>
          On-device translation and text-to-speech — everything runs in your
          browser. The first translate and first Speak download their models
          on-device (cached afterward), so they may take a moment.
        </Typography>

        {/* Language selectors */}
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          alignItems={{ sm: "center" }}
          sx={{ mb: 2 }}
        >
          <Select
            value={sourceLang}
            onChange={(_, v) => v && setSourceLang(v)}
            sx={{ flex: 1, minWidth: 180 }}
            slotProps={{ listbox: { sx: { maxHeight: 320 } } }}
          >
            {LANGUAGES.map((l) => (
              <Option key={l.code} value={l.code}>
                {l.name}
              </Option>
            ))}
          </Select>

          <Tooltip title="Swap languages">
            <IconButton
              variant="soft"
              onClick={swapLanguages}
              sx={{ alignSelf: "center" }}
            >
              <SwapHorizIcon />
            </IconButton>
          </Tooltip>

          <Select
            value={targetLang}
            onChange={(_, v) => v && setTargetLang(v)}
            sx={{ flex: 1, minWidth: 180 }}
            slotProps={{ listbox: { sx: { maxHeight: 320 } } }}
          >
            {LANGUAGES.map((l) => (
              <Option key={l.code} value={l.code}>
                {l.name}
              </Option>
            ))}
          </Select>
        </Stack>

        {/* Source + output boxes */}
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          sx={{ mb: 2 }}
        >
          <Sheet
            variant="outlined"
            sx={{ flex: 1, borderRadius: "md", p: 1.5 }}
          >
            <Typography level="body-xs" sx={{ mb: 0.5, opacity: 0.6 }}>
              {langByCode(sourceLang)?.name}
            </Typography>
            <Textarea
              minRows={6}
              maxRows={12}
              placeholder="Enter text to translate…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              variant="plain"
              sx={{ "--Textarea-focusedThickness": "0px" }}
            />
          </Sheet>

          <Sheet
            variant="outlined"
            sx={{ flex: 1, borderRadius: "md", p: 1.5, bgcolor: "background.level1" }}
          >
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 0.5 }}
            >
              <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                {targetMeta?.name}
              </Typography>
              {output && (
                <Tooltip title="Copy">
                  <IconButton
                    size="sm"
                    variant="plain"
                    onClick={() => void navigator.clipboard?.writeText(output)}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
            <Textarea
              minRows={6}
              maxRows={12}
              placeholder="Translation will appear here…"
              value={output}
              readOnly
              variant="plain"
              sx={{ "--Textarea-focusedThickness": "0px", bgcolor: "transparent" }}
            />
          </Sheet>
        </Stack>

        {/* Actions */}
        <Stack direction="row" spacing={1.5} flexWrap="wrap" sx={{ mb: 2 }}>
          <Button
            startDecorator={<TranslateIcon />}
            onClick={() => void handleTranslate()}
            loading={translating}
            disabled={!input.trim()}
            sx={{ bgcolor: ACCENT, "&:hover": { bgcolor: "#0a5d65" } }}
          >
            Translate
          </Button>

          {!speaking ? (
            <Button
              variant="outlined"
              color="neutral"
              startDecorator={<VolumeUpIcon />}
              onClick={() => void handleSpeak()}
              disabled={!output.trim()}
            >
              {speakLabel}
            </Button>
          ) : (
            <Button
              variant="outlined"
              color="danger"
              startDecorator={<StopIcon />}
              onClick={handleStop}
            >
              Stop
            </Button>
          )}
        </Stack>

        {/* Translation progress + status */}
        {translating && translateStatus && (
          <Box sx={{ mb: 1.5 }}>
            <Typography level="body-sm" sx={{ mb: 0.5 }}>
              {translateStatus.message}
            </Typography>
            <LinearProgress
              determinate={translateStatus.progress != null}
              value={
                translateStatus.progress != null
                  ? translateStatus.progress * 100
                  : undefined
              }
            />
          </Box>
        )}

        {/* Speech progress */}
        {speaking && speakStatus && (
          <Box sx={{ mb: 1.5 }}>
            <Typography level="body-sm" sx={{ mb: 0.5 }}>
              {speakStatus.message}
            </Typography>
            <LinearProgress />
          </Box>
        )}

        {usedEngine && !translating && (
          <Typography level="body-xs" sx={{ opacity: 0.6, mb: 1 }}>
            Translated with{" "}
            {usedEngine === "browser"
              ? "the browser's built-in translator"
              : "transformers.js (NLLB-200, on-device)"}
            .
          </Typography>
        )}

        {translateError && (
          <Alert color="danger" variant="soft" sx={{ mb: 1 }}>
            {translateError}
          </Alert>
        )}
        {speakError && (
          <Alert color="warning" variant="soft" sx={{ mb: 1 }}>
            {speakError}
          </Alert>
        )}

        {/* Footnote on engines */}
        <Alert
          variant="soft"
          color="neutral"
          startDecorator={<InfoOutlinedIcon />}
          sx={{ mt: 2 }}
        >
          <Typography level="body-xs">
            Translation uses{" "}
            {browserTranslatorAvailable()
              ? "your browser's on-device Translator API (falling back to a local NLLB-200 model)"
              : "a local NLLB-200 model via transformers.js"}
            . Speech uses Supertonic on-device TTS (WebGPU with WASM fallback);
            if it can't load, it falls back to your browser's speech voice.
            Model files are fetched once and cached.
          </Typography>
        </Alert>
      </Container>
    </Box>
  );
}
