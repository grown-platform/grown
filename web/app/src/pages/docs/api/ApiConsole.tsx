// Tools ▸ Macros and plugins (Docs M13, behind the docs-api flag): run a
// JSON macro through the API method table, or load a plugin page in a
// sandboxed iframe that calls the API by postMessage.
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, DialogTitle, Input, Modal, ModalClose, ModalDialog, Tab, TabList, TabPanel, Tabs, Textarea, Typography } from "@mui/joy";
import type { Editor } from "@tiptap/react";
import { API_METHODS, createDocApi, runMacro } from "./docApi";
import { connectPlugin } from "./host";
import { onApiConsole } from "./flag";

const EXAMPLE = JSON.stringify(
  [
    { method: "AddText", args: ["Hello from a macro."] },
    { method: "GetCurrentSentence", args: [] },
  ],
  null,
  2,
);

export function ApiConsole({ editor, parts }: { editor: Editor | null; parts: () => Editor[] }) {
  const [open, setOpen] = useState(false);
  const [macro, setMacro] = useState(EXAMPLE);
  const [out, setOut] = useState("");
  const [url, setUrl] = useState("");
  const [plugin, setPlugin] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => onApiConsole(() => setOpen(true)), []);
  const api = useMemo(() => (editor ? createDocApi({ editor, parts, active: () => [...parts()].find((p) => p.isFocused) ?? editor }) : null), [editor, parts]);
  useEffect(() => {
    if (!api || !plugin || !frame.current) return;
    return connectPlugin(frame.current, api);
  }, [api, plugin]);
  if (!open || !editor || !api) return null;
  return (
    <Modal open onClose={() => setOpen(false)}>
      <ModalDialog sx={{ width: { xs: "calc(100vw - 32px)", sm: 640 } }} data-testid="api-console">
        <ModalClose />
        <DialogTitle>Macros and plugins</DialogTitle>
        <Tabs defaultValue="macro">
          <TabList>
            <Tab value="macro">Macro</Tab>
            <Tab value="plugin">Plugin</Tab>
          </TabList>
          <TabPanel value="macro">
            <Typography level="body-xs">A macro is a JSON list of API calls. Methods: {API_METHODS.join(", ")}.</Typography>
            <Textarea minRows={6} value={macro} onChange={(e) => setMacro(e.target.value)} slotProps={{ textarea: { "aria-label": "Macro", spellCheck: false } }} sx={{ fontFamily: "monospace", mt: 1 }} />
            <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
              <Button
                size="sm"
                data-testid="api-run"
                onClick={() => {
                  try {
                    setOut(JSON.stringify(runMacro(api, macro), null, 2));
                  } catch (e) {
                    setOut(`Error: ${(e as Error).message}`);
                  }
                }}
              >
                Run
              </Button>
            </Box>
            {out && (
              <Box component="pre" data-testid="api-output" sx={{ fontSize: 12, maxHeight: 160, overflow: "auto", bgcolor: "background.level1", p: 1, borderRadius: "sm" }}>
                {out}
              </Box>
            )}
          </TabPanel>
          <TabPanel value="plugin">
            <Typography level="body-xs">
              A plugin is a web page run in a sandboxed frame (no access to your account or this page). It calls the API with postMessage.
            </Typography>
            <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
              <Input size="sm" sx={{ flex: 1 }} placeholder="https://…/plugin.html" value={url} onChange={(e) => setUrl(e.target.value)} />
              <Button size="sm" disabled={!/^https?:\/\//.test(url)} onClick={() => setPlugin(url)}>
                Load
              </Button>
            </Box>
            {plugin && <iframe ref={frame} title="Plugin" src={plugin} sandbox="allow-scripts" style={{ width: "100%", height: 240, border: "1px solid #ddd", marginTop: 8 }} />}
          </TabPanel>
        </Tabs>
      </ModalDialog>
    </Modal>
  );
}
