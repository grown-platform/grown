import { useState } from "react";
import {
  Box,
  Sheet,
  Typography,
  Table,
  Button,
  IconButton,
  Input,
  Select,
  Option,
  Switch,
  Chip,
  Divider,
  FormControl,
  FormLabel,
} from "@mui/joy";
import DialpadIcon from "@mui/icons-material/Dialpad";
import GroupsIcon from "@mui/icons-material/Groups";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import RouterIcon from "@mui/icons-material/Router";
import CallReceivedIcon from "@mui/icons-material/CallReceived";
import CallMadeIcon from "@mui/icons-material/CallMade";
import VoicemailIcon from "@mui/icons-material/Voicemail";
import SettingsIcon from "@mui/icons-material/Settings";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import type { SvgIconComponent } from "@mui/icons-material";
import type { User } from "../../api/types";

// ---------------------------------------------------------------------------
// AdminArea — PBX administration console scaffold (3CX-style).
//
// This is a front-end-only scaffold. The eventual backend is a self-hosted
// Asterisk / PJSIP PBX; none of the controls below are wired to it yet. All
// data shown is in-component MOCK data so the layout and flows can be
// reviewed before the server side exists.
// ---------------------------------------------------------------------------

interface AdminAreaProps {
  user: User | null;
}

type SectionId =
  | "extensions"
  | "ringgroups"
  | "ivr"
  | "trunks"
  | "inbound"
  | "outbound"
  | "voicemail"
  | "settings";

interface SectionDef {
  id: SectionId;
  label: string;
  icon: SvgIconComponent;
}

const SECTIONS: SectionDef[] = [
  { id: "extensions", label: "Extensions", icon: DialpadIcon },
  { id: "ringgroups", label: "Ring Groups", icon: GroupsIcon },
  { id: "ivr", label: "Auto-Attendant", icon: AccountTreeIcon },
  { id: "trunks", label: "SIP Trunks", icon: RouterIcon },
  { id: "inbound", label: "Inbound Routes", icon: CallReceivedIcon },
  { id: "outbound", label: "Outbound Routes", icon: CallMadeIcon },
  { id: "voicemail", label: "Voicemail", icon: VoicemailIcon },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

const ACCENT = "#00897B";

// ---------------------------------------------------------------------------
// Small shared building blocks.
// ---------------------------------------------------------------------------

function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: { xs: "flex-start", sm: "center" },
        flexDirection: { xs: "column", sm: "row" },
        gap: 1.5,
        mb: 2.5,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography level="title-lg">{title}</Typography>
        <Typography level="body-sm" sx={{ opacity: 0.7 }}>
          {description}
        </Typography>
      </Box>
      {action}
    </Box>
  );
}

function PanelSheet({ children }: { children: React.ReactNode }) {
  return (
    <Sheet
      variant="outlined"
      sx={{ borderRadius: "md", overflow: "hidden", mb: 2.5 }}
    >
      {children}
    </Sheet>
  );
}

