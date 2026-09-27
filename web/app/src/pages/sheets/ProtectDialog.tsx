/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet sheets are loosely typed. */
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  FormHelperText,
  FormLabel,
  IconButton,
  Input,
  List,
  ListItem,
  ListItemContent,
  Modal,
  ModalClose,
  ModalDialog,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from "@mui/joy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { searchDirectory, type Member } from "../../api/directory";
import type { CellRect } from "./cellRange";
import {
  addProtectedRange,
  canManage,
  changeProtectedRange,
  deleteProtectedRanges,
  protectSheet,
  sheetProtection,
  unprotectSheet,
  validRangeName,
  type EditContext,
  type ProtectionModel,
} from "./protection";
import { parseRef, rectRef } from "./xlsx/ooxml";

interface ProtectDialogProps {
  open: boolean;
  onClose: () => void;
  sheet: any;
  selection: CellRect | null;
  ctx: EditContext;
  onSave: (model: ProtectionModel) => void;
}

interface Draft {
  kind: "range" | "sheet";
  /** Id of the range being edited, or null for a new one. */
  id: string | null;
  name: string;
  ranges: string;
  description: string;
  except: string;
  allowFormat: boolean;
  users: Member[];
}

function parseRanges(text: string): CellRect[] | null {
  const parts = text.split(/[,;\s]+/).filter(Boolean);
  if (!parts.length) return [];
  const out: CellRect[] = [];
  for (const p of parts) {
    const r = parseRef(p);
    if (!r) return null;
    out.push(r);
  }
  return out;
}

const rangesText = (rs: CellRect[]) => rs.map((r) => rectRef(r)).join(", ");

