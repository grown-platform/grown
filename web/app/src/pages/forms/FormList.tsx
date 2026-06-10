import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Sheet,
  IconButton,
  CircularProgress,
  Button,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
  AspectRatio,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import SortIcon from "@mui/icons-material/Sort";
import AssignmentIcon from "@mui/icons-material/Assignment";
import DescriptionIcon from "@mui/icons-material/Description";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { listForms, createForm, trashForm } from "./api";
import type { Form } from "./types";
import { TEMPLATES, FORMS_ACCENT, type FormTemplate } from "./helpers";

interface Props {
  user: User;
}

type SortKey = "modified" | "title";

function relative(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function FormList({ user }: Props) {
  const navigate = useNavigate();
  const [forms, setForms] = useState<Form[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("modified");
  const [showTemplates, setShowTemplates] = useState(true);
  const [creating, setCreating] = useState(false);

  async function reload() {
    try {
      setError(null);
      setForms(await listForms());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    reload();
  }, []);

  const sorted = useMemo(() => {
    const list = [...(forms ?? [])];
    if (sort === "title") {
      list.sort((a, b) =>
        (a.title || "Untitled form").localeCompare(b.title || "Untitled form"),
      );
    } else {
      list.sort((a, b) =>
        (b.updated_at || "").localeCompare(a.updated_at || ""),
      );
    }
    return list;
  }, [forms, sort]);

  async function blankForm() {
    if (creating) return;
    setCreating(true);
    try {
      const f = await createForm({ title: "Untitled form" });
      navigate(`/forms/d/${f.id}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  async function fromTemplate(t: FormTemplate) {
    if (creating) return;
    setCreating(true);
    try {
      const f = await createForm(t.input);
      navigate(`/forms/d/${f.id}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  async function onTrash(f: Form) {
    if (!window.confirm(`Move "${f.title || "Untitled form"}" to trash?`))
      return;
    setForms((cur) => (cur ?? []).filter((x) => x.id !== f.id));
    try {
      await trashForm(f.id);
    } catch {
      reload();
    }
  }

  async function onDuplicate(f: Form) {
    setCreating(true);
    try {
      const copy = await createForm({
        title: `Copy of ${f.title || "Untitled form"}`,
        description: f.description,
        questions: f.questions,
      });
      navigate(`/forms/d/${copy.id}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  return (
    <>
      <Header user={user} />

      {/* Template gallery band */}
      <Sheet variant="soft" sx={{ bgcolor: "background.level1" }}>
        <Container maxWidth="lg" sx={{ py: 2.5 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              mb: showTemplates ? 1.5 : 0,
            }}
          >
            <Typography level="title-sm" sx={{ flex: 1 }}>
              Start a new form
            </Typography>
            <Dropdown>
              <MenuButton
                slots={{ root: IconButton }}
                slotProps={{
                  root: {
                    size: "sm",
                    variant: "plain",
                    color: "neutral",
                    "aria-label": "More actions",
                  },
                }}
              >
                <MoreVertIcon />
              </MenuButton>
              <Menu size="sm" placement="bottom-end">
                <MenuItem onClick={() => setShowTemplates((v) => !v)}>
                  {showTemplates ? "Hide all templates" : "Show all templates"}
                </MenuItem>
              </Menu>
            </Dropdown>
          </Box>

          {showTemplates && (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                gap: { xs: 1.5, sm: 2 },
              }}
            >
              {/* Blank */}
              <TemplateCard
                label="Blank form"
                accent={FORMS_ACCENT}
                onClick={blankForm}
                icon={<AddIcon sx={{ fontSize: 44, color: FORMS_ACCENT }} />}
                disabled={creating}
              />
              {TEMPLATES.map((t) => (
                <TemplateCard
                  key={t.id}
                  label={t.name}
                  category={t.category}
                  accent={FORMS_ACCENT}
                  onClick={() => fromTemplate(t)}
                  icon={
                    <DescriptionIcon
                      sx={{ fontSize: 40, color: FORMS_ACCENT, opacity: 0.85 }}
                    />
                  }
                  disabled={creating}
                />
              ))}
            </Box>
          )}
        </Container>
      </Sheet>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <Typography level="title-md" sx={{ flex: 1 }}>
            Recent forms
          </Typography>
          <Dropdown>
            <MenuButton
              variant="plain"
              color="neutral"
              size="sm"
              startDecorator={<SortIcon />}
              aria-label="Sort options"
            >
              {sort === "title" ? "Title" : "Last modified"}
            </MenuButton>
            <Menu size="sm" placement="bottom-end">
              <MenuItem
                selected={sort === "modified"}
                onClick={() => setSort("modified")}
              >
                Last modified
              </MenuItem>
              <MenuItem
                selected={sort === "title"}
                onClick={() => setSort("title")}
              >
                Title
              </MenuItem>
            </Menu>
          </Dropdown>
          <Button
            size="sm"
            startDecorator={<AddIcon />}
            onClick={blankForm}
            loading={creating}
            sx={{
              ml: 1.5,
              bgcolor: FORMS_ACCENT,
              "&:hover": { bgcolor: "#6a4159" },
            }}
            data-testid="new-form"
          >
            New form
          </Button>
        </Box>

        {error && (
          <Sheet
            color="danger"
            variant="soft"
            sx={{ p: 2, mb: 2, borderRadius: "md" }}
          >
            <Typography color="danger">Couldn’t load forms: {error}</Typography>
          </Sheet>
        )}

        {forms === null && !error && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        )}

        {forms !== null && sorted.length === 0 && (
          <Sheet
            variant="soft"
            sx={{ p: 5, borderRadius: "md", textAlign: "center" }}
          >
            <AssignmentIcon
              sx={{ fontSize: 48, color: FORMS_ACCENT, opacity: 0.5, mb: 1 }}
            />
            <Typography level="body-lg" sx={{ opacity: 0.7 }}>
              No forms yet. Create one from a template above or start blank.
            </Typography>
          </Sheet>
        )}

        {sorted.length > 0 && (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 2,
            }}
          >
            {sorted.map((f) => (
              <Sheet
                key={f.id}
                variant="outlined"
                data-testid={`form-${f.id}`}
                sx={{
                  borderRadius: "md",
                  overflow: "hidden",
                  cursor: "pointer",
                  "&:hover": { boxShadow: "sm", borderColor: FORMS_ACCENT },
                }}
                onClick={() => navigate(`/forms/d/${f.id}`)}
              >
                <AspectRatio ratio="4/3" sx={{ bgcolor: "background.level1" }}>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <AssignmentIcon
                      sx={{ fontSize: 56, color: FORMS_ACCENT, opacity: 0.85 }}
                    />
                  </Box>
                </AspectRatio>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    px: 1.5,
                    py: 1.25,
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography level="body-sm" noWrap sx={{ fontWeight: 500 }}>
                      {f.title || "Untitled form"}
                    </Typography>
                    <Typography level="body-xs" sx={{ opacity: 0.6 }} noWrap>
                      {f.response_count} response
                      {f.response_count === 1 ? "" : "s"} ·{" "}
                      {relative(f.updated_at)}
                    </Typography>
                  </Box>
                  <Box onClick={(e) => e.stopPropagation()}>
                    <Dropdown>
                      <MenuButton
                        slots={{ root: IconButton }}
                        slotProps={{
                          root: {
                            size: "sm",
                            variant: "plain",
                            color: "neutral",
                            "aria-label": "More actions",
                          },
                        }}
                      >
                        <MoreVertIcon />
                      </MenuButton>
                      <Menu size="sm" placement="bottom-end">
                        <MenuItem onClick={() => navigate(`/forms/d/${f.id}`)}>
                          Open
                        </MenuItem>
                        <MenuItem
                          onClick={() => navigate(`/forms/d/${f.id}/viewform`)}
                        >
                          Preview
                        </MenuItem>
                        <MenuItem
                          onClick={() => navigate(`/forms/d/${f.id}/responses`)}
                        >
                          Responses
                        </MenuItem>
                        <ListDivider />
                        <MenuItem onClick={() => onDuplicate(f)}>
                          Make a copy
                        </MenuItem>
                        <ListDivider />
                        <MenuItem color="danger" onClick={() => onTrash(f)}>
                          Move to trash
                        </MenuItem>
                      </Menu>
                    </Dropdown>
                  </Box>
                </Box>
              </Sheet>
            ))}
          </Box>
        )}
      </Container>
    </>
  );
}

function TemplateCard({
  label,
  category,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  category?: string;
  accent: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Sheet
      variant="outlined"
      role="button"
      tabIndex={0}
      aria-label={`Create ${label}`}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      sx={{
        borderRadius: "md",
        overflow: "hidden",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        "&:hover": disabled
          ? undefined
          : { boxShadow: "sm", borderColor: "primary.outlinedBorder" },
      }}
    >
      <AspectRatio ratio="4/3" sx={{ bgcolor: "background.surface" }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </Box>
      </AspectRatio>
      <Box sx={{ px: 1.25, py: 1 }}>
        <Typography level="body-sm" noWrap sx={{ fontWeight: 500 }}>
          {label}
        </Typography>
        {category && (
          <Typography level="body-xs" sx={{ opacity: 0.6 }}>
            {category}
          </Typography>
        )}
      </Box>
    </Sheet>
  );
}
