import { useMemo } from "react";
import { Box, Chip, Typography } from "@mui/joy";
import { SlideView } from "../../pages/slides/SlideView";
import { parseDeck } from "../../pages/slides/model";
import { diffDecks, summarizeDeckDiff } from "./diff";
import { VersionHistoryPanel, type VersionHistoryPanelProps } from "./VersionHistoryPanel";

/** DeckVersionPreview renders a stored deck read-only as a column of slide
 *  thumbnails, tagging the slides that changed since the previous version. */
export function DeckVersionPreview({ data, older }: { data: string; older: string | null }) {
  const deck = useMemo(() => parseDeck(data), [data]);
  const diff = useMemo(() => (older === null ? null : diffDecks(older, data)), [older, data]);
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, p: 0.5 }} data-testid="deck-version-slides">
      {deck.slides.map((s, i) => {
        const tag = diff?.addedIds.has(s.id) ? "new" : diff?.changed.has(s.id) ? "changed" : null;
        return (
          <Box key={s.id} data-testid="deck-version-slide" data-changed={tag ?? undefined}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
              <Typography level="body-xs" sx={{ color: "#5f6368" }}>
                Slide {i + 1}
              </Typography>
              {tag && (
                <Chip size="sm" variant="soft" color={tag === "new" ? "success" : "warning"}>
                  {tag}
                </Chip>
              )}
            </Box>
            <Box
              sx={{
                border: "2px solid",
                borderColor: tag ? "#f0b429" : "#dadce0",
                borderRadius: 4,
                overflow: "hidden",
                width: "fit-content",
              }}
            >
              <SlideView slide={s} width={400} />
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

type DeckVersionHistoryProps = Omit<VersionHistoryPanelProps, "kind" | "renderPreview" | "summarize">;

/** File ▸ Version history for Slides. */
export function DeckVersionHistory(props: DeckVersionHistoryProps) {
  return (
    <VersionHistoryPanel
      {...props}
      kind="slides"
      renderPreview={(data, older) => <DeckVersionPreview data={data} older={older} />}
      summarize={(older, newer) => summarizeDeckDiff(diffDecks(older, newer))}
    />
  );
}
