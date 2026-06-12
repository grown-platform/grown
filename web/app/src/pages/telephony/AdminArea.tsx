import { useState, useRef, useMemo } from "react";
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
  ListItem,
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
import DashboardIcon from "@mui/icons-material/Dashboard";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import AssessmentIcon from "@mui/icons-material/Assessment";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import PrintIcon from "@mui/icons-material/Print";
import ContactsIcon from "@mui/icons-material/Contacts";
import PhonelinkSetupIcon from "@mui/icons-material/PhonelinkSetup";
import SecurityIcon from "@mui/icons-material/Security";
import BackupIcon from "@mui/icons-material/Backup";
import HistoryIcon from "@mui/icons-material/History";
import EmailIcon from "@mui/icons-material/Email";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import DownloadIcon from "@mui/icons-material/Download";
import SearchIcon from "@mui/icons-material/Search";
import type { SvgIconComponent } from "@mui/icons-material";
import type { User } from "../../api/types";
import {
  makeRecordingWav,
  durationToSeconds,
  recordingBytes,
  formatSize,
  downloadBlob,
} from "./dummyRecording";
import { useActivityLog, logActivity, clearActivity } from "./activityLog";

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
  | "dashboard"
  | "extensions"
  | "ringgroups"
  | "queues"
  | "ivr"
  | "trunks"
  | "inbound"
  | "outbound"
  | "voicemail"
  | "reports"
  | "recordings"
  | "moh"
  | "fax"
  | "contacts"
  | "phones"
  | "security"
  | "backup"
  | "activity"
  | "email"
  | "settings";

interface SectionDef {
  id: SectionId;
  label: string;
  icon: SvgIconComponent;
  group: string;
}

