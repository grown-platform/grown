/**
 * MessageBody — renders a chat message's body (Markdown) and its attachments.
 *
 * Images and GIFs render inline (capped at 320px wide, responsive).
 * Other files render as a download chip.
 * Body text is rendered with react-markdown + remark-gfm and sanitized with
 * rehype-sanitize (default schema).
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Box, Chip, Typography } from "@mui/joy";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import type { ChatAttachment } from "./types";

interface MessageBodyProps {
  body: string;
  attachments?: ChatAttachment[];
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

export function MessageBody({ body, attachments }: MessageBodyProps) {
  const trimmed = (body ?? "").trim();

  return (
    <Box>
      {/* Markdown body */}
      {trimmed && trimmed !== " " && (
        <Box
          sx={{
            "& p": { m: 0, lineHeight: 1.6 },
            "& p + p": { mt: 0.75 },
            "& strong": { fontWeight: 700 },
            "& em": { fontStyle: "italic" },
            "& del": { textDecoration: "line-through" },
            "& code": {
              fontFamily: "monospace",
              fontSize: "0.8em",
              bgcolor: "background.level2",
              px: 0.5,
              py: 0.125,
              borderRadius: "xs",
            },
            "& pre": {
              bgcolor: "background.level2",
              p: 1,
              borderRadius: "sm",
              overflowX: "auto",
              fontSize: "0.8em",
              "& code": { bgcolor: "transparent", p: 0 },
            },
            "& ul, & ol": { pl: 2.5, my: 0.5 },
            "& li": { lineHeight: 1.6 },
            "& a": { color: "primary.500", textDecoration: "underline" },
            "& img": {
              maxWidth: "min(320px, 100%)",
              borderRadius: "sm",
              display: "block",
              mt: 0.5,
            },
            // Tables (remark-gfm)
            "& table": {
              borderCollapse: "collapse",
              width: "100%",
              fontSize: "0.85em",
            },
            "& th, & td": {
              border: "1px solid",
              borderColor: "divider",
              px: 1,
              py: 0.5,
              textAlign: "left",
            },
            "& blockquote": {
              borderLeft: "3px solid",
              borderColor: "primary.300",
              pl: 1.5,
              ml: 0,
              opacity: 0.8,
            },
          }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSanitize]}
          >
            {trimmed}
          </ReactMarkdown>
        </Box>
      )}

      {/* Attachments */}
      {attachments && attachments.length > 0 && (
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            gap: 1,
            mt: trimmed && trimmed !== " " ? 0.75 : 0,
          }}
        >
          {attachments.map((att) =>
            isImageMime(att.mime_type) ? (
              <Box
                key={att.id}
                component="a"
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ display: "inline-block", lineHeight: 0 }}
              >
                <img
                  src={att.url}
                  alt={att.name}
                  loading="lazy"
                  style={{
                    maxWidth: "min(320px, 100%)",
                    maxHeight: 240,
                    objectFit: "contain",
                    borderRadius: 6,
                    display: "block",
                  }}
                />
              </Box>
            ) : (
              <Chip
                key={att.id}
                size="sm"
                variant="outlined"
                startDecorator={<AttachFileIcon sx={{ fontSize: 14 }} />}
                component="a"
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                sx={{
                  cursor: "pointer",
                  textDecoration: "none",
                  maxWidth: 240,
                }}
              >
                <Typography
                  level="body-xs"
                  sx={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {att.name}
                </Typography>
                <Typography
                  level="body-xs"
                  sx={{ opacity: 0.6, ml: 0.5, flexShrink: 0 }}
                >
                  {fmtBytes(att.size)}
                </Typography>
              </Chip>
            ),
          )}
        </Box>
      )}
    </Box>
  );
}
