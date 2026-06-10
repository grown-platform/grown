import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container,
  Typography,
  Button,
  Sheet,
  Box,
  CircularProgress,
  IconButton,
  Dropdown,
  MenuButton,
  Menu,
  MenuItem,
  ListDivider,
  Card,
  AspectRatio,
  Select,
  Option,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import SlideshowIcon from "@mui/icons-material/Slideshow";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  listDecks,
  createDeck,
  renameDeck,
  trashDeck,
  saveDeck,
  listDecksSharedWithMe,
} from "./api";
import type { Deck } from "./types";
import { DECK_TEMPLATES, type DeckTemplate } from "./templates";

export function DeckList({ user }: { user: User }) {
  const navigate = useNavigate();
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<"mine" | "shared">("mine");

  useEffect(() => {
    let cancelled = false;
    setDecks(null);
    const load = view === "shared" ? listDecksSharedWithMe() : listDecks();
    load
      .then((d) => !cancelled && setDecks(d))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [view]);

  async function onCreate() {
    setCreating(true);
    try {
      const d = await createDeck();
      navigate(`/slides/d/${d.id}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }
  async function onPickTemplate(t: DeckTemplate) {
    try {
      const d = await createDeck(t.id === "blank" ? "" : t.name);
      if (t.id !== "blank")
        await saveDeck(d.id, JSON.stringify(t.build())).catch(() => {});
      navigate(`/slides/d/${d.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function onTrash(id: string) {
    await trashDeck(id);
    setDecks((cur) => (cur ?? []).filter((d) => d.id !== id));
  }
  async function onRename(d: Deck) {
    const t = window.prompt("Rename presentation", d.title);
    if (t && t !== d.title) {
      const updated = await renameDeck(d.id, t);
      setDecks((cur) => (cur ?? []).map((x) => (x.id === d.id ? updated : x)));
    }
  }

  return (
    <>
      <Header user={user} />
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
          <Typography level="h2" sx={{ flex: 1 }}>
            Slides
          </Typography>
          <Select
            size="sm"
            value={view}
            onChange={(_, v) => v && setView(v)}
            sx={{ minWidth: 160 }}
          >
            <Option value="mine">My presentations</Option>
            <Option value="shared">Shared with me</Option>
          </Select>
          <Button
            startDecorator={<AddIcon />}
            loading={creating}
            onClick={onCreate}
            data-testid="new-deck"
          >
            New presentation
          </Button>
        </Box>

        {/* Start a new presentation — template gallery (hidden in "shared" view). */}
        {view === "mine" && (
          <Box sx={{ mb: 3 }}>
            <Typography level="title-md" sx={{ mb: 1 }}>
              Start a new presentation
            </Typography>
            <Box sx={{ display: "flex", gap: 2, overflowX: "auto", pb: 1 }}>
              {DECK_TEMPLATES.map((t) => (
                <Box
                  key={t.id}
                  sx={{ width: 150, flexShrink: 0, cursor: "pointer" }}
                  onClick={() => onPickTemplate(t)}
                  data-testid={`deck-template-${t.id}`}
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
                    <AspectRatio ratio="16/9" sx={{ borderRadius: 0 }}>
                      <Box
                        sx={{
                          bgcolor:
                            t.id === "bold-dark" || t.id === "pitch"
                              ? "#202124"
                              : "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {t.id === "blank" ? (
                          <AddIcon sx={{ fontSize: 30, color: t.accent }} />
                        ) : (
                          <Box
                            sx={{
                              width: 60,
                              height: 4,
                              bgcolor: t.accent,
                              borderRadius: 2,
                            }}
                          />
                        )}
                      </Box>
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
        )}

        {error && (
          <Sheet
            color="danger"
            variant="soft"
            sx={{ p: 2, mb: 2, borderRadius: "md" }}
          >
            <Typography color="danger">
              Couldn’t load presentations: {error}
            </Typography>
          </Sheet>
        )}
        {decks === null && !error && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        )}
        {decks !== null && decks.length === 0 && (
          <Sheet
            variant="soft"
            sx={{ p: 4, borderRadius: "md", textAlign: "center" }}
          >
            <Typography level="body-lg" sx={{ opacity: 0.7 }}>
              {view === "shared"
                ? "No presentations have been shared with you yet."
                : "No presentations yet. Create your first one."}
            </Typography>
          </Sheet>
        )}

        <Sheet
          variant="outlined"
          sx={{ borderRadius: "md", overflow: "hidden" }}
        >
          {decks?.map((d, i) => (
            <Box
              key={d.id}
              data-testid={`deck-${d.id}`}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                px: 2,
                py: 1.25,
                cursor: "pointer",
                borderTop: i === 0 ? "none" : "1px solid",
                borderColor: "divider",
                "&:hover": { bgcolor: "background.level1" },
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  flex: 1,
                  minWidth: 0,
                }}
                onClick={() => navigate(`/slides/d/${d.id}`)}
              >
                <SlideshowIcon sx={{ color: "#D9A441" }} />
                <Typography
                  level="body-sm"
                  noWrap
                  sx={{ flex: 1, fontWeight: 500 }}
                >
                  {d.title}
                </Typography>
                <Typography
                  level="body-xs"
                  sx={{ opacity: 0.6, width: 110, textAlign: "right" }}
                >
                  {new Date(d.updated_at).toLocaleDateString()}
                </Typography>
              </Box>
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
                >
                  <MoreVertIcon />
                </MenuButton>
                <Menu size="sm" placement="bottom-end">
                  <MenuItem onClick={() => onRename(d)}>Rename</MenuItem>
                  <MenuItem
                    onClick={() => window.open(`/slides/d/${d.id}`, "_blank")}
                  >
                    Open in new tab
                  </MenuItem>
                  <ListDivider />
                  <MenuItem color="danger" onClick={() => onTrash(d.id)}>
                    Remove
                  </MenuItem>
                </Menu>
              </Dropdown>
            </Box>
          ))}
        </Sheet>
      </Container>
    </>
  );
}
