import { useEffect, useRef, useState, useCallback } from "react";
import {
  Box,
  Input,
  List,
  ListItem,
  ListItemButton,
  ListSubheader,
  Sheet,
  Typography,
  CircularProgress,
} from "@mui/joy";
import * as Icons from "@mui/icons-material";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { search as apiSearch } from "../api/client";
import type { SearchGroup, SearchResult } from "../api/types";

// Human-readable label and icon for each result type.
const TYPE_META: Record<
  string,
  { label: string; iconName: string; color: string }
> = {
  SEARCH_RESULT_TYPE_DRIVE: {
    label: "Drive",
    iconName: "Folder",
    color: "#3F88C5",
  },
  SEARCH_RESULT_TYPE_DOCS: {
    label: "Docs",
    iconName: "Description",
    color: "#4472C4",
  },
  SEARCH_RESULT_TYPE_SHEETS: {
    label: "Sheets",
    iconName: "TableChart",
    color: "#34A853",
  },
  SEARCH_RESULT_TYPE_SLIDES: {
    label: "Slides",
    iconName: "Slideshow",
    color: "#FBBC05",
  },
  SEARCH_RESULT_TYPE_CONTACTS: {
    label: "Contacts",
    iconName: "Contacts",
    color: "#5B9279",
  },
  SEARCH_RESULT_TYPE_KEEP: {
    label: "Keep",
    iconName: "Lightbulb",
    color: "#F4C430",
  },
  SEARCH_RESULT_TYPE_CALENDAR: {
    label: "Calendar",
    iconName: "CalendarToday",
    color: "#E0777D",
  },
  SEARCH_RESULT_TYPE_MAIL: {
    label: "Mail",
    iconName: "Mail",
    color: "#EA4335",
  },
};

interface SearchOverlayProps {
  /** Called when the user navigates to a result (to close the overlay). */
  onClose: () => void;
}

/**
 * SearchOverlay renders the search input + results dropdown.
 * Opens on focus; closes on Escape or outside click.
 */
export function SearchOverlay({ onClose }: SearchOverlayProps) {
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  // Flat list of results for keyboard navigation.
  const flat = groups.flatMap((g) => g.results);
  const [focused, setFocused] = useState(-1);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const resp = await apiSearch(q, 50);
      setGroups(resp.groups ?? []);
    } catch {
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce input changes.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => runSearch(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && containerRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
    setGroups([]);
    setFocused(-1);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocused((f) => Math.min(f + 1, flat.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocused((f) => Math.max(f - 1, 0));
      return;
    }
    if (e.key === "Enter" && focused >= 0 && flat[focused]) {
      e.preventDefault();
      navigate(flat[focused].url);
      close();
    }
  }

  const showDropdown =
    open && query.trim().length > 0 && (loading || groups.length > 0);

  return (
    <Box
      ref={containerRef}
      sx={{ position: "relative", flexGrow: 1, maxWidth: 520, mx: 2 }}
    >
      <Input
        slotProps={{ input: { ref: inputRef } }}
        size="sm"
        placeholder="Search across workspace…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setFocused(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        startDecorator={
          loading ? (
            <CircularProgress
              size="sm"
              thickness={2}
              sx={{ "--CircularProgress-size": "16px" }}
            />
          ) : (
            <Icons.SearchOutlined fontSize="small" />
          )
        }
        endDecorator={
          query ? (
            <Icons.Close
              fontSize="small"
              sx={{
                cursor: "pointer",
                opacity: 0.6,
                "&:hover": { opacity: 1 },
              }}
              onClick={() => {
                setQuery("");
                setGroups([]);
                setFocused(-1);
                inputRef.current?.focus();
              }}
            />
          ) : null
        }
        sx={{ width: "100%", minWidth: 200 }}
        aria-label="Global search"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        role="combobox"
      />

      {showDropdown && (
        <Sheet
          variant="outlined"
          sx={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 1300,
            borderRadius: "sm",
            boxShadow: "md",
            maxHeight: 480,
            overflowY: "auto",
          }}
          role="listbox"
          aria-label="Search results"
        >
          {loading && groups.length === 0 && (
            <Box sx={{ py: 2, display: "flex", justifyContent: "center" }}>
              <CircularProgress size="sm" />
            </Box>
          )}

          {!loading && groups.length === 0 && query.trim() && (
            <Box sx={{ px: 2, py: 1.5 }}>
              <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                No results for "{query}"
              </Typography>
            </Box>
          )}

          <List size="sm" sx={{ "--List-padding": "0px" }}>
            {groups.map((group) => {
              const meta = TYPE_META[group.type] ?? {
                label: group.type,
                iconName: "Search",
                color: "#888",
              };
              const IconComponent = (
                Icons as Record<
                  string,
                  React.ComponentType<{ sx?: object; fontSize?: string }>
                >
              )[meta.iconName];
              return (
                <Box key={group.type} component="li" sx={{ listStyle: "none" }}>
                  <ListSubheader
                    sticky
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.75,
                      py: 0.5,
                      px: 1.5,
                      fontSize: "xs",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: meta.color,
                      bgcolor: "background.surface",
                    }}
                  >
                    {IconComponent && (
                      <IconComponent sx={{ fontSize: 14, color: meta.color }} />
                    )}
                    {meta.label}
                  </ListSubheader>
                  {group.results.map((result) => {
                    const flatIdx = flat.indexOf(result);
                    return (
                      <ResultRow
                        key={result.id}
                        result={result}
                        isFocused={flatIdx === focused}
                        onNavigate={() => {
                          close();
                        }}
                      />
                    );
                  })}
                </Box>
              );
            })}
          </List>
        </Sheet>
      )}
    </Box>
  );
}

interface ResultRowProps {
  result: SearchResult;
  isFocused: boolean;
  onNavigate: () => void;
}

function ResultRow({ result, isFocused, onNavigate }: ResultRowProps) {
  return (
    <ListItem>
      <ListItemButton
        component={RouterLink}
        to={result.url}
        onClick={onNavigate}
        selected={isFocused}
        sx={{
          borderRadius: "xs",
          "&:hover": { bgcolor: "background.level1" },
        }}
      >
        <Box sx={{ minWidth: 0, width: "100%" }}>
          <Typography level="body-sm" noWrap sx={{ fontWeight: 500 }}>
            {result.title || "(Untitled)"}
          </Typography>
          {result.snippet && (
            <Typography level="body-xs" noWrap sx={{ opacity: 0.6 }}>
              {result.snippet}
            </Typography>
          )}
        </Box>
      </ListItemButton>
    </ListItem>
  );
}
