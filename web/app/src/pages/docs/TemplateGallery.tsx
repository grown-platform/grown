import { Box, Typography, AspectRatio, Card } from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import { TEMPLATES, templateHtml, type DocTemplate } from "./templates";

interface TemplateGalleryProps {
  onPick: (t: DocTemplate) => void;
  /** User-saved templates ("Add to gallery"), shown after the built-ins. */
  userTemplates?: DocTemplate[];
}

/** TemplateGallery is the Google-style "Start a new document" row: a Blank
 *  tile plus built-in and user-saved templates rendered as mini-previews. */
export function TemplateGallery({
  onPick,
  userTemplates = [],
}: TemplateGalleryProps) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography level="title-md" sx={{ mb: 1 }}>
        Start a new document
      </Typography>
      <Box sx={{ display: "flex", gap: 2, overflowX: "auto", pb: 1 }}>
        {[...TEMPLATES, ...userTemplates].map((t) => (
          <Box
            key={t.id}
            sx={{ width: 140, flexShrink: 0, cursor: "pointer" }}
            onClick={() => onPick(t)}
            data-testid={`template-${t.id}`}
          >
            <Card
              variant="outlined"
              sx={{
                p: 0,
                overflow: "hidden",
                "&:hover": {
                  boxShadow: "md",
                  borderColor: "primary.outlinedBorder",
                },
              }}
            >
              <AspectRatio ratio="3/4" sx={{ borderRadius: 0 }}>
                {t.id === "blank" ? (
                  <Box
                    sx={{
                      bgcolor: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <AddIcon sx={{ fontSize: 40, color: "#4285f4" }} />
                  </Box>
                ) : (
                  <Box
                    sx={{
                      bgcolor: "#fff",
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    <Box
                      dangerouslySetInnerHTML={{ __html: templateHtml(t) }}
                      sx={{
                        position: "absolute",
                        top: 8,
                        left: 10,
                        width: "250%",
                        transform: "scale(0.4)",
                        transformOrigin: "top left",
                        pointerEvents: "none",
                        fontSize: 12,
                        lineHeight: 1.4,
                        color: "#202124",
                        "& h1": { fontSize: 18 },
                        "& h2": { fontSize: 14 },
                        "& *": { maxWidth: "100%" },
                      }}
                    />
                  </Box>
                )}
              </AspectRatio>
            </Card>
            <Typography
              level="body-sm"
              sx={{ fontWeight: 500, mt: 0.5 }}
              noWrap
            >
              {t.name}
            </Typography>
            {t.subtitle && (
              <Typography level="body-xs" sx={{ opacity: 0.6 }} noWrap>
                {t.subtitle}
              </Typography>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
