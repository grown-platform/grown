import { useEffect, useState } from "react";
import { Snackbar, Typography } from "@mui/joy";

// Shows validation alerts raised by sheetDataTools.ts (a "grown-sheet-notice"
// window event): stop-style rejections and information-style notes.

interface Notice {
  kind: "error" | "info";
  title: string;
  message: string;
}

export function SheetNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = (e: Event) => {
      setNotice((e as CustomEvent<Notice>).detail);
      setOpen(true);
    };
    window.addEventListener("grown-sheet-notice", on);
    return () => window.removeEventListener("grown-sheet-notice", on);
  }, []);
  return (
    <Snackbar
      open={open}
      onClose={(_, reason) => reason !== "clickaway" && setOpen(false)}
      autoHideDuration={5000}
      color={notice?.kind === "error" ? "danger" : "primary"}
      variant="soft"
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      data-testid="sheet-notice"
    >
      <div>
        <Typography level="title-sm">{notice?.title}</Typography>
        <Typography level="body-sm">{notice?.message}</Typography>
      </div>
    </Snackbar>
  );
}
