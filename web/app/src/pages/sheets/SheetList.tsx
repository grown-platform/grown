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
  Select,
  Option,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import TableChartIcon from "@mui/icons-material/TableChart";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { AspectRatio, Card } from "@mui/joy";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  listSheets,
  createSheet,
  renameSheet,
  trashSheet,
  saveSheet,
  listSheetsSharedWithMe,
} from "./api";
import type { Sheet as SheetT } from "./types";
import { SHEET_TEMPLATES, type SheetTemplate } from "./templates";

interface SheetListProps {
  user: User;
}

export function SheetList({ user }: SheetListProps) {
  const navigate = useNavigate();
  const [sheets, setSheets] = useState<SheetT[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<"mine" | "shared">("mine");

  useEffect(() => {
    let cancelled = false;
    setSheets(null);
    const load = view === "shared" ? listSheetsSharedWithMe() : listSheets();
    load
      .then((s) => !cancelled && setSheets(s))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [view]);

  async function onCreate() {
    setCreating(true);
    try {
      const s = await createSheet();
      navigate(`/sheets/d/${s.id}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  async function onPickTemplate(t: SheetTemplate) {
    try {
      const s = await createSheet(t.id === "blank" ? "" : t.name);
      if (t.id !== "blank")
        await saveSheet(s.id, JSON.stringify(t.build())).catch(() => {});
      navigate(`/sheets/d/${s.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function onTrash(id: string) {
    await trashSheet(id);
    setSheets((cur) => (cur ?? []).filter((s) => s.id !== id));
  }
  async function onRename(s: SheetT) {
    const t = window.prompt("Rename spreadsheet", s.title);
    if (t && t !== s.title) {
      const updated = await renameSheet(s.id, t);
      setSheets((cur) => (cur ?? []).map((x) => (x.id === s.id ? updated : x)));
    }
  }

  return (
    <>
      <Header user={user} />
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
          <Typography level="h2" sx={{ flex: 1 }}>
            Sheets
          </Typography>
          <Select
            size="sm"
            value={view}
            onChange={(_, v) => v && setView(v)}
            sx={{ minWidth: 160 }}
          >
            <Option value="mine">My spreadsheets</Option>
            <Option value="shared">Shared with me</Option>
          </Select>
          <Button
            startDecorator={<AddIcon />}
            loading={creating}
            onClick={onCreate}
            data-testid="new-sheet"
          >
            New spreadsheet
          </Button>
        </Box>

        {/* Start a new spreadsheet — template gallery (hidden in "shared" view). */}
        {view === "mine" && (
          <Box sx={{ mb: 3 }}>
            <Typography level="title-md" sx={{ mb: 1 }}>
              Start a new spreadsheet
            </Typography>
            <Box sx={{ display: "flex", gap: 2, overflowX: "auto", pb: 1 }}>
              {SHEET_TEMPLATES.map((t) => (
                <Box
                  key={t.id}
                  sx={{ width: 130, flexShrink: 0, cursor: "pointer" }}
                  onClick={() => onPickTemplate(t)}
                  data-testid={`sheet-template-${t.id}`}
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
                    <AspectRatio ratio="4/3" sx={{ borderRadius: 0 }}>
                      <Box
                        sx={{
                          bgcolor: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {t.id === "blank" ? (
                          <AddIcon sx={{ fontSize: 36, color: "#0f9d58" }} />
                        ) : (
                          <TableChartIcon
                            sx={{ fontSize: 34, color: "#0f9d58" }}
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
              Couldn’t load spreadsheets: {error}
            </Typography>
          </Sheet>
        )}
        {sheets === null && !error && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        )}
        {sheets !== null && sheets.length === 0 && (
          <Sheet
            variant="soft"
            sx={{ p: 4, borderRadius: "md", textAlign: "center" }}
          >
            <Typography level="body-lg" sx={{ opacity: 0.7 }}>
              {view === "shared"
                ? "No spreadsheets have been shared with you yet."
                : "No spreadsheets yet. Create your first one."}
            </Typography>
          </Sheet>
        )}

        <Sheet
          variant="outlined"
          sx={{ borderRadius: "md", overflow: "hidden" }}
        >
          {sheets?.map((s, i) => (
            <Box
              key={s.id}
              data-testid={`sheet-${s.id}`}
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
                onClick={() => navigate(`/sheets/d/${s.id}`)}
              >
                <TableChartIcon sx={{ color: "#1D8348" }} />
                <Typography
                  level="body-sm"
                  noWrap
                  sx={{ flex: 1, fontWeight: 500 }}
                >
                  {s.title}
                </Typography>
                <Typography
                  level="body-xs"
                  sx={{ opacity: 0.6, width: 110, textAlign: "right" }}
                >
                  {new Date(s.updated_at).toLocaleDateString()}
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
                  <MenuItem onClick={() => onRename(s)}>Rename</MenuItem>
                  <MenuItem
                    onClick={() => window.open(`/sheets/d/${s.id}`, "_blank")}
                  >
                    Open in new tab
                  </MenuItem>
                  <ListDivider />
                  <MenuItem color="danger" onClick={() => onTrash(s.id)}>
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
