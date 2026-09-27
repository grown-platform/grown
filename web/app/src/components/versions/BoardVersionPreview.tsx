import { useEffect, useRef, useState } from "react";
import { Box, CircularProgress, Typography } from "@mui/joy";
import { exportToSvg } from "@excalidraw/excalidraw";
import { diffScenes, summarizeSceneDiff } from "./diff";
import { VersionHistoryPanel, type VersionHistoryPanelProps } from "./VersionHistoryPanel";

/* eslint-disable @typescript-eslint/no-explicit-any -- Excalidraw scene JSON is loosely typed. */

/** BoardVersionPreview renders a stored Excalidraw scene read-only as SVG. */
export function BoardVersionPreview({ data }: { data: string; older?: string | null }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<"loading" | "empty" | "ok" | "error">("loading");
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    host.current?.replaceChildren();
    let scene: any = {};
    try {
      scene = JSON.parse(data);
    } catch {
      setState("error");
      return;
    }
    const elements = (Array.isArray(scene.elements) ? scene.elements : []).filter((e: any) => !e?.isDeleted);
    if (!elements.length) {
      setState("empty");
      return;
    }
    exportToSvg({
      elements,
      files: scene.files ?? {},
      appState: { exportBackground: true, viewBackgroundColor: "#ffffff" } as any,
      exportPadding: 16,
    })
      .then((svg: SVGSVGElement) => {
        if (cancelled || !host.current) return;
        svg.style.maxWidth = "100%";
        svg.style.height = "auto";
        host.current.replaceChildren(svg);
        setState("ok");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [data]);
  return (
    <Box>
      {state === "loading" && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress size="sm" />
        </Box>
      )}
      {state === "empty" && (
        <Typography level="body-sm" sx={{ opacity: 0.6, p: 1 }}>
          This version is an empty board.
        </Typography>
      )}
      {state === "error" && (
        <Typography level="body-sm" color="danger" sx={{ p: 1 }}>
          Could not render this version.
        </Typography>
      )}
      <Box ref={host} data-testid="board-version-svg" />
    </Box>
  );
}

type BoardVersionHistoryProps = Omit<VersionHistoryPanelProps, "kind" | "renderPreview" | "summarize">;

/** File ▸ Version history for Whiteboards. */
export function BoardVersionHistory(props: BoardVersionHistoryProps) {
  return (
    <VersionHistoryPanel
      {...props}
      kind="whiteboards"
      renderPreview={(data, older) => <BoardVersionPreview data={data} older={older} />}
      summarize={(older, newer) => summarizeSceneDiff(diffScenes(older, newer))}
    />
  );
}
