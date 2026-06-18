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
  /** Optional image URL shown in the avatar instead of the icon (e.g. a game's
   *  own artwork). Falls back to iconName when absent. */
  iconUrl?: string;
  /** If set, the tile links out to this URL in a new tab (e.g. an external
   *  git service) instead of an internal route. */
  externalUrl?: string;
  /** Optional richer "what it will do" bullets shown on the coming-soon page. */
  details?: string[];
  /** Optional small sub-label under the name (rendered like "(coming soon)"),
   *  e.g. to indicate the underlying service powering the app. */
  subLabel?: string;
  /** When true, the tile shows a small "NEW" badge on its icon (used by /games
   *  to flag recently-updated games). */
  isNew?: boolean;
  /** When true, the tile shows a small "BETA" badge on its icon, flagging the
   *  game as an early/in-progress preview that may have bugs. */
  isBeta?: boolean;
  /** Optional callback fired when the tile is launched/clicked (used by /games
   *  to track per-device play counts). Does not prevent the navigation. */
  onLaunch?: () => void;
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
  "https://assemble.example.com";
const ASSEMBLE_URL =
  ASSEMBLE_BASE + (ASSEMBLE_BASE.includes("?") ? "&" : "?") + "sso=grown";

/** SPACELIGHT_URL points the Spacelight tile at the self-hosted Spacelight app.
 *  Override with VITE_SPACELIGHT_URL. */
const SPACELIGHT_URL =
  (import.meta.env.VITE_SPACELIGHT_URL as string | undefined) ||
  "https://spacelight.example.com";

/** PDF_URL points the PDF tile at the integrated PDF editor & signing app
 *  (pdf), proxied under grown's origin. Override with VITE_PDF_URL. */
const PDF_URL = (import.meta.env.VITE_PDF_URL as string | undefined) || "/pdf/";

/** LEARN_URL points the Learn tile at the Learn platform (every-tongue PWA),
 *  served under grown's own origin at /learn (the server reverse-proxies
 *  /learn/* to the Learn container). Override with VITE_LEARN_URL. */
const LEARN_URL =
  (import.meta.env.VITE_LEARN_URL as string | undefined) || "/learn/";

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
    // Renamed from "Spacelight" → "Lightsky" (same app, same logo/URL). The id
    // stays "spacelight" so existing service-settings/routes keyed on it keep
    // working and the self-hosted Spacelight app is unchanged.
    id: "spacelight",
    name: "Lightsky",
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
    blurb: "Twenty CRM (OSS).",
    subLabel: "twenty crm oss",
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
    id: "tickets",
    name: "Tickets",
    blurb: "Track requests; public intake links.",
    accentColor: "#2563EB",
    phase: 4,
    comingSoon: false,
    iconName: "ConfirmationNumber",
  },
  {
    id: "translate",
    name: "Translate",
    blurb: "Translate text on-device; speak it aloud with Supertonic TTS.",
    accentColor: "#0E7C86",
    phase: 4,
    comingSoon: false,
    iconName: "Translate",
    details: [
      "Fully in-browser translation — no backend, your text never leaves the device.",
      "Prefers the browser's built-in on-device Translator API, falling back to a local NLLB-200 model (transformers.js).",
      "Speak the translation aloud with Supertonic, an on-device multilingual TTS (onnxruntime-web, WebGPU with WASM fallback).",
      "Falls back to the browser's speech voice if Supertonic can't load.",
    ],
  },
  {
    id: "3d",
    name: "3D",
    blurb: "View 3D models; a SketchUp-style modeler in the making.",
    accentColor: "#6750A4",
    phase: 4,
    comingSoon: false,
    iconName: "ViewInAr",
  },
  {
    id: "podcasts",
    name: "Podcasts",
    blurb: "Discover & listen to podcasts (early preview).",
    accentColor: "#8E44AD",
    phase: 4,
    comingSoon: false,
    iconName: "Podcasts",
    details: [
      "Search and discover podcasts (powered by the open iTunes podcast directory).",
      "Coming next: subscribe to shows, browse episodes, and play them in the built-in player with offline downloads.",
      "Planned: OPML import to bring your subscriptions from another app.",
    ],
  },
  {
    id: "archaeology",
    name: "Archaeology",
    blurb: "Browse the Earth and read up on archaeological sites & finds.",
    accentColor: "#8d6e63",
    phase: 4,
    comingSoon: false,
    iconName: "Museum",
    details: [
      "Pan and zoom anywhere — archaeological sites load for your view (live from Wikidata).",
      "Tap a site to read about it and what's been found, with photos and structured facts.",
      "Open the full Wikipedia article or the Wikidata record for sources. Fully client-side.",
    ],
  },
  {
    id: "maps",
    name: "Maps",
    blurb: "Browse the map, search places — with optional offline areas.",
    accentColor: "#1565C0",
    phase: 4,
    comingSoon: false,
    iconName: "Map",
    details: [
      "A slippy map (OpenStreetMap streets + satellite imagery) with place/address search and one-tap geolocation.",
      "Optional offline data: tiles you view are cached on-device, and \"Save area offline\" stores the current view so it works with no connection.",
      "Fully client-side — your location and searches never hit a grown backend.",
    ],
  },
  {
    id: "learn",
    name: "Learn",
    blurb: "Courses, lessons & a universal topic search — offline-first.",
    accentColor: "#1565C0",
    phase: 4,
    comingSoon: false,
    iconName: "School",
    externalUrl: LEARN_URL,
    details: [
      "A growing, Khan-Academy-style learning platform — catalog of courses, units and lessons.",
      "Course 1: Every Tongue — a self-study kit for Bible translation, with a live global-progress map.",
      "Universal search to learn (and teach) any topic; offline-first PWA.",
      "Served under your workspace at /learn — same sign-in, no separate site.",
    ],
  },
  {
    id: "orgsync",
    name: "Share with Friends",
    blurb: "Move Drive files & Contacts between orgs — and share with friends' instances.",
    accentColor: "#0CA678",
    phase: 4,
    comingSoon: false,
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
