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
  useEffect(() => {
    const on = (e: Event) => setNotice((e as CustomEvent<Notice>).detail);
    window.addEventListener("grown-sheet-notice", on);
    return () => window.removeEventListener("grown-sheet-notice", on);
  }, []);
  return (
    <Snackbar
      open={!!notice}
      onClose={() => setNotice(null)}
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