function RowActions() {
  return (
    <Box sx={{ display: "flex", gap: 0.5, justifyContent: "flex-end" }}>
      <IconButton size="sm" variant="plain" color="neutral" aria-label="Edit">
        <EditOutlinedIcon fontSize="small" />
      </IconButton>
      <IconButton size="sm" variant="plain" color="danger" aria-label="Delete">
        <DeleteOutlineIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}

// ===========================================================================
// 1. Extensions
// ===========================================================================

interface ExtensionRow {
  number: string;
  name: string;
  device: "Browser" | "Desk phone";
  voicemail: boolean;
  registered: boolean;
}

const MOCK_EXTENSIONS: ExtensionRow[] = [
  { number: "1001", name: "Ada Lovelace", device: "Browser", voicemail: true, registered: true },
  { number: "1002", name: "Alan Turing", device: "Desk phone", voicemail: true, registered: true },
  { number: "1003", name: "Grace Hopper", device: "Browser", voicemail: false, registered: false },
  { number: "1004", name: "Front Desk", device: "Desk phone", voicemail: true, registered: true },
];

function ExtensionsSection() {
  const [adding, setAdding] = useState(false);
  const [rows] = useState(MOCK_EXTENSIONS);

  return (
    <Box>
      <SectionHeader
        title="Extensions"
        description="Each user or device gets a SIP extension on the PBX."
        action={
          <Button
            startDecorator={<AddIcon />}
            onClick={() => setAdding((v) => !v)}
            variant={adding ? "soft" : "solid"}
            sx={{ bgcolor: adding ? undefined : ACCENT }}
          >
            Add extension
          </Button>
        }
      />

      {adding && (
        <PanelSheet>
          <Box sx={{ p: 2.5 }}>
            <Typography level="title-sm" sx={{ mb: 1.5 }}>
              New extension
            </Typography>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" },
                gap: 2,
              }}
            >
              <FormControl>
                <FormLabel>Extension number</FormLabel>
                <Input placeholder="1005" />
              </FormControl>
              <FormControl>
                <FormLabel>User</FormLabel>
                <Input placeholder="Name or email" />
              </FormControl>
              <FormControl>
                <FormLabel>Voicemail PIN</FormLabel>
                <Input type="password" placeholder="••••" />
              </FormControl>
            </Box>
            <Box sx={{ display: "flex", gap: 1, mt: 2 }}>
              <Button variant="solid" sx={{ bgcolor: ACCENT }} disabled>
                Create
              </Button>
              <Button variant="plain" color="neutral" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </Box>
          </Box>
        </PanelSheet>
      )}

      <PanelSheet>
        <Table stickyHeader hoverRow sx={{ "--TableCell-paddingX": "16px" }}>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Extension</th>
              <th>User / Name</th>
              <th style={{ width: 140 }}>Device</th>
              <th style={{ width: 120 }}>Voicemail</th>
              <th style={{ width: 130 }}>Status</th>
              <th style={{ width: 90 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.number}>
                <td style={{ fontFamily: "monospace" }}>{r.number}</td>
                <td>{r.name}</td>
                <td>{r.device}</td>
                <td>
                  <Chip size="sm" variant="soft" color={r.voicemail ? "success" : "neutral"}>
                    {r.voicemail ? "On" : "Off"}
                  </Chip>
                </td>
                <td>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={r.registered ? "success" : "danger"}
                  >
                    {r.registered ? "Registered" : "Offline"}
                  </Chip>
                </td>
                <td>
                  <RowActions />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PanelSheet>
    </Box>
  );
}

// ===========================================================================
// 2. Ring Groups
// ===========================================================================

type RingStrategy = "Ring all" | "Hunt" | "Round-robin";

interface RingGroupRow {
  name: string;
  members: string[];
  strategy: RingStrategy;
  timeout: number;
}

const MOCK_RING_GROUPS: RingGroupRow[] = [
  { name: "Sales", members: ["1001", "1002", "1003"], strategy: "Ring all", timeout: 25 },
  { name: "Support", members: ["1002", "1004"], strategy: "Round-robin", timeout: 20 },
  { name: "Reception", members: ["1004"], strategy: "Hunt", timeout: 15 },
];