/** Data ▸ Protect sheets and ranges. */
export function ProtectDialog({ open, onClose, sheet, selection, ctx, onSave }: ProtectDialogProps) {
  const [model, setModel] = useState<ProtectionModel>(() => sheetProtection(sheet));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [people, setPeople] = useState<Member[]>([]);

  useEffect(() => {
    if (!open) return;
    setModel(sheetProtection(sheet));
    setDraft(null);
    searchDirectory("")
      .then(setPeople)
      .catch(() => setPeople([]));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const who = (id: string) => byId.get(id)?.name || byId.get(id)?.email || id;
  const toMembers = (ids: string[]) => ids.map((id) => byId.get(id) ?? { id, name: id, email: "" });
  const commit = (next: ProtectionModel) => {
    setModel(next);
    onSave(next);
  };

  const newDraft = (kind: Draft["kind"]): Draft => ({
    kind,
    id: null,
    name: kind === "range" ? `Protected range ${model.ranges.length + 1}` : "",
    ranges: selection ? rectRef(selection) : "",
    description: "",
    except: "",
    allowFormat: false,
    users: [],
  });

  const draftRanges = draft ? parseRanges(draft.ranges) : [];
  const draftExcept = draft ? parseRanges(draft.except) : [];
  const nameOk = !draft || draft.kind === "sheet" || validRangeName(draft.name);
  const rangesOk = !draft || draft.kind === "sheet" || (!!draftRanges && draftRanges.length > 0);
  const exceptOk = !draft || draft.kind === "range" || !!draftExcept;

  const saveDraft = () => {
    if (!draft || !nameOk || !rangesOk || !exceptOk) return;
    const users = draft.users.map((u) => u.id);
    if (draft.kind === "sheet") {
      commit(protectSheet(model, { users, by: model.sheet?.by ?? ctx.user, except: draftExcept ?? [], allowFormat: draft.allowFormat, description: draft.description || undefined }));
    } else if (draft.id) {
      commit(changeProtectedRange(model, draft.id, { name: draft.name, ranges: draftRanges ?? [], users, description: draft.description || undefined }));
    } else {
      commit(addProtectedRange(model, { name: draft.name, ranges: draftRanges ?? [], users, by: ctx.user, description: draft.description || undefined }));
    }
    setDraft(null);
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog aria-labelledby="protect-dialog-title" sx={{ width: "min(560px, calc(100vw - 32px))", maxHeight: "calc(100vh - 32px)", overflowY: "auto" }}>
        <ModalClose />
        <Typography id="protect-dialog-title" level="title-lg" startDecorator={<LockOutlinedIcon />}>
          Protected sheets and ranges
        </Typography>
        <Typography level="body-sm" sx={{ opacity: 0.75 }}>
          Protected cells can only be edited by the spreadsheet owner, whoever set the protection, and the people you list.
        </Typography>

        {!draft && (
          <>
            <List size="sm" sx={{ "--ListItem-paddingX": "0px" }} data-testid="protection-list">
              {model.sheet && (
                <ListItem
                  endAction={
                    canManage(model.sheet, ctx) && (
                      <Box sx={{ display: "flex" }}>
                        <IconButton
                          size="sm"
                          aria-label="Edit sheet protection"
                          onClick={() =>
                            setDraft({
                              kind: "sheet",
                              id: null,
                              name: "",
                              ranges: "",
                              description: model.sheet?.description ?? "",
                              except: rangesText(model.sheet?.except ?? []),
                              allowFormat: !!model.sheet?.allowFormat,
                              users: toMembers(model.sheet?.users ?? []),
                            })
                          }
                        >
                          <EditOutlinedIcon />
                        </IconButton>
                        <IconButton size="sm" aria-label="Unprotect sheet" onClick={() => commit(unprotectSheet(model))}>
                          <DeleteOutlineIcon />
                        </IconButton>
                      </Box>
                    )
                  }
                >
                  <ListItemContent>
                    <Typography level="title-sm">Sheet “{String(sheet?.name ?? "")}”</Typography>
                    <Typography level="body-xs">
                      {model.sheet.except?.length ? `Except ${rangesText(model.sheet.except)}` : "All cells"} · Editors:{" "}
                      {[model.sheet.by, ...(model.sheet.users ?? [])].filter(Boolean).map((u) => who(u!)).join(", ") || "owner only"}
                    </Typography>
                  </ListItemContent>
                </ListItem>
              )}
              {model.ranges.map((pr) => (
                <ListItem
                  key={pr.id}
                  endAction={
                    canManage(pr, ctx) && (
                      <Box sx={{ display: "flex" }}>
                        <IconButton
                          size="sm"
                          aria-label={`Edit ${pr.name}`}
                          onClick={() =>
                            setDraft({
                              kind: "range",
                              id: pr.id,
                              name: pr.name,
                              ranges: rangesText(pr.ranges),
                              description: pr.description ?? "",
                              except: "",
                              allowFormat: false,
                              users: toMembers(pr.users),
                            })
                          }
                        >
                          <EditOutlinedIcon />
                        </IconButton>
                        <IconButton size="sm" aria-label={`Remove ${pr.name}`} onClick={() => commit(deleteProtectedRanges(model, [pr.id]))}>
                          <DeleteOutlineIcon />
                        </IconButton>
                      </Box>
                    )
                  }
                >
                  <ListItemContent>
                    <Typography level="title-sm">
                      {pr.name} <Chip size="sm" variant="soft">{rangesText(pr.ranges)}</Chip>
                    </Typography>
                    <Typography level="body-xs">
                      {pr.description ? `${pr.description} · ` : ""}Editors: {[pr.by, ...pr.users].filter(Boolean).map((u) => who(u!)).join(", ") || "owner only"}
                    </Typography>
                  </ListItemContent>
                </ListItem>
              ))}
              {!model.sheet && !model.ranges.length && (
                <Typography level="body-sm" sx={{ py: 1, opacity: 0.7 }}>
                  Nothing on this sheet is protected.
                </Typography>
              )}
            </List>
            <Stack direction="row" spacing={1}>
              <Button size="sm" onClick={() => setDraft(newDraft("range"))}>
                Add a range
              </Button>
              {!model.sheet && (
                <Button size="sm" variant="outlined" onClick={() => setDraft(newDraft("sheet"))}>
                  Protect sheet
                </Button>
              )}
            </Stack>
          </>
        )}

        {draft && (
          <Stack spacing={1.25} sx={{ mt: 1 }} data-testid="protection-form">
            {!draft.id && !model.sheet && (
              <RadioGroup orientation="horizontal" value={draft.kind} onChange={(e) => setDraft({ ...newDraft(e.target.value as Draft["kind"]) })}>
                <Radio value="range" label="Range" />
                <Radio value="sheet" label="Sheet" />
              </RadioGroup>
            )}
            {draft.kind === "range" ? (
              <>
                <FormControl size="sm" error={!nameOk}>
                  <FormLabel>Name</FormLabel>
                  <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} slotProps={{ input: { "aria-label": "Range name" } }} />
                  {!nameOk && <FormHelperText>Start with a letter; use letters, digits, spaces, _ or .</FormHelperText>}
                </FormControl>
                <FormControl size="sm" error={!rangesOk}>
                  <FormLabel>Range</FormLabel>
                  <Input value={draft.ranges} onChange={(e) => setDraft({ ...draft, ranges: e.target.value })} placeholder="B2:B10" slotProps={{ input: { "aria-label": "Protected range" } }} />
                </FormControl>
              </>
            ) : (
              <>
                <FormControl size="sm" error={!exceptOk}>
                  <FormLabel>Except certain cells</FormLabel>
                  <Input value={draft.except} onChange={(e) => setDraft({ ...draft, except: e.target.value })} placeholder="A2:C20, E5" slotProps={{ input: { "aria-label": "Editable cells" } }} />
                </FormControl>
                <Checkbox size="sm" label="Let everyone format cells" checked={draft.allowFormat} onChange={(e) => setDraft({ ...draft, allowFormat: e.target.checked })} />
              </>
            )}
            <FormControl size="sm">
              <FormLabel>Description</FormLabel>
              <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} slotProps={{ input: { "aria-label": "Description" } }} />
            </FormControl>
            <FormControl size="sm">
              <FormLabel>Who can edit</FormLabel>
              <Autocomplete
                multiple
                size="sm"
                placeholder="Only you and the owner"
                options={people}
                value={draft.users}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                getOptionLabel={(m) => (m.name ? `${m.name}${m.email ? ` (${m.email})` : ""}` : m.email || m.id)}
                onChange={(_, v) => setDraft({ ...draft, users: v })}
                slotProps={{ input: { "aria-label": "Editors" } }}
              />
            </FormControl>
            {draft.kind === "sheet" && (
              <Alert size="sm" variant="soft">
                People not listed can still edit the “except” cells and cells whose format is unlocked.
              </Alert>
            )}
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button size="sm" variant="plain" color="neutral" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveDraft} disabled={!nameOk || !rangesOk || !exceptOk}>
                Done
              </Button>
            </Stack>
          </Stack>
        )}
      </ModalDialog>
    </Modal>
  );
}
