import { useEffect, useState } from "react";
import { Box, CircularProgress, Typography } from "@mui/joy";

interface TxtReaderProps {
  url: string;
  fontScale: number;
  lineHeight: number;
  dark: boolean;
  justify: boolean;
}

/** Renders a plain-text book with the reader's display settings applied. */
export function TxtReader({
  url,
  fontScale,
  lineHeight,
  dark,
  justify,
}: TxtReaderProps) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    fetch(url, { credentials: "same-origin" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) {
    return (
      <Box sx={{ p: 3 }} role="alert">
        <Typography color="danger">Couldn’t load text: {error}</Typography>
      </Box>
    );
  }
  if (text === null) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  return (
    <Box
      sx={{
        maxWidth: 720,
        mx: "auto",
        px: 3,
        py: 4,
        fontSize: `${fontScale}rem`,
        lineHeight,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        textAlign: justify ? "justify" : "left",
        color: dark ? "#ddd" : "inherit",
        fontFamily: "Georgia, 'Times New Roman', serif",
      }}
    >
      {text}
    </Box>
  );
}