function RingGroupsSection() {
  const [rows] = useState(MOCK_RING_GROUPS);

  return (
    <Box>
      <SectionHeader
        title="Ring Groups"
        description="Ring several extensions together with a chosen strategy."
        action={
          <Button startDecorator={<AddIcon />} variant="solid" sx={{ bgcolor: ACCENT }}>
            Add ring group
          </Button>
        }
      />
      <PanelSheet>
        <Table hoverRow sx={{ "--TableCell-paddingX": "16px" }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Extensions</th>
              <th style={{ width: 170 }}>Ring strategy</th>
              <th style={{ width: 120 }}>Timeout</th>
              <th style={{ width: 90 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>
                  <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                    {r.members.map((m) => (
                      <Chip key={m} size="sm" variant="outlined">
                        {m}
                      </Chip>
                    ))}
                  </Box>
                </td>
                <td>
                  <Chip size="sm" variant="soft" color="primary">
                    {r.strategy}
                  </Chip>
                </td>
                <td>{r.timeout}s</td>
                <td>
                  <RowActions />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PanelSheet>
    </Box>
  );
}

// ===========================================================================
// 3. Auto-Attendant (IVR)
// ===========================================================================

interface IvrEntry {
  digit: string;
  destination: string;
}

const IVR_DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "#"];

const MOCK_IVR: Record<string, string> = {
  "1": "Ring group: Sales",
  "2": "Ring group: Support",
  "0": "Extension 1004 (Front Desk)",
  "9": "Voicemail: General mailbox",
  "#": "Hang up",
};

const IVR_DESTINATIONS = [
  "Extension 1001",
  "Extension 1002",
  "Extension 1004 (Front Desk)",
  "Ring group: Sales",
  "Ring group: Support",
  "Voicemail: General mailbox",
  "Hang up",
];

function IvrSection() {
  const entries: IvrEntry[] = IVR_DIGITS.map((d) => ({
    digit: d,
    destination: MOCK_IVR[d] ?? "",
  }));

  return (
    <Box>
      <SectionHeader
        title="Auto-Attendant (IVR)"
        description="Play a greeting, then route the caller based on the key they press."
      />

      <PanelSheet>
        <Box sx={{ p: 2.5 }}>
          <FormControl>
            <FormLabel>Greeting prompt</FormLabel>
            <Input
              defaultValue="Thank you for calling. Press 1 for Sales, 2 for Support, or 0 for the operator."
              sx={{ maxWidth: 640 }}
            />
          </FormControl>
        </Box>
      </PanelSheet>

      <PanelSheet>
        <Table sx={{ "--TableCell-paddingX": "16px" }}>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Digit</th>
              <th>Destination</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.digit}>
                <td>
                  <Chip size="sm" variant="solid" sx={{ bgcolor: ACCENT, fontFamily: "monospace" }}>
                    {e.digit}
                  </Chip>
                </td>
                <td>
                  <Select
                    size="sm"
                    placeholder="— Not assigned —"
                    defaultValue={e.destination || null}
                    sx={{ maxWidth: 360 }}
                  >
                    <Option value="">— Not assigned —</Option>
                    {IVR_DESTINATIONS.map((d) => (
                      <Option key={d} value={d}>
                        {d}
                      </Option>
                    ))}
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PanelSheet>
    </Box>
  );
}

// ===========================================================================
// 4. SIP Trunks
// ===========================================================================

interface TrunkRow {
  name: string;
  host: string;
  channels: number;
  registered: boolean;
}

const MOCK_TRUNKS: TrunkRow[] = [
  { name: "Twilio-PSTN", host: "sip.twilio.com", channels: 20, registered: true },
  { name: "Flowroute", host: "us-east.sip.flowroute.com", channels: 10, registered: true },
  { name: "Backup-SIP", host: "sip.backup-provider.net", channels: 5, registered: false },
];

function TrunksSection() {
  const [adding, setAdding] = useState(false);
  const [rows] = useState(MOCK_TRUNKS);

  return (
    <Box>
      <SectionHeader
        title="SIP Trunks"
        description="Connect the PBX to a SIP provider for PSTN (landline / mobile) calls."
        action={
          <Button
            startDecorator={<AddIcon />}
            onClick={() => setAdding((v) => !v)}
            variant={adding ? "soft" : "solid"}
            sx={{ bgcolor: adding ? undefined : ACCENT }}
          >
            Add trunk
          </Button>
        }
      />

      {adding && (
        <PanelSheet>
          <Box sx={{ p: 2.5 }}>
            <Typography level="title-sm" sx={{ mb: 1.5 }}>
              New SIP trunk
            </Typography>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                gap: 2,
              }}
            >
              <FormControl>
                <FormLabel>Trunk name</FormLabel>
                <Input placeholder="My provider" />
              </FormControl>
              <FormControl>
                <FormLabel>Provider host</FormLabel>
                <Input placeholder="sip.provider.com" />
              </FormControl>
              <FormControl>
                <FormLabel>SIP username</FormLabel>
                <Input placeholder="account-sid" />
              </FormControl>
              <FormControl>
                <FormLabel>SIP password / secret</FormLabel>
                <Input type="password" placeholder="••••••••" />
              </FormControl>
              <FormControl>
                <FormLabel>Max channels</FormLabel>
                <Input type="number" placeholder="10" />
              </FormControl>
            </Box>
            <Box sx={{ display: "flex", gap: 1, mt: 2 }}>
              <Button variant="solid" sx={{ bgcolor: ACCENT }} disabled>
                Save trunk
              </Button>
              <Button variant="plain" color="neutral" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </Box>
          </Box>
        </PanelSheet>
      )}

      <PanelSheet>
        <Table hoverRow sx={{ "--TableCell-paddingX": "16px" }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Provider / Host</th>
              <th style={{ width: 110 }}>Channels</th>
              <th style={{ width: 150 }}>Registration</th>
              <th style={{ width: 90 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td style={{ fontFamily: "monospace" }}>{r.host}</td>
                <td>{r.channels}</td>
                <td>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={r.registered ? "success" : "danger"}
                  >
                    {r.registered ? "Registered" : "Unregistered"}
                  </Chip>
                </td>
                <td>
                  <RowActions />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PanelSheet>
    </Box>
  );
}

// ===========================================================================
// 5. Inbound Routes
// ===========================================================================

interface InboundRow {
  did: string;
  destination: string;
}

const MOCK_INBOUND: InboundRow[] = [
  { did: "+1 (415) 555-0100", destination: "IVR: Main menu" },
  { did: "+1 (415) 555-0142", destination: "Ring group: Sales" },
  { did: "+1 (415) 555-0188", destination: "Extension 1004 (Front Desk)" },
];

function InboundSection() {
  const [rows] = useState(MOCK_INBOUND);

  return (
    <Box>
      <SectionHeader
        title="Inbound Routes"
        description="Map incoming numbers (DIDs) to where the call should land."
        action={
          <Button startDecorator={<AddIcon />} variant="solid" sx={{ bgcolor: ACCENT }}>
            Add inbound route
          </Button>
        }
      />
      <PanelSheet>
        <Table hoverRow sx={{ "--TableCell-paddingX": "16px" }}>
          <thead>
            <tr>
              <th style={{ width: 220 }}>DID / Number</th>
              <th>Destination</th>
              <th style={{ width: 90 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.did}>
                <td style={{ fontFamily: "monospace" }}>{r.did}</td>
                <td>{r.destination}</td>
                <td>
                  <RowActions />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PanelSheet>
    </Box>
  );
}

// ===========================================================================
// 6. Outbound Routes
// ===========================================================================

interface OutboundRow {
  pattern: string;
  trunk: string;
  priority: number;
}

const MOCK_OUTBOUND: OutboundRow[] = [
  { pattern: "1NXXNXXXXXX", trunk: "Twilio-PSTN", priority: 1 },
  { pattern: "NXXNXXXXXX", trunk: "Twilio-PSTN", priority: 2 },
  { pattern: "011.", trunk: "Flowroute", priority: 1 },
  { pattern: "911", trunk: "Twilio-PSTN", priority: 0 },
];

function OutboundSection() {
  const [rows] = useState(MOCK_OUTBOUND);

  return (
    <Box>
      <SectionHeader
        title="Outbound Routes"
        description="Match dialed digits to a trunk. Lower priority numbers are tried first."
        action={
          <Button startDecorator={<AddIcon />} variant="solid" sx={{ bgcolor: ACCENT }}>
            Add outbound route
          </Button>
        }
      />
      <PanelSheet>
        <Table hoverRow sx={{ "--TableCell-paddingX": "16px" }}>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Priority</th>
              <th>Dial pattern</th>
              <th style={{ width: 200 }}>Trunk</th>
              <th style={{ width: 90 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.pattern}-${r.priority}`}>
                <td>{r.priority}</td>
                <td style={{ fontFamily: "monospace" }}>{r.pattern}</td>
                <td>
                  <Chip size="sm" variant="outlined">
                    {r.trunk}
                  </Chip>
                </td>
                <td>
                  <RowActions />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PanelSheet>
    </Box>
  );
}

// ===========================================================================
// 7. Voicemail
// ===========================================================================

interface MailboxRow {
  extension: string;
  name: string;
  messages: number;
  email: string;
}

const MOCK_MAILBOXES: MailboxRow[] = [
  { extension: "1001", name: "Ada Lovelace", messages: 2, email: "ada@example.com" },
  { extension: "1002", name: "Alan Turing", messages: 0, email: "alan@example.com" },
  { extension: "1004", name: "Front Desk", messages: 5, email: "frontdesk@example.com" },
];

function VoicemailSection() {
  const [emailToVm, setEmailToVm] = useState(true);
  const [rows] = useState(MOCK_MAILBOXES);

  return (
    <Box>
      <SectionHeader
        title="Voicemail"
        description="Per-extension mailboxes and global voicemail behavior."
      />

      <PanelSheet>
        <Box sx={{ p: 2.5 }}>
          <Typography level="title-sm" sx={{ mb: 1.5 }}>
            Global settings
          </Typography>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
              mb: 2,
            }}
          >
            <Box>
              <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                Email-to-voicemail
              </Typography>
              <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                Send a copy of each new message as an email attachment.
              </Typography>
            </Box>
            <Switch checked={emailToVm} onChange={(e) => setEmailToVm(e.target.checked)} />
          </Box>
          <FormControl>
            <FormLabel>Default greeting</FormLabel>
            <Input
              defaultValue="You have reached the voicemail box. Please leave a message after the tone."
              sx={{ maxWidth: 640 }}
            />
          </FormControl>
        </Box>
      </PanelSheet>

      <PanelSheet>
        <Table hoverRow sx={{ "--TableCell-paddingX": "16px" }}>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Extension</th>
              <th>Mailbox</th>
              <th style={{ width: 130 }}>Messages</th>
              <th>Notify email</th>
              <th style={{ width: 90 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.extension}>
                <td style={{ fontFamily: "monospace" }}>{r.extension}</td>
                <td>{r.name}</td>
                <td>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={r.messages > 0 ? "primary" : "neutral"}
                  >
                    {r.messages} new
                  </Chip>
                </td>
                <td style={{ opacity: 0.8 }}>{r.email}</td>
                <td>
                  <RowActions />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PanelSheet>
    </Box>
  );
}

// ===========================================================================
// 8. Settings
// ===========================================================================

const ALL_CODECS = ["G.711 ulaw", "G.711 alaw", "Opus", "G.722"];

function SettingsSection() {
  const [codecs, setCodecs] = useState<string[]>(["G.711 ulaw", "Opus"]);
  const [recording, setRecording] = useState(false);

  return (
    <Box>
      <SectionHeader
        title="Settings"
        description="Global media, network, and scheduling settings for the PBX."
      />

      <PanelSheet>
        <Box sx={{ p: 2.5 }}>
          <Typography level="title-sm" sx={{ mb: 1.5 }}>
            Media
          </Typography>
          <FormControl sx={{ mb: 2 }}>
            <FormLabel>Allowed codecs</FormLabel>
            <Select
              multiple
              value={codecs}
              onChange={(_, value) => setCodecs(value as string[])}
              renderValue={(selected) => (
                <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                  {selected.map((o) => (
                    <Chip key={o.value} size="sm" variant="soft">
                      {o.label}
                    </Chip>
                  ))}
                </Box>
              )}
              sx={{ maxWidth: 480 }}
            >
              {ALL_CODECS.map((c) => (
                <Option key={c} value={c}>
                  {c}
                </Option>
              ))}
            </Select>
          </FormControl>

          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
              maxWidth: 480,
            }}
          >
            <Box>
              <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                Call recording
              </Typography>
              <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                Record all calls passing through the PBX.
              </Typography>
            </Box>
            <Switch checked={recording} onChange={(e) => setRecording(e.target.checked)} />
          </Box>
        </Box>
      </PanelSheet>

      <PanelSheet>
        <Box sx={{ p: 2.5 }}>
          <Typography level="title-sm" sx={{ mb: 1.5 }}>
            NAT / STUN
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: 2,
            }}
          >
            <FormControl>
              <FormLabel>External IP / host</FormLabel>
              <Input placeholder="pbx.example.com" />
            </FormControl>
            <FormControl>
              <FormLabel>STUN server</FormLabel>
              <Input defaultValue="stun:stun.l.google.com:19302" />
            </FormControl>
            <FormControl>
              <FormLabel>Local network (CIDR)</FormLabel>
              <Input placeholder="10.0.0.0/8" />
            </FormControl>
            <FormControl>
              <FormLabel>RTP port range</FormLabel>
              <Input placeholder="10000-20000" />
            </FormControl>
          </Box>
        </Box>
      </PanelSheet>

      <PanelSheet>
        <Box sx={{ p: 2.5 }}>
          <Typography level="title-sm" sx={{ mb: 1.5 }}>
            Business hours
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" },
              gap: 2,
            }}
          >
            <FormControl>
              <FormLabel>Open</FormLabel>
              <Input type="time" defaultValue="09:00" />
            </FormControl>
            <FormControl>
              <FormLabel>Close</FormLabel>
              <Input type="time" defaultValue="17:00" />
            </FormControl>
            <FormControl>
              <FormLabel>After-hours destination</FormLabel>
              <Select defaultValue="vm">
                <Option value="vm">Voicemail: General mailbox</Option>
                <Option value="ivr">IVR: After-hours menu</Option>
                <Option value="hangup">Hang up</Option>
              </Select>
            </FormControl>
          </Box>
        </Box>
      </PanelSheet>
    </Box>
  );
}

// ===========================================================================
// Section renderer
// ===========================================================================

function renderSection(id: SectionId) {
  switch (id) {
    case "extensions":
      return <ExtensionsSection />;
    case "ringgroups":
      return <RingGroupsSection />;
    case "ivr":
      return <IvrSection />;
    case "trunks":
      return <TrunksSection />;
    case "inbound":
      return <InboundSection />;
    case "outbound":
      return <OutboundSection />;
    case "voicemail":
      return <VoicemailSection />;
    case "settings":
      return <SettingsSection />;
  }
}

// ===========================================================================
// AdminArea — top-level layout (left sub-nav + right content panel).
// ===========================================================================

export function AdminArea({ user }: AdminAreaProps) {
  const [active, setActive] = useState<SectionId>("extensions");

  return (
    <Box sx={{ maxWidth: 1100, mx: "auto", width: "100%" }}>
      {/* Title + backend-status banner */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5, flexWrap: "wrap" }}>
        <SettingsIcon sx={{ color: ACCENT, fontSize: 30 }} />
        <Typography level="h3" sx={{ flex: 1 }}>
          PBX Administration
        </Typography>
        {user && (
          <Typography level="body-sm" sx={{ opacity: 0.6 }}>
            Signed in as {user.display_name || user.email}
          </Typography>
        )}
      </Box>

      <Chip
        variant="soft"
        color="warning"
        sx={{ mb: 2.5, py: 0.5, whiteSpace: "normal", height: "auto" }}
      >
        Configures the self-hosted PBX (Asterisk) — backend connection coming in a later phase.
      </Chip>

      {/* Mobile: section picker as a Select */}
      <Box sx={{ display: { xs: "block", md: "none" }, mb: 2 }}>
        <Select
          value={active}
          onChange={(_, value) => value && setActive(value)}
          sx={{ width: "100%" }}
        >
          {SECTIONS.map((s) => (
            <Option key={s.id} value={s.id}>
              {s.label}
            </Option>
          ))}
        </Select>
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "220px 1fr" },
          gap: 3,
          alignItems: "start",
        }}
      >
        {/* Left sub-nav (md+): vertical list */}
        <Sheet
          variant="outlined"
          sx={{
            display: { xs: "none", md: "block" },
            borderRadius: "md",
            p: 1,
            position: "sticky",
            top: 16,
          }}
        >
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const selected = s.id === active;
              return (
                <Button
                  key={s.id}
                  variant={selected ? "soft" : "plain"}
                  color={selected ? "primary" : "neutral"}
                  startDecorator={<Icon fontSize="small" />}
                  onClick={() => setActive(s.id)}
                  sx={{ justifyContent: "flex-start", fontWeight: selected ? 700 : 500 }}
                >
                  {s.label}
                </Button>
              );
            })}
          </Box>
          <Divider sx={{ my: 1 }} />
          <Typography level="body-xs" sx={{ px: 1, py: 0.5, opacity: 0.55 }}>
            Asterisk / PJSIP backend
          </Typography>
        </Sheet>

        {/* Right content panel */}
        <Box sx={{ minWidth: 0 }}>{renderSection(active)}</Box>
      </Box>
    </Box>
  );
}
