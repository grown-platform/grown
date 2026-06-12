/**
 * Catalog of all planned-app tiles surfaced on the dashboard.
 *
 * Each tile renders as a card on the dashboard and routes to a "coming
 * soon" page on click. As real app phases ship, the `comingSoon` flag
 * flips to false and the tile points at the app's mount path instead.
 */
export interface AppTile {
  /** URL-safe identifier; used in the coming-soon route param. */
  id: string;
  /** Display name shown on the tile. */
  name: string;
  /** One-line description shown under the name. */
  blurb: string;
  /** Hex accent color used for the tile's avatar circle. */
  accentColor: string;
  /** Implementation phase per the V1 design spec (1–4). */
  phase: 1 | 2 | 3 | 4;
  /** True until the underlying app ships. */
  comingSoon: boolean;
  /** Export name of the @mui/icons-material icon to show in the avatar. */
  iconName: string;
  /** If set, the tile links out to this URL in a new tab (e.g. an external
   *  git service) instead of an internal route. */
  externalUrl?: string;
  /** Optional richer "what it will do" bullets shown on the coming-soon page. */
  details?: string[];
}

/** GIT_URL points the Git tile at the org's git service. Override at build time
 *  with VITE_GIT_URL; defaults to Codeberg's public explore page. */
const GIT_URL =
  (import.meta.env.VITE_GIT_URL as string | undefined) ||
  "https://codeberg.org/explore/repos";

/** ASSEMBLE_URL points the Assemble tile at the spatial-collab service. Override
 *  with VITE_ASSEMBLE_URL; defaults to the self-hosted Assemble instance.
 *  The ?sso=grown hint tells Assemble the visitor came from the grown suite, so
 *  it silently signs them in against the shared Zitadel (no second login). */
const ASSEMBLE_BASE =
  (import.meta.env.VITE_ASSEMBLE_URL as string | undefined) ||
  "https://assemble.pick.haus";
const ASSEMBLE_URL =
  ASSEMBLE_BASE + (ASSEMBLE_BASE.includes("?") ? "&" : "?") + "sso=grown";

/** SPACELIGHT_URL points the Spacelight tile at the self-hosted Spacelight app.
 *  Override with VITE_SPACELIGHT_URL. */
const SPACELIGHT_URL =
  (import.meta.env.VITE_SPACELIGHT_URL as string | undefined) ||
  "https://spacelight.pick.haus";

/** PDF_URL points the PDF tile at the integrated PDF editor & signing app
 *  (pdf), proxied under grown's origin. Override with VITE_PDF_URL. */
const PDF_URL = (import.meta.env.VITE_PDF_URL as string | undefined) || "/pdf/";

/** CRM_URL points the CRM tile at the integrated Twenty (twentyhq/twenty) CRM,
 *  served on a dedicated subdomain that grown reverse-proxies (by Host) straight
 *  to Twenty at root. Override with VITE_CRM_URL. */
const CRM_URL =
  (import.meta.env.VITE_CRM_URL as string | undefined) ||
  "http://crm.workspace.localtest.me:8080/";

