import { Box, Typography, Button, Divider, Sheet } from "@mui/joy";
import type { Block, Page } from "./types";

/** BlockView renders a single block read-only. */
function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "heading":
      return (
        <Typography level="h2" sx={{ mt: 2, mb: 1 }}>
          {block.text || "Heading"}
        </Typography>
      );
    case "text":
      return (
        <Typography level="body-md" sx={{ whiteSpace: "pre-wrap", mb: 1.5 }}>
          {block.text}
        </Typography>
      );
    case "image":
      return block.url ? (
        <Box
          component="img"
          src={block.url}
          alt={block.text || ""}
          sx={{
            display: "block",
            maxWidth: "100%",
            borderRadius: "8px",
            my: 1.5,
          }}
        />
      ) : (
        <Sheet
          variant="soft"
          sx={{
            p: 3,
            my: 1.5,
            borderRadius: "md",
            textAlign: "center",
            opacity: 0.6,
          }}
        >
          <Typography level="body-sm">No image URL</Typography>
        </Sheet>
      );
    case "button":
      return (
        <Box sx={{ my: 1.5 }}>
          <Button
            component="a"
            href={block.url || "#"}
            target={block.url ? "_blank" : undefined}
            rel="noopener noreferrer"
            variant="solid"
          >
            {block.text || "Button"}
          </Button>
        </Box>
      );
    case "divider":
      return <Divider sx={{ my: 2 }} />;
    case "embed":
      return block.url ? (
        <Box
          component="iframe"
          src={block.url}
          title="Embedded content"
          sx={{
            width: "100%",
            maxWidth: "100%",
            minHeight: { xs: 220, sm: 360 },
            border: "none",
            borderRadius: "8px",
            my: 1.5,
            display: "block",
          }}
        />
      ) : (
        <Sheet
          variant="soft"
          sx={{
            p: 3,
            my: 1.5,
            borderRadius: "md",
            textAlign: "center",
            opacity: 0.6,
          }}
        >
          <Typography level="body-sm">No embed URL</Typography>
        </Sheet>
      );
    default:
      return null;
  }
}

/** PageView renders a full page (a vertical stack of blocks), read-only. */
export function PageView({ page }: { page: Page }) {
  return (
    <Box>
      {page.blocks.map((b) => (
        <BlockView key={b.id} block={b} />
      ))}
      {page.blocks.length === 0 && (
        <Typography
          level="body-sm"
          sx={{ opacity: 0.6, py: 4, textAlign: "center" }}
        >
          This page is empty.
        </Typography>
      )}
    </Box>
  );
}
