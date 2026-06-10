import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  CircularProgress,
  Sheet,
  List,
  ListItem,
  ListItemButton,
} from "@mui/joy";
import { getPublishedSite, parseContent } from "./api";
import type { Site, SiteContent } from "./types";
import { PageView } from "./PageView";

/** SiteView is the public, no-account view of a published site
 *  (route /sites/view/:siteId). Unpublished or missing sites 404. */
export default function SiteView() {
  const { siteId = "" } = useParams();
  const [site, setSite] = useState<Site | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePage, setActivePage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getPublishedSite(siteId)
      .then((s) => !cancelled && setSite(s))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  const content: SiteContent | null = useMemo(
    () => (site ? parseContent(site.content_json) : null),
    [site],
  );

  if (error) {
    return (
      <Container sx={{ py: 8 }}>
        <Typography level="h3">This site isn’t available</Typography>
        <Typography sx={{ opacity: 0.7 }}>
          It may be unpublished or no longer exist.
        </Typography>
      </Container>
    );
  }
  if (!site || !content) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const page = content.pages[activePage] ?? content.pages[0];

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.body" }}>
      <Sheet
        variant="solid"
        color="primary"
        sx={{ px: { xs: 2, sm: 3 }, py: 2 }}
        invertedColors
      >
        <Container maxWidth="md" sx={{ px: 0 }}>
          <Typography level="h3">{site.name || "Untitled site"}</Typography>
          {content.pages.length > 1 && (
            <List
              orientation="horizontal"
              size="sm"
              sx={{ mt: 1, "--ListItem-radius": "8px", flexWrap: "wrap" }}
            >
              {content.pages.map((p, i) => (
                <ListItem key={p.id}>
                  <ListItemButton
                    selected={i === activePage}
                    onClick={() => setActivePage(i)}
                  >
                    {p.title || "Untitled"}
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </Container>
      </Sheet>
      <Container maxWidth="md" sx={{ py: 4 }}>
        <PageView page={page} />
      </Container>
    </Box>
  );
}
