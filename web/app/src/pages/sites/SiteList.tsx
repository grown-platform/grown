import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Sheet,
  IconButton,
  Button,
  Chip,
  CircularProgress,
  Card,
  CardContent,
  AspectRatio,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import WebIcon from "@mui/icons-material/Web";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  listSites,
  createSite,
  updateSite,
  deleteSite,
  serializeContent,
  emptyContent,
} from "./api";
import type { Site } from "./types";

interface SiteListProps {
  user: User;
}

export default function SiteList({ user }: SiteListProps) {
  const navigate = useNavigate();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      setSites(await listSites());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    reload();
  }, []);

  async function create() {
    const name = window.prompt("Site name", "Untitled site");
    if (name === null) return;
    const site = await createSite(
      name || "Untitled site",
      serializeContent(emptyContent()),
    );
    navigate(`/sites/edit/${site.id}`);
  }

  async function rename(site: Site) {
    const name = window.prompt("Rename site", site.name);
    if (!name || name === site.name) return;
    setSites((cur) =>
      (cur ?? []).map((s) => (s.id === site.id ? { ...s, name } : s)),
    );
    try {
      await updateSite(site.id, {
        name,
        content_json: site.content_json,
        published: site.published,
      });
    } catch {
      reload();
    }
  }

  async function remove(site: Site) {
    if (!window.confirm(`Delete “${site.name || "Untitled site"}”?`)) return;
    setSites((cur) => (cur ?? []).filter((s) => s.id !== site.id));
    try {
      await deleteSite(site.id);
    } catch {
      reload();
    }
  }

  return (
    <>
      <Header user={user} />
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
          <Typography level="h2" sx={{ flex: 1 }}>
            Sites
          </Typography>
          <Button
            variant="solid"
            color="primary"
            startDecorator={<AddIcon />}
            onClick={create}
            data-testid="new-site"
          >
            Create
          </Button>
        </Box>

        {error && (
          <Sheet
            color="danger"
            variant="soft"
            sx={{ p: 2, mb: 2, borderRadius: "md" }}
          >
            <Typography color="danger">Couldn’t load sites: {error}</Typography>
          </Sheet>
        )}
        {sites === null && !error && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        )}
        {sites !== null && sites.length === 0 && (
          <Sheet
            variant="soft"
            sx={{ p: 4, borderRadius: "md", textAlign: "center" }}
          >
            <Typography level="body-lg" sx={{ opacity: 0.7 }}>
              No sites yet. Create your first one.
            </Typography>
          </Sheet>
        )}
        {sites !== null && sites.length > 0 && (
          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            }}
          >
            {sites.map((site) => (
              <Card
                key={site.id}
                variant="outlined"
                sx={{ cursor: "pointer", "&:hover": { boxShadow: "md" } }}
                onClick={() => navigate(`/sites/edit/${site.id}`)}
                data-testid={`site-${site.id}`}
              >
                <AspectRatio
                  ratio="16/9"
                  sx={{ borderRadius: "8px", bgcolor: "primary.softBg" }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <WebIcon
                      sx={{ fontSize: 48, color: "primary.500", opacity: 0.6 }}
                    />
                  </Box>
                </AspectRatio>
                <CardContent>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Typography level="title-md" sx={{ flex: 1 }} noWrap>
                      {site.name || "Untitled site"}
                    </Typography>
                    <Dropdown>
                      <MenuButton
                        slots={{ root: IconButton }}
                        slotProps={{
                          root: {
                            size: "sm",
                            variant: "plain",
                            "aria-label": "More",
                          },
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertIcon />
                      </MenuButton>
                      <Menu
                        size="sm"
                        placement="bottom-end"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MenuItem
                          onClick={() => navigate(`/sites/edit/${site.id}`)}
                        >
                          Open
                        </MenuItem>
                        {site.published && (
                          <MenuItem
                            component="a"
                            href={`/sites/view/${site.id}`}
                            target="_blank"
                          >
                            <OpenInNewIcon sx={{ mr: 1 }} fontSize="small" />
                            View published
                          </MenuItem>
                        )}
                        <MenuItem onClick={() => rename(site)}>Rename</MenuItem>
                        <ListDivider />
                        <MenuItem color="danger" onClick={() => remove(site)}>
                          Delete
                        </MenuItem>
                      </Menu>
                    </Dropdown>
                  </Box>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      mt: 0.5,
                    }}
                  >
                    {site.published ? (
                      <Chip size="sm" color="success" variant="soft">
                        Published
                      </Chip>
                    ) : (
                      <Chip size="sm" color="neutral" variant="soft">
                        Draft
                      </Chip>
                    )}
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Box>
        )}
      </Container>
    </>
  );
}