const SECTIONS: SectionDef[] = [
  { id: "dashboard", label: "Dashboard", icon: DashboardIcon, group: "Overview" },

  { id: "extensions", label: "Extensions", icon: DialpadIcon, group: "Call Handling" },
  { id: "ringgroups", label: "Ring Groups", icon: GroupsIcon, group: "Call Handling" },
  { id: "queues", label: "Call Queues", icon: SupportAgentIcon, group: "Call Handling" },
  { id: "ivr", label: "Auto-Attendant", icon: AccountTreeIcon, group: "Call Handling" },

  { id: "trunks", label: "SIP Trunks", icon: RouterIcon, group: "Routing" },
  { id: "inbound", label: "Inbound Routes", icon: CallReceivedIcon, group: "Routing" },
  { id: "outbound", label: "Outbound Routes", icon: CallMadeIcon, group: "Routing" },

  { id: "voicemail", label: "Voicemail", icon: VoicemailIcon, group: "Messaging & Media" },
  { id: "moh", label: "Music on Hold", icon: MusicNoteIcon, group: "Messaging & Media" },
  { id: "fax", label: "FAX", icon: PrintIcon, group: "Messaging & Media" },
  { id: "contacts", label: "Contacts", icon: ContactsIcon, group: "Messaging & Media" },

  { id: "reports", label: "Call Reports", icon: AssessmentIcon, group: "Reporting" },
  { id: "recordings", label: "Recordings", icon: FiberManualRecordIcon, group: "Reporting" },
  { id: "activity", label: "Activity Log", icon: HistoryIcon, group: "Reporting" },

  { id: "phones", label: "Phones", icon: PhonelinkSetupIcon, group: "System" },
  { id: "security", label: "Security", icon: SecurityIcon, group: "System" },
  { id: "backup", label: "Backup & Restore", icon: BackupIcon, group: "System" },
  { id: "email", label: "Email (SMTP)", icon: EmailIcon, group: "System" },
  { id: "settings", label: "Settings", icon: SettingsIcon, group: "System" },
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
            <Switch
              checked={recording}
              onChange={(e) => {
                setRecording(e.target.checked);
                logActivity(
                  "Call recording " + (e.target.checked ? "enabled" : "disabled"),
                  "Record all calls passing through the PBX",
                );
              }}
            />
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
// 9. Dashboard
// ===========================================================================

function StatCard({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: "success" | "danger" | "neutral";
}) {
  return (
    <Sheet variant="outlined" sx={{ borderRadius: "md", p: 2 }}>
      <Typography level="body-xs" sx={{ opacity: 0.7, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </Typography>
      <Typography
        level="h2"
        sx={{ mt: 0.5, color: color === "danger" ? "danger.500" : ACCENT }}
      >
        {value}
      </Typography>
      {hint && (
        <Typography level="body-xs" sx={{ opacity: 0.6 }}>
          {hint}
        </Typography>
      )}
    </Sheet>
  );
}

interface SystemStatusRow {
  service: string;
  status: "OK" | "Degraded" | "Down";
  detail: string;
}

const MOCK_SYSTEM_STATUS: SystemStatusRow[] = [
  { service: "PBX service (Asterisk)", status: "OK", detail: "Uptime 14d 6h" },
  { service: "SIP registration", status: "OK", detail: "2 of 3 trunks registered" },
  { service: "Recording storage", status: "Degraded", detail: "82% of 200 GB used" },
];

function DashboardSection() {
  const [status] = useState(MOCK_SYSTEM_STATUS);

  return (
    <Box>
      <SectionHeader
        title="Dashboard"
        description="At-a-glance health and activity for the PBX."
      />

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(3, 1fr)", md: "repeat(5, 1fr)" },
          gap: 2,
          mb: 2.5,
        }}
      >
        <StatCard label="Registered extensions" value="3 / 4" hint="1 offline" />
        <StatCard label="Active calls" value="2" hint="1 inbound, 1 internal" />
        <StatCard label="Trunks up" value="2 / 3" hint="1 down" color="danger" />
        <StatCard label="Calls today" value="148" hint="62 in · 86 out" />
        <StatCard label="Voicemails" value="7" hint="new messages" />
      </Box>

      <PanelSheet>
        <Box sx={{ p: 2.5, pb: 1 }}>
          <Typography level="title-sm">System status</Typography>
        </Box>
        <Table sx={{ "--TableCell-paddingX": "16px" }}>
          <thead>
            <tr>
              <th>Service</th>
              <th style={{ width: 140 }}>Status</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {status.map((s) => (
              <tr key={s.service}>
                <td>{s.service}</td>
                <td>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={s.status === "OK" ? "success" : s.status === "Degraded" ? "warning" : "danger"}
                  >
                    {s.status}
                  </Chip>
                </td>
                <td style={{ opacity: 0.8 }}>{s.detail}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PanelSheet>
    </Box>
  );
}

// ===========================================================================
// 10. Call Queues
// ===========================================================================

type QueueStrategy = "Ring all" | "Least recent" | "Fewest calls" | "Round robin";

interface QueueRow {
  name: string;
  extension: string;
  strategy: QueueStrategy;
  agents: string[];
  sla: number;
  waiting: number;
}

const QUEUE_STRATEGIES: QueueStrategy[] = ["Ring all", "Least recent", "Fewest calls", "Round robin"];

const MOCK_QUEUES: QueueRow[] = [
  { name: "Sales Queue", extension: "2001", strategy: "Round robin", agents: ["1001", "1002", "1003"], sla: 30, waiting: 2 },
  { name: "Support Queue", extension: "2002", strategy: "Least recent", agents: ["1002", "1004"], sla: 45, waiting: 0 },
  { name: "Billing Queue", extension: "2003", strategy: "Fewest calls", agents: ["1003"], sla: 60, waiting: 1 },
];

function QueuesSection() {
  const [adding, setAdding] = useState(false);
  const [rows] = useState(MOCK_QUEUES);

  return (
    <Box>
      <SectionHeader
        title="Call Queues"
        description="Hold callers in a queue and distribute them to agents by strategy."
        action={
          <Button
            startDecorator={<AddIcon />}
            onClick={() => setAdding((v) => !v)}
            variant={adding ? "soft" : "solid"}
            sx={{ bgcolor: adding ? undefined : ACCENT }}
          >
            Add queue
          </Button>
        }
      />

      {adding && (
        <PanelSheet>
          <Box sx={{ p: 2.5 }}>
            <Typography level="title-sm" sx={{ mb: 1.5 }}>
              New call queue
            </Typography>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" },
                gap: 2,
              }}
            >
              <FormControl>
                <FormLabel>Queue name</FormLabel>
                <Input placeholder="Sales Queue" />
              </FormControl>
              <FormControl>
                <FormLabel>Virtual extension</FormLabel>
                <Input placeholder="2004" />
              </FormControl>
              <FormControl>
                <FormLabel>Strategy</FormLabel>
                <Select defaultValue="Ring all">
                  {QUEUE_STRATEGIES.map((s) => (
                    <Option key={s} value={s}>
                      {s}
                    </Option>
                  ))}
                </Select>
              </FormControl>
              <FormControl>
                <FormLabel>SLA / timeout (s)</FormLabel>
                <Input type="number" placeholder="30" />
              </FormControl>
            </Box>
            <Box sx={{ display: "flex", gap: 1, mt: 2 }}>
              <Button variant="solid" sx={{ bgcolor: ACCENT }} disabled>
                Create queue
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
              <th>Queue</th>
              <th style={{ width: 110 }}>Extension</th>
              <th style={{ width: 150 }}>Strategy</th>
              <th>Agents</th>
              <th style={{ width: 100 }}>SLA</th>
              <th style={{ width: 110 }}>Waiting</th>
              <th style={{ width: 90 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td style={{ fontFamily: "monospace" }}>{r.extension}</td>
                <td>
                  <Chip size="sm" variant="soft" color="primary">
                    {r.strategy}
                  </Chip>
                </td>
                <td>
                  <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                    {r.agents.map((a) => (
                      <Chip key={a} size="sm" variant="outlined">
                        {a}
                      </Chip>
                    ))}
                  </Box>
                </td>
                <td>{r.sla}s</td>
                <td>
                  <Chip size="sm" variant="soft" color={r.waiting > 0 ? "warning" : "neutral"}>
                    {r.waiting} waiting
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
// 11. Call Reports (CDR)
// ===========================================================================

interface CdrRow {
  time: string;
  from: string;
  to: string;
  direction: "Inbound" | "Outbound" | "Internal";
  duration: string;
  status: "Answered" | "Missed" | "Voicemail" | "Busy";
  recording: boolean;
}

const MOCK_CDR: CdrRow[] = [
  { time: "2026-06-12 09:14", from: "+1 (415) 555-0100", to: "1001", direction: "Inbound", duration: "04:21", status: "Answered", recording: true },
  { time: "2026-06-12 09:02", from: "1002", to: "+1 (650) 555-0190", direction: "Outbound", duration: "01:08", status: "Answered", recording: true },
  { time: "2026-06-12 08:55", from: "+1 (415) 555-0142", to: "2001", direction: "Inbound", duration: "00:00", status: "Missed", recording: false },
  { time: "2026-06-12 08:40", from: "1004", to: "1001", direction: "Internal", duration: "02:37", status: "Answered", recording: false },
  { time: "2026-06-12 08:21", from: "+1 (212) 555-0177", to: "1003", direction: "Inbound", duration: "00:32", status: "Voicemail", recording: true },
];

function ReportsSection() {
  const [rows] = useState(MOCK_CDR);

  return (
    <Box>
      <SectionHeader
        title="Call Reports"
        description="Call-detail records (CDR) for inbound, outbound, and internal calls."
      />

      <PanelSheet>
        <Box sx={{ p: 2.5 }}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr 1fr" },
              gap: 2,
            }}
          >
            <FormControl>
              <FormLabel>From date</FormLabel>
              <Input type="date" defaultValue="2026-06-01" />
            </FormControl>
            <FormControl>
              <FormLabel>To date</FormLabel>
              <Input type="date" defaultValue="2026-06-12" />
            </FormControl>
            <FormControl>
              <FormLabel>Direction</FormLabel>
              <Select defaultValue="all">
                <Option value="all">All</Option>
                <Option value="inbound">Inbound</Option>
                <Option value="outbound">Outbound</Option>
                <Option value="internal">Internal</Option>
              </Select>
            </FormControl>
            <FormControl>
              <FormLabel>Status</FormLabel>
              <Select defaultValue="all">
                <Option value="all">All</Option>
                <Option value="answered">Answered</Option>
                <Option value="missed">Missed</Option>
                <Option value="voicemail">Voicemail</Option>
                <Option value="busy">Busy</Option>
              </Select>
            </FormControl>
          </Box>
        </Box>
      </PanelSheet>

      <PanelSheet>
        <Table hoverRow sx={{ "--TableCell-paddingX": "16px" }}>
          <thead>
            <tr>
              <th style={{ width: 160 }}>Time</th>
              <th>From</th>
              <th>To</th>
              <th style={{ width: 120 }}>Direction</th>
              <th style={{ width: 110 }}>Duration</th>
              <th style={{ width: 120 }}>Status</th>
              <th style={{ width: 110 }}>Recording</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{r.time}</td>
                <td style={{ fontFamily: "monospace" }}>{r.from}</td>
                <td style={{ fontFamily: "monospace" }}>{r.to}</td>
                <td>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={r.direction === "Inbound" ? "primary" : r.direction === "Outbound" ? "success" : "neutral"}
                  >
                    {r.direction}
                  </Chip>
                </td>
                <td style={{ fontFamily: "monospace" }}>{r.duration}</td>
                <td>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={r.status === "Answered" ? "success" : r.status === "Missed" || r.status === "Busy" ? "danger" : "warning"}
                  >
                    {r.status}
                  </Chip>
                </td>
                <td>
                  {r.recording ? (
                    <IconButton size="sm" variant="plain" color="neutral" aria-label="Play recording">
                      <PlayArrowIcon fontSize="small" />
                    </IconButton>
                  ) : (
                    <Typography level="body-xs" sx={{ opacity: 0.5 }}>
                      —
                    </Typography>
                  )}
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
// 12. Recordings
// ===========================================================================

interface RecordingRow {
  date: string;
  parties: string;
  duration: string;
}

const MOCK_RECORDINGS: RecordingRow[] = [
  { date: "2026-06-12 09:14", parties: "+1 (415) 555-0100 → 1001", duration: "04:21" },
  { date: "2026-06-12 09:02", parties: "1002 → +1 (650) 555-0190", duration: "01:08" },
  { date: "2026-06-12 08:21", parties: "+1 (212) 555-0177 → 1003", duration: "00:32" },
  { date: "2026-06-11 16:48", parties: "1004 → +1 (415) 555-0142", duration: "08:55" },
];

/** Filename-safe slug for a recording's download name. */
function recordingFilename(r: RecordingRow): string {
  const date = r.date.replace(/[: ]/g, "-");
  const parties = r.parties.replace(/[^0-9A-Za-z]+/g, "_").replace(/^_+|_+$/g, "");
  return `recording-${date}-${parties}.wav`;
}

function RecordingsSection() {
  const [rows, setRows] = useState(MOCK_RECORDINGS);
  const [retention, setRetention] = useState("90");
  const [playing, setPlaying] = useState<number | null>(null);
  // One reusable <audio>; blobs synthesized lazily and cached by row key.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobCache = useRef<Map<string, Blob>>(new Map());

  function blobFor(r: RecordingRow): Blob {
    const key = recordingFilename(r);
    let b = blobCache.current.get(key);
    if (!b) {
      // Seed from the row so each recording sounds stable across renders.
      let seed = 0;
      for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) | 0;
      b = makeRecordingWav(durationToSeconds(r.duration), seed);
      blobCache.current.set(key, b);
    }
    return b;
  }

  function togglePlay(i: number) {
    const r = rows[i];
    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio();
      audio.addEventListener("ended", () => setPlaying(null));
      audioRef.current = audio;
    }
    if (playing === i) {
      audio.pause();
      setPlaying(null);
      return;
    }
    audio.src = URL.createObjectURL(blobFor(r));
    void audio.play();
    setPlaying(i);
    logActivity("Recording played", `${r.parties} (${r.duration})`);
  }

  function download(i: number) {
    const r = rows[i];
    downloadBlob(blobFor(r), recordingFilename(r));
    logActivity("Recording downloaded", `${r.parties} (${r.duration})`);
  }

  function remove(i: number) {
    const r = rows[i];
    if (playing === i) {
      audioRef.current?.pause();
      setPlaying(null);
    }
    setRows((prev) => prev.filter((_, idx) => idx !== i));
    logActivity("Recording deleted", `${r.parties} (${r.duration})`);
  }

  function changeRetention(v: string) {
    setRetention(v);
    const label =
      v === "forever" ? "Keep forever" : v === "365" ? "1 year" : `${v} days`;
    logActivity("Retention changed", `Recording retention set to ${label}`);
  }

  return (
    <Box>
      <SectionHeader
        title="Recordings"
        description="Stored call recordings, storage usage, and retention policy."
      />

      <PanelSheet>
        <Box sx={{ p: 2.5 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
            <Typography level="title-sm">Storage usage</Typography>
            <Typography level="body-sm" sx={{ opacity: 0.7 }}>
              164 GB of 200 GB
            </Typography>
          </Box>
          <Box
            sx={{
              height: 10,
              borderRadius: "sm",
              bgcolor: "neutral.softBg",
              overflow: "hidden",
              mb: 2,
            }}
          >
            <Box sx={{ width: "82%", height: "100%", bgcolor: ACCENT }} />
          </Box>
          <FormControl sx={{ maxWidth: 280 }}>
            <FormLabel>Retention period</FormLabel>
            <Select value={retention} onChange={(_, v) => v && changeRetention(v)}>
              <Option value="30">30 days</Option>
              <Option value="90">90 days</Option>
              <Option value="180">180 days</Option>
              <Option value="365">1 year</Option>
              <Option value="forever">Keep forever</Option>
            </Select>
          </FormControl>
        </Box>
      </PanelSheet>

      <PanelSheet>
        <Table hoverRow sx={{ "--TableCell-paddingX": "16px" }}>
          <thead>
            <tr>
              <th style={{ width: 160 }}>Date</th>
              <th>Parties</th>
              <th style={{ width: 110 }}>Duration</th>
              <th style={{ width: 100 }}>Size</th>
              <th style={{ width: 130 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", opacity: 0.6, padding: 24 }}>
                  No recordings.
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={recordingFilename(r)}>
                <td style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{r.date}</td>
                <td style={{ fontFamily: "monospace" }}>{r.parties}</td>
                <td style={{ fontFamily: "monospace" }}>{r.duration}</td>
                <td>{formatSize(recordingBytes(durationToSeconds(r.duration)))}</td>
                <td>
                  <Box sx={{ display: "flex", gap: 0.5, justifyContent: "flex-end" }}>
                    <IconButton
                      size="sm"
                      variant="plain"
                      color="neutral"
                      aria-label={playing === i ? "Pause" : "Play"}
                      onClick={() => togglePlay(i)}
                    >
                      {playing === i ? (
                        <PauseIcon fontSize="small" />
                      ) : (
                        <PlayArrowIcon fontSize="small" />
                      )}
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="plain"
                      color="neutral"
                      aria-label="Download"
                      onClick={() => download(i)}
                    >
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="plain"
                      color="danger"
                      aria-label="Delete"
                      onClick={() => remove(i)}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Box>
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
// 13. Music on Hold
// ===========================================================================

interface MohRow {
  name: string;
  tracks: number;
  source: "Uploaded" | "Stream";
  assignedTo: string;
}

const MOCK_MOH: MohRow[] = [
  { name: "Default", tracks: 5, source: "Uploaded", assignedTo: "System default" },
  { name: "Sales", tracks: 3, source: "Uploaded", assignedTo: "Sales Queue" },
  { name: "Support", tracks: 4, source: "Stream", assignedTo: "Support Queue" },
];

function MohSection() {
  const [rows] = useState(MOCK_MOH);

  return (
    <Box>
      <SectionHeader
        title="Music on Hold"
        description="Playlists and audio sources played to callers while on hold."
        action={
          <Button startDecorator={<AddIcon />} variant="solid" sx={{ bgcolor: ACCENT }}>
            Upload track
          </Button>
        }
      />

      <PanelSheet>
        <Table hoverRow sx={{ "--TableCell-paddingX": "16px" }}>
          <thead>
            <tr>
              <th>Playlist / Source</th>
              <th style={{ width: 110 }}>Tracks</th>
              <th style={{ width: 130 }}>Source</th>
              <th>Assigned to</th>
              <th style={{ width: 90 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{r.tracks}</td>
                <td>
                  <Chip size="sm" variant="soft" color={r.source === "Stream" ? "primary" : "neutral"}>
                    {r.source}
                  </Chip>
                </td>
                <td style={{ opacity: 0.8 }}>{r.assignedTo}</td>
                <td>
                  <RowActions />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PanelSheet>

      <Typography level="body-xs" sx={{ opacity: 0.6, px: 0.5 }}>
        Each ring group and call queue can be assigned its own on-hold playlist.
      </Typography>
    </Box>
  );
}

// ===========================================================================
// 14. FAX
// ===========================================================================

interface FaxRow {
  time: string;
  direction: "Received" | "Sent";
  party: string;
  pages: number;
  status: "Delivered" | "Failed" | "Received";
}

const MOCK_FAX: FaxRow[] = [
  { time: "2026-06-12 08:30", direction: "Received", party: "+1 (415) 555-0133", pages: 3, status: "Received" },
  { time: "2026-06-11 14:12", direction: "Sent", party: "+1 (650) 555-0144", pages: 1, status: "Delivered" },
  { time: "2026-06-10 11:05", direction: "Sent", party: "+1 (212) 555-0166", pages: 2, status: "Failed" },
];

function FaxSection() {
  const [faxToEmail, setFaxToEmail] = useState(true);
  const [rows] = useState(MOCK_FAX);

  return (
    <Box>
      <SectionHeader
        title="FAX"
        description="Virtual fax with fax-to-email delivery and a transmission log."
      />

      <PanelSheet>
        <Box sx={{ p: 2.5 }}>
          <Typography level="title-sm" sx={{ mb: 1.5 }}>
            Fax-to-email
          </Typography>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
              mb: 2,
              maxWidth: 560,
            }}
          >
            <Box>
              <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                Deliver inbound faxes by email
              </Typography>
              <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                Received faxes are converted to PDF and emailed.
              </Typography>
            </Box>
            <Switch checked={faxToEmail} onChange={(e) => setFaxToEmail(e.target.checked)} />
          </Box>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: 2,
              maxWidth: 640,
            }}
          >
            <FormControl>
              <FormLabel>Fax DID</FormLabel>
              <Input placeholder="+1 (415) 555-0199" />
            </FormControl>
            <FormControl>
              <FormLabel>Deliver to email</FormLabel>
              <Input placeholder="fax@example.com" />
            </FormControl>
          </Box>
        </Box>
      </PanelSheet>

      <PanelSheet>
        <Table hoverRow sx={{ "--TableCell-paddingX": "16px" }}>
          <thead>
            <tr>
              <th style={{ width: 160 }}>Time</th>
              <th style={{ width: 120 }}>Direction</th>
              <th>Party</th>
              <th style={{ width: 90 }}>Pages</th>
              <th style={{ width: 130 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{r.time}</td>
                <td>
                  <Chip size="sm" variant="soft" color={r.direction === "Received" ? "primary" : "success"}>
                    {r.direction}
                  </Chip>
                </td>
                <td style={{ fontFamily: "monospace" }}>{r.party}</td>
                <td>{r.pages}</td>
                <td>
                  <Chip size="sm" variant="soft" color={r.status === "Failed" ? "danger" : "success"}>
                    {r.status}
                  </Chip>
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
// 15. Contacts (Phonebook)
// ===========================================================================

interface ContactRow {
  name: string;
  company: string;
  numbers: string;
  ext: string;
}

const MOCK_CONTACTS: ContactRow[] = [
  { name: "Jane Cooper", company: "Acme Corp", numbers: "+1 (415) 555-0100", ext: "—" },
  { name: "Robert Fox", company: "Globex", numbers: "+1 (650) 555-0190", ext: "—" },
  { name: "Ada Lovelace", company: "Internal", numbers: "+1 (415) 555-0188", ext: "1001" },
  { name: "Front Desk", company: "Internal", numbers: "+1 (415) 555-0188", ext: "1004" },
];

function ContactsSection() {
  const [adding, setAdding] = useState(false);
  const [rows] = useState(MOCK_CONTACTS);

  return (
    <Box>
      <SectionHeader
        title="Contacts (Phonebook)"
        description="Company phonebook used for caller-ID name lookup and click-to-dial."
        action={
          <Button
            startDecorator={<AddIcon />}
            onClick={() => setAdding((v) => !v)}
            variant={adding ? "soft" : "solid"}
            sx={{ bgcolor: adding ? undefined : ACCENT }}
          >
            Add contact
          </Button>
        }
      />

      {adding && (
        <PanelSheet>
          <Box sx={{ p: 2.5 }}>
            <Typography level="title-sm" sx={{ mb: 1.5 }}>
              New contact
            </Typography>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                gap: 2,
              }}
            >
              <FormControl>
                <FormLabel>Name</FormLabel>
                <Input placeholder="Jane Cooper" />
              </FormControl>
              <FormControl>
                <FormLabel>Company</FormLabel>
                <Input placeholder="Acme Corp" />
              </FormControl>
              <FormControl>
                <FormLabel>Phone number</FormLabel>
                <Input placeholder="+1 (415) 555-0100" />
              </FormControl>
              <FormControl>
                <FormLabel>Internal extension</FormLabel>
                <Input placeholder="optional" />
              </FormControl>
            </Box>
            <Box sx={{ display: "flex", gap: 1, mt: 2 }}>
              <Button variant="solid" sx={{ bgcolor: ACCENT }} disabled>
                Save contact
              </Button>
              <Button variant="soft" color="neutral" disabled>
                Import CSV
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
              <th>Company</th>
              <th>Number(s)</th>
              <th style={{ width: 90 }}>Ext</th>
              <th style={{ width: 90 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.name}</td>
                <td style={{ opacity: 0.8 }}>{r.company}</td>
                <td style={{ fontFamily: "monospace" }}>{r.numbers}</td>
                <td style={{ fontFamily: "monospace" }}>{r.ext}</td>
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
// 16. Phones (Provisioning)
// ===========================================================================

interface PhoneRow {
  mac: string;
  model: string;
  extension: string;
  firmware: string;
  status: "Online" | "Offline";
}

const MOCK_PHONES: PhoneRow[] = [
  { mac: "00:04:13:AB:CD:01", model: "Yealink T54W", extension: "1002", firmware: "96.86.0.85", status: "Online" },
  { mac: "00:04:13:AB:CD:02", model: "Yealink T31P", extension: "1004", firmware: "124.86.0.40", status: "Online" },
  { mac: "00:15:65:11:22:33", model: "Grandstream GRP2614", extension: "1003", firmware: "1.0.11.48", status: "Offline" },
];

function PhonesSection() {
  const [autoProvision, setAutoProvision] = useState(true);
  const [rows] = useState(MOCK_PHONES);

  return (
    <Box>
      <SectionHeader
        title="Phones (Provisioning)"
        description="Auto-provision desk phones with their extension and firmware settings."
        action={
          <Button startDecorator={<AddIcon />} variant="solid" sx={{ bgcolor: ACCENT }}>
            Add phone
          </Button>
        }
      />

      <PanelSheet>
        <Box
          sx={{
            p: 2.5,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 2,
          }}
        >
          <Box>
            <Typography level="body-sm" sx={{ fontWeight: 600 }}>
              Auto-provisioning
            </Typography>
            <Typography level="body-xs" sx={{ opacity: 0.7 }}>
              Serve config files to phones by MAC over the provisioning server.
            </Typography>
          </Box>
          <Switch checked={autoProvision} onChange={(e) => setAutoProvision(e.target.checked)} />
        </Box>
      </PanelSheet>

      <PanelSheet>
        <Table hoverRow sx={{ "--TableCell-paddingX": "16px" }}>
          <thead>
            <tr>
              <th style={{ width: 180 }}>MAC address</th>
              <th>Model</th>
              <th style={{ width: 130 }}>Extension</th>
              <th style={{ width: 150 }}>Firmware</th>
              <th style={{ width: 120 }}>Status</th>
              <th style={{ width: 90 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.mac}>
                <td style={{ fontFamily: "monospace" }}>{r.mac}</td>
                <td>{r.model}</td>
                <td style={{ fontFamily: "monospace" }}>{r.extension}</td>
                <td style={{ fontFamily: "monospace", opacity: 0.8 }}>{r.firmware}</td>
                <td>
                  <Chip size="sm" variant="soft" color={r.status === "Online" ? "success" : "danger"}>
                    {r.status}
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
// 17. Security
// ===========================================================================

interface BlockedRow {
  value: string;
  type: "IP" | "Number";
  reason: string;
  added: string;
}

const MOCK_BLOCKED: BlockedRow[] = [
  { value: "203.0.113.45", type: "IP", reason: "Repeated SIP auth failures", added: "2026-06-10" },
  { value: "198.51.100.12", type: "IP", reason: "Port scan", added: "2026-06-08" },
  { value: "+1 (900) 555-0123", type: "Number", reason: "Toll fraud pattern", added: "2026-06-05" },
];

const ALL_COUNTRIES = ["United States", "Canada", "United Kingdom", "Germany", "Australia", "Mexico"];

function SecuritySection() {
  const [sipIds, setSipIds] = useState(true);
  const [allowedCountries, setAllowedCountries] = useState<string[]>(["United States", "Canada"]);
  const [rows] = useState(MOCK_BLOCKED);

  return (
    <Box>
      <SectionHeader
        title="Security"
        description="Anti-fraud, intrusion detection, and SIP attack protection."
      />

      <PanelSheet>
        <Box sx={{ p: 2.5 }}>
          <Typography level="title-sm" sx={{ mb: 1.5 }}>
            Protection
          </Typography>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
              mb: 2,
              maxWidth: 560,
            }}
          >
            <Box>
              <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                SIP intrusion detection (IDS)
              </Typography>
              <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                Auto-ban IPs that exceed the failed-auth threshold.
              </Typography>
            </Box>
            <Switch checked={sipIds} onChange={(e) => setSipIds(e.target.checked)} />
          </Box>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: 2,
              maxWidth: 640,
            }}
          >
            <FormControl>
              <FormLabel>Failed-auth attempts before lockout</FormLabel>
              <Input type="number" defaultValue="5" />
            </FormControl>
            <FormControl>
              <FormLabel>Lockout duration (minutes)</FormLabel>
              <Input type="number" defaultValue="30" />
            </FormControl>
            <FormControl sx={{ gridColumn: { sm: "1 / -1" } }}>
              <FormLabel>Allowed outbound countries</FormLabel>
              <Select
                multiple
                value={allowedCountries}
                onChange={(_, value) => setAllowedCountries(value as string[])}
                renderValue={(selected) => (
                  <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                    {selected.map((o) => (
                      <Chip key={o.value} size="sm" variant="soft">
                        {o.label}
                      </Chip>
                    ))}
                  </Box>
                )}
              >
                {ALL_COUNTRIES.map((c) => (
                  <Option key={c} value={c}>
                    {c}
                  </Option>
                ))}
              </Select>
            </FormControl>
          </Box>
        </Box>
      </PanelSheet>

      <PanelSheet>
        <Box sx={{ p: 2.5, pb: 1 }}>
          <Typography level="title-sm">Blacklist</Typography>
        </Box>
        <Table hoverRow sx={{ "--TableCell-paddingX": "16px" }}>
          <thead>
            <tr>
              <th>Value</th>
              <th style={{ width: 100 }}>Type</th>
              <th>Reason</th>
              <th style={{ width: 130 }}>Added</th>
              <th style={{ width: 90 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.value}>
                <td style={{ fontFamily: "monospace" }}>{r.value}</td>
                <td>
                  <Chip size="sm" variant="soft" color={r.type === "IP" ? "primary" : "warning"}>
                    {r.type}
                  </Chip>
                </td>
                <td style={{ opacity: 0.8 }}>{r.reason}</td>
                <td style={{ fontFamily: "monospace" }}>{r.added}</td>
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
// 18. Backup & Restore
// ===========================================================================

interface BackupRow {
  date: string;
  size: string;
  type: "Scheduled" | "Manual";
}

const MOCK_BACKUPS: BackupRow[] = [
  { date: "2026-06-12 02:00", size: "248 MB", type: "Scheduled" },
  { date: "2026-06-11 02:00", size: "246 MB", type: "Scheduled" },
  { date: "2026-06-10 15:32", size: "245 MB", type: "Manual" },
];

function BackupSection() {
  const [rows] = useState(MOCK_BACKUPS);

  return (
    <Box>
      <SectionHeader
        title="Backup & Restore"
        description="Scheduled and on-demand backups of PBX configuration and data."
        action={
          <Button startDecorator={<BackupIcon />} variant="solid" sx={{ bgcolor: ACCENT }}>
            Backup now
          </Button>
        }
      />

      <PanelSheet>
        <Box sx={{ p: 2.5 }}>
          <Typography level="title-sm" sx={{ mb: 1.5 }}>
            Schedule
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" },
              gap: 2,
            }}
          >
            <FormControl>
              <FormLabel>Frequency</FormLabel>
              <Select defaultValue="daily">
                <Option value="daily">Daily</Option>
                <Option value="weekly">Weekly</Option>
                <Option value="monthly">Monthly</Option>
              </Select>
            </FormControl>
            <FormControl>
              <FormLabel>Time</FormLabel>
              <Input type="time" defaultValue="02:00" />
            </FormControl>
            <FormControl>
              <FormLabel>Keep last N backups</FormLabel>
              <Input type="number" defaultValue="14" />
            </FormControl>
          </Box>
        </Box>
      </PanelSheet>

      <PanelSheet>
        <Table hoverRow sx={{ "--TableCell-paddingX": "16px" }}>
          <thead>
            <tr>
              <th style={{ width: 180 }}>Date</th>
              <th style={{ width: 120 }}>Size</th>
              <th style={{ width: 140 }}>Type</th>
              <th style={{ width: 160 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{r.date}</td>
                <td>{r.size}</td>
                <td>
                  <Chip size="sm" variant="soft" color={r.type === "Scheduled" ? "primary" : "neutral"}>
                    {r.type}
                  </Chip>
                </td>
                <td>
                  <Box sx={{ display: "flex", gap: 0.5, justifyContent: "flex-end" }}>
                    <Button size="sm" variant="soft" color="neutral">
                      Restore
                    </Button>
                    <IconButton size="sm" variant="plain" color="neutral" aria-label="Download">
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </Box>
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
// 19. Activity Log
// ===========================================================================

function ActivitySection() {
  const all = useActivityLog();
  const [query, setQuery] = useState("");
  const [actor, setActor] = useState("all");

  const actors = useMemo(
    () => Array.from(new Set(all.map((r) => r.actor))).sort(),
    [all],
  );
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((r) => {
      if (actor !== "all" && r.actor !== actor) return false;
      if (!q) return true;
      return (
        r.event.toLowerCase().includes(q) ||
        r.detail.toLowerCase().includes(q) ||
        r.actor.toLowerCase().includes(q) ||
        r.time.toLowerCase().includes(q)
      );
    });
  }, [all, query, actor]);

  return (
    <Box>
      <SectionHeader
        title="Activity Log"
        description="Live audit trail of configuration changes and system events. Actions you take in this console are recorded here and persist on this device."
        action={
          <Button
            startDecorator={<DeleteOutlineIcon />}
            variant="soft"
            color="danger"
            onClick={() => {
              if (confirm("Clear the entire activity log?")) clearActivity();
            }}
          >
            Clear log
          </Button>
        }
      />

      <PanelSheet>
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", p: 2, pb: 1.5 }}>
          <Input
            size="sm"
            placeholder="Search events…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            startDecorator={<SearchIcon fontSize="small" />}
            sx={{ flex: 1, minWidth: 200 }}
          />
          <Select
            size="sm"
            value={actor}
            onChange={(_, v) => v && setActor(v)}
            sx={{ minWidth: 200 }}
          >
            <Option value="all">All actors</Option>
            {actors.map((a) => (
              <Option key={a} value={a}>
                {a}
              </Option>
            ))}
          </Select>
        </Box>
        <Table hoverRow sx={{ "--TableCell-paddingX": "16px" }}>
          <thead>
            <tr>
              <th style={{ width: 160 }}>Time</th>
              <th style={{ width: 180 }}>Actor</th>
              <th style={{ width: 180 }}>Event</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: "center", opacity: 0.6, padding: 24 }}>
                  {all.length === 0 ? "No activity yet." : "No entries match your filter."}
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.time + r.event + i}>
                <td style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{r.time}</td>
                <td style={{ fontFamily: "monospace" }}>{r.actor}</td>
                <td>{r.event}</td>
                <td style={{ opacity: 0.8 }}>{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PanelSheet>
    </Box>
  );
}

// ===========================================================================
// 20. Email (SMTP)
// ===========================================================================

function EmailSection() {
  const [useTls, setUseTls] = useState(true);

  return (
    <Box>
      <SectionHeader
        title="Email (SMTP)"
        description="Outbound mail server for voicemail-to-email, faxes, and reports."
      />
      <PanelSheet>
        <Box sx={{ p: 2.5 }}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: 2,
              maxWidth: 640,
            }}
          >
            <FormControl>
              <FormLabel>SMTP host</FormLabel>
              <Input placeholder="smtp.example.com" />
            </FormControl>
            <FormControl>
              <FormLabel>Port</FormLabel>
              <Input type="number" defaultValue="587" />
            </FormControl>
            <FormControl>
              <FormLabel>Username</FormLabel>
              <Input placeholder="pbx@example.com" />
            </FormControl>
            <FormControl>
              <FormLabel>Password</FormLabel>
              <Input type="password" placeholder="••••••••" />
            </FormControl>
            <FormControl>
              <FormLabel>From address</FormLabel>
              <Input placeholder="pbx@example.com" />
            </FormControl>
            <FormControl>
              <FormLabel>From name</FormLabel>
              <Input defaultValue="Company PBX" />
            </FormControl>
          </Box>

          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
              mt: 2,
              maxWidth: 640,
            }}
          >
            <Box>
              <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                Use TLS / STARTTLS
              </Typography>
              <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                Encrypt the connection to the mail server.
              </Typography>
            </Box>
            <Switch checked={useTls} onChange={(e) => setUseTls(e.target.checked)} />
          </Box>

          <Box sx={{ display: "flex", gap: 1, mt: 2 }}>
            <Button variant="solid" sx={{ bgcolor: ACCENT }} disabled>
              Save
            </Button>
            <Button variant="soft" color="neutral" disabled>
              Send test email
            </Button>
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
    case "dashboard":
      return <DashboardSection />;
    case "extensions":
      return <ExtensionsSection />;
    case "ringgroups":
      return <RingGroupsSection />;
    case "queues":
      return <QueuesSection />;
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
    case "moh":
      return <MohSection />;
    case "fax":
      return <FaxSection />;
    case "contacts":
      return <ContactsSection />;
    case "reports":
      return <ReportsSection />;
    case "recordings":
      return <RecordingsSection />;
    case "activity":
      return <ActivitySection />;
    case "phones":
      return <PhonesSection />;
    case "security":
      return <SecuritySection />;
    case "backup":
      return <BackupSection />;
    case "email":
      return <EmailSection />;
    case "settings":
      return <SettingsSection />;
  }
}

// ===========================================================================
// AdminArea — top-level layout (left sub-nav + right content panel).
// ===========================================================================

export function AdminArea({ user }: AdminAreaProps) {
  const [active, setActive] = useState<SectionId>("dashboard");

  // Preserve declaration order while grouping by category for the sub-nav.
  const groupedSections: { group: string; items: SectionDef[] }[] = [];
  for (const s of SECTIONS) {
    let bucket = groupedSections.find((g) => g.group === s.group);
    if (!bucket) {
      bucket = { group: s.group, items: [] };
      groupedSections.push(bucket);
    }
    bucket.items.push(s);
  }

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
          {groupedSections.map((g) => [
            <ListItem key={`head-${g.group}`} sticky>
              <Typography level="body-xs" sx={{ textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.7 }}>
                {g.group}
              </Typography>
            </ListItem>,
            ...g.items.map((s) => (
              <Option key={s.id} value={s.id}>
                {s.label}
              </Option>
            )),
          ])}
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
            {groupedSections.map((g, gi) => (
              <Box key={g.group}>
                <Typography
                  level="body-xs"
                  sx={{
                    px: 1,
                    pt: gi === 0 ? 0.5 : 1.25,
                    pb: 0.5,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    opacity: 0.55,
                    fontWeight: 600,
                  }}
                >
                  {g.group}
                </Typography>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                  {g.items.map((s) => {
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
              </Box>
            ))}
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
