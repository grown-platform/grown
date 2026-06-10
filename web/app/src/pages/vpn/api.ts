export interface VpnDevice {
  id: string;
  name: string;
  hostname: string;
  addresses: string[];
  os: string;
  online: boolean;
  last_seen?: string;
}

export interface VpnStatus {
  configured: boolean;
  tailnet?: string;
  devices_configured: boolean;
  devices?: VpnDevice[];
  error?: string;
}

export async function getVpnStatus(): Promise<VpnStatus> {
  const resp = await fetch("/api/v1/vpn/status", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as VpnStatus;
}