export const apps: AppTile[] = [
  // Phase 1: foundational data apps
  {
    id: "drive",
    name: "Drive",
    blurb: "Files, folders, sharing.",
    accentColor: "#3F88C5",
    phase: 1,
    comingSoon: false,
    iconName: "Folder",
  },
  {
    id: "calendar",
    name: "Calendar",
    blurb: "Schedules, events, free/busy.",
    accentColor: "#E0777D",
    phase: 1,
    comingSoon: false,
    iconName: "CalendarToday",
  },
  {
    id: "contacts",
    name: "Contacts",
    blurb: "Address book.",
    accentColor: "#5B9279",
    phase: 1,
    comingSoon: false,
    iconName: "Contacts",
  },
  {
    id: "whiteboard",
    name: "Whiteboard",
    blurb: "Excalidraw-based drawing surface.",
    accentColor: "#C46B45",
    phase: 1,
    comingSoon: false,
    iconName: "Draw",
  },

  // Phase 2: communication
  {
    id: "mail",
    name: "Mail",
    blurb: "Email, threads, search.",
    accentColor: "#D64550",
    phase: 2,
    comingSoon: false,
    iconName: "Mail",
  },
  {
    id: "chat",
    name: "Chat",
    blurb: "Direct and group messages.",
    accentColor: "#7A5980",
    phase: 2,
    comingSoon: false,
    iconName: "Chat",
  },
  {
    id: "meet",
    name: "Meet",
    blurb: "Video calls and meetings.",
    accentColor: "#2A9D8F",
    phase: 2,
    comingSoon: false,
    iconName: "Videocam",
  },

  // Phase 3: documents
  {
    id: "docs",
    name: "Docs",
    blurb: "Collaborative text documents.",
    accentColor: "#3D5A80",
    phase: 3,
    comingSoon: false,
    iconName: "Description",
  },
  {
    id: "sheets",
    name: "Sheets",
    blurb: "Collaborative spreadsheets.",
    accentColor: "#1D8348",
    phase: 3,
    comingSoon: false,
    iconName: "TableChart",
  },
  {
    id: "slides",
    name: "Slides",
    blurb: "Collaborative presentations.",
    accentColor: "#D9A441",
    phase: 3,
    comingSoon: false,
    iconName: "CoPresent",
  },
  {
    id: "pdf",
    name: "PDF",
    blurb: "PDF editor & sign.",
    accentColor: "#B5230D",
    phase: 3,
    comingSoon: false,
    iconName: "PictureAsPdf",
    externalUrl: PDF_URL,
  },
  {
    id: "pdf-editor",
    name: "PDF Editor",
    blurb: "Edit & annotate PDFs.",
    accentColor: "#C2410C",
    phase: 3,
    comingSoon: false,
    iconName: "EditNote",
    // Deep-link straight to the signing-free editor (focused layout).
    externalUrl: `${PDF_URL}editor`,
  },
  {
    id: "forms",
    name: "Forms",
    blurb: "Surveys and quizzes.",
    accentColor: "#7E4E6F",
    phase: 3,
    comingSoon: false,
    iconName: "Assignment",
  },
  {
    id: "photos",
    name: "Photos",
    blurb: "Photo library and sharing.",
    accentColor: "#B8627D",
    phase: 3,
    comingSoon: false,
    iconName: "PhotoLibrary",
  },

  // Phase 4: auxiliary + admin
  {
    id: "keep",
    name: "Keep",
    blurb: "Quick notes.",
    accentColor: "#E8B14F",
    phase: 4,
    comingSoon: false,
    iconName: "Lightbulb",
  },
  {
    id: "tasks",
    name: "Tasks",
    blurb: "Task lists and to-dos.",
    accentColor: "#1A73E8",
    phase: 4,
    comingSoon: false,
    iconName: "TaskAlt",
  },
  {
    id: "sites",
    name: "Sites",
    blurb: "Internal site builder.",
    accentColor: "#5A9367",
    phase: 4,
    comingSoon: false,
    iconName: "Web",
  },
  {
    id: "groups",
    name: "Groups",
    blurb: "Mailing lists and forums.",
    accentColor: "#8E6E53",
    phase: 4,
    comingSoon: false,
    iconName: "Groups",
  },
  {
    id: "access",
    name: "Access",
    blurb: "Clientless access to internal apps, terminals & your tailnet.",
    accentColor: "#2563EB",
    phase: 4,
    comingSoon: false,
    iconName: "Lan",
  },
  {
    id: "admin",
    name: "Admin",
    blurb: "User and org management.",
    accentColor: "#5f6368",
    phase: 4,
    comingSoon: false,
    iconName: "AdminPanelSettings",
  },

  // Future / additional services
  {
    id: "assemble",
    name: "Assemble",
    blurb: "Spatial collaboration space.",
    accentColor: "#6C5CE7",
    phase: 4,
    comingSoon: false,
    iconName: "Hub",
    externalUrl: ASSEMBLE_URL,
  },
  {
    id: "spacelight",
    name: "Spacelight",
    blurb: "Family hub & home dashboard.",
    accentColor: "#5C6BC0",
    phase: 4,
    comingSoon: false,
    iconName: "Cottage",
    externalUrl: SPACELIGHT_URL,
  },
  {
    id: "projects",
    name: "Projects",
    blurb: "Project & issue tracking.",
    accentColor: "#0984E3",
    phase: 4,
    comingSoon: false,
    iconName: "ViewKanban",
  },
  {
    id: "crm",
    name: "CRM",
    blurb: "Customer relationships (Twenty).",
    accentColor: "#3B5BDB",
    phase: 4,
    comingSoon: false,
    iconName: "Handshake",
    externalUrl: CRM_URL,
  },
  {
    id: "books",
    name: "Books",
    blurb: "Library & reading.",
    accentColor: "#A0522D",
    phase: 4,
    comingSoon: false,
    iconName: "MenuBook",
  },
  {
    id: "music",
    name: "Music",
    blurb: "Streaming & playlists.",
    accentColor: "#FF0033",
    phase: 4,
    comingSoon: false,
    iconName: "LibraryMusic",
  },
  {
    id: "video",
    name: "Video",
    blurb: "Video library & streaming.",
    accentColor: "#CC0000",
    phase: 4,
    comingSoon: false,
    iconName: "Movie",
  },
  {
    id: "live",
    name: "Live",
    blurb: "Go live; watch org streams.",
    accentColor: "#D7263D",
    phase: 4,
    comingSoon: false,
    iconName: "LiveTv",
  },
  {
    id: "git",
    name: "Git",
    blurb: "Source code & repositories.",
    accentColor: "#FB6E52",
    phase: 4,
    comingSoon: false,
    iconName: "AccountTree",
    externalUrl: GIT_URL,
  },
  {
    id: "cloudimport",
    name: "Cloud Import",
    blurb: "Import from Google Takeout or Apple export.",
    accentColor: "#0097A7",
    phase: 4,
    comingSoon: false,
    iconName: "CloudDownload",
  },
  {
    id: "telephony",
    name: "Telephony",
    blurb: "Internal calling, extensions & directory.",
    accentColor: "#00897B",
    phase: 4,
    comingSoon: false,
    iconName: "Dialpad",
    details: [
      "Per-org extensions auto-assigned to every member.",
      "Member directory with live online presence.",
      "1:1 WebRTC audio calls — browser softphone, no desk phone needed.",
      "Call history with completed/missed/rejected outcomes.",
      "Coming later: voicemail, IVR menus, and PSTN trunking.",
    ],
  },
  {
    id: "vpn",
    name: "VPN",
    blurb: "Tailscale tailnet access & devices.",
    accentColor: "#0B7285",
    phase: 4,
    comingSoon: false,
    iconName: "VpnLock",
  },
  {
    id: "games",
    name: "Games",
    blurb: "Play browser games — no account needed.",
    accentColor: "#7C4DFF",
    phase: 4,
    comingSoon: false,
    iconName: "SportsEsports",
  },
  {
    id: "orgsync",
    name: "Org Sync",
    blurb: "Transfer & sync data between organizations and platforms.",
    accentColor: "#0CA678",
    phase: 4,
    comingSoon: true,
    iconName: "SyncAlt",
    details: [
      "Transfer libraries from another grown organization or an external platform — Books, Music, Videos, Contacts, and more.",
      "Transfer specific Drive folders — pick exactly which folders (and their contents) to bring over, not just whole apps.",
      "Choose precisely what to copy and what to skip, per item type or per folder, with a preview before anything moves.",
      "Duplicate-aware: items that already exist in the destination are detected and skipped, so nothing is copied twice.",
      "Transfer-request approvals: a transfer must be requested and approved by the source organization's admin before any data moves.",
      "Sync invites: invite another organization or platform to connect, and manage ongoing two-way sync relationships.",
    ],
  },
];
