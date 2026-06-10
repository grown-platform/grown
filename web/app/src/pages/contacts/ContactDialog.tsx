import { useState } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  FormControl,
  FormLabel,
  Input,
  Textarea,
  Button,
  Box,
  Stack,
  IconButton,
  Chip,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import type { Contact, ContactInput } from "./types";

function emptyInput(): ContactInput {
  return {
    display_name: "",
    first_name: "",
    last_name: "",
    company: "",
    job_title: "",
    emails: [],
    phones: [],
    labels: [],
    notes: "",
    starred: false,
  };
}

function toInput(c: Contact): ContactInput {
  return {
    display_name: c.display_name,
    first_name: c.first_name,
    last_name: c.last_name,
    company: c.company,
    job_title: c.job_title,
    emails: [...c.emails],
    phones: [...c.phones],
    labels: [...c.labels],
    notes: c.notes,
    starred: c.starred,
  };
}

interface ContactDialogProps {
  contact: Contact | null; // null = create
  onClose: () => void;
  onSave: (input: ContactInput) => Promise<void>;
}

/** ContactDialog is the create/edit form, mirroring Google Contacts' field set. */
export function ContactDialog({
  contact,
  onClose,
  onSave,
}: ContactDialogProps) {
  const [f, setF] = useState<ContactInput>(
    contact ? toInput(contact) : emptyInput(),
  );
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ContactInput>(k: K, v: ContactInput[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  // Multi-value editors (emails / phones) keep a trailing blank for quick entry.
  function multi(
    field: "emails" | "phones",
    label: string,
    placeholder: string,
  ) {
    const vals = f[field];
    const rows = vals.length ? vals : [""];
    return (
      <FormControl>
        <FormLabel>{label}</FormLabel>
        <Stack spacing={0.75}>
          {rows.map((v, i) => (
            <Box key={i} sx={{ display: "flex", gap: 0.5 }}>
              <Input
                value={v}
                placeholder={placeholder}
                sx={{ flex: 1 }}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = e.target.value;
                  set(
                    field,
                    next.filter(
                      (x, idx) => x !== "" || idx === next.length - 1,
                    ),
                  );
                }}
              />
              {rows.length > 1 && (
                <IconButton
                  size="sm"
                  variant="plain"
                  onClick={() =>
                    set(
                      field,
                      rows.filter((_, idx) => idx !== i),
                    )
                  }
                >
                  <CloseIcon />
                </IconButton>
              )}
            </Box>
          ))}
          <Button
            size="sm"
            variant="plain"
            startDecorator={<AddIcon />}
            sx={{ alignSelf: "flex-start" }}
            onClick={() => set(field, [...vals, ""])}
          >
            Add {label.toLowerCase()}
          </Button>
        </Stack>
      </FormControl>
    );
  }

  async function save() {
    setSaving(true);
    const clean: ContactInput = {
      ...f,
      emails: f.emails.map((e) => e.trim()).filter(Boolean),
      phones: f.phones.map((p) => p.trim()).filter(Boolean),
      labels: f.labels.map((l) => l.trim()).filter(Boolean),
      display_name: (f.display_name || `${f.first_name} ${f.last_name}`).trim(),
    };
    try {
      await onSave(clean);
      onClose();
    } catch (e) {
      window.alert(`Save failed: ${(e as Error).message}`);
      setSaving(false);
    }
  }

  const [labelInput, setLabelInput] = useState("");

  return (
    <Modal open onClose={onClose}>
      <ModalDialog
        sx={{
          width: { xs: "100vw", sm: 560 },
          maxWidth: "100vw",
          maxHeight: { xs: "100dvh", sm: "90vh" },
          overflowY: "auto",
          borderRadius: { xs: 0, sm: "md" },
        }}
      >
        <ModalClose />
        <Typography level="h4">
          {contact ? "Edit contact" : "Create contact"}
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <Box
            sx={{
              display: "flex",
              gap: 1,
              flexDirection: { xs: "column", sm: "row" },
            }}
          >
            <FormControl sx={{ flex: 1 }}>
              <FormLabel>First name</FormLabel>
              <Input
                value={f.first_name}
                onChange={(e) => set("first_name", e.target.value)}
                autoFocus
              />
            </FormControl>
            <FormControl sx={{ flex: 1 }}>
              <FormLabel>Last name</FormLabel>
              <Input
                value={f.last_name}
                onChange={(e) => set("last_name", e.target.value)}
              />
            </FormControl>
          </Box>
          <FormControl>
            <FormLabel>Display name</FormLabel>
            <Input
              value={f.display_name}
              placeholder="Defaults to first + last"
              onChange={(e) => set("display_name", e.target.value)}
            />
          </FormControl>
          <Box
            sx={{
              display: "flex",
              gap: 1,
              flexDirection: { xs: "column", sm: "row" },
            }}
          >
            <FormControl sx={{ flex: 1 }}>
              <FormLabel>Company</FormLabel>
              <Input
                value={f.company}
                onChange={(e) => set("company", e.target.value)}
              />
            </FormControl>
            <FormControl sx={{ flex: 1 }}>
              <FormLabel>Job title</FormLabel>
              <Input
                value={f.job_title}
                onChange={(e) => set("job_title", e.target.value)}
              />
            </FormControl>
          </Box>
          {multi("emails", "Email", "name@example.com")}
          {multi("phones", "Phone", "+1 555 123 4567")}
          <FormControl>
            <FormLabel>Labels</FormLabel>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 0.5 }}>
              {f.labels.map((l) => (
                <Chip
                  key={l}
                  variant="soft"
                  endDecorator={<CloseIcon sx={{ fontSize: 14 }} />}
                  onClick={() =>
                    set(
                      "labels",
                      f.labels.filter((x) => x !== l),
                    )
                  }
                >
                  {l}
                </Chip>
              ))}
            </Box>
            <Input
              value={labelInput}
              placeholder="Add a label, press Enter"
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && labelInput.trim()) {
                  e.preventDefault();
                  if (!f.labels.includes(labelInput.trim()))
                    set("labels", [...f.labels, labelInput.trim()]);
                  setLabelInput("");
                }
              }}
            />
          </FormControl>
          <FormControl>
            <FormLabel>Notes</FormLabel>
            <Textarea
              minRows={2}
              value={f.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </FormControl>
          <Box
            sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 1 }}
          >
            <Button variant="plain" color="neutral" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={saving} onClick={save}>
              Save
            </Button>
          </Box>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
