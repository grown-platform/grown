// Package desktops defines the on-demand container-desktop flavor catalog as
// pure data and helpers. The images and ports listed here are
// deployment-tunable defaults — the exact VNC port in particular depends on
// the chosen image and must be confirmed at deploy time. Nothing in this
// package reaches the network.
package desktops

// Protocol is how Guacamole connects to a desktop.
type Protocol string

const (
	ProtoVNC Protocol = "vnc"
	ProtoSSH Protocol = "ssh"
)

// Flavor is one launchable desktop template.
type Flavor struct {
	ID             string   // catalog id, e.g. "linux-desktop"
	Name           string   // display name
	Description    string   // one line
	Image          string   // container image
	Protocol       Protocol // vnc | ssh
	Port           int      // the in-container VNC/SSH port
	CPURequest     string   // k8s quantity, e.g. "250m"
	CPULimit       string   // e.g. "2"
	MemRequest     string   // e.g. "512Mi"
	MemLimit       string   // e.g. "2Gi"
	PersistentPath string   // home dir to PVC-mount in persistent mode; "" = none
	NeedsEgress    bool     // whether the flavor needs internet egress
}

// catalog is the ordered list of all flavors.
var catalog = []Flavor{
	{
		ID:          "linux-desktop",
		Name:        "Linux desktop",
		Description: "Full XFCE desktop environment over VNC",
		Image:       "lscr.io/linuxserver/webtop:debian-xfce",
		Protocol:    ProtoVNC,
		// linuxserver/webtop serves its KasmVNC web UI on port 3000, but also
		// exposes raw VNC on 5900. Guacamole connects via raw VNC, so we use 5900.
		Port:           5900,
		CPURequest:     "500m",
		CPULimit:       "2",
		MemRequest:     "1Gi",
		MemLimit:       "2Gi",
		PersistentPath: "/config", // linuxserver images persist user data under /config
		NeedsEgress:    true,
	},
	{
		ID:          "browser",
		Name:        "Browser",
		Description: "Hardened single-app browser over VNC",
		Image:       "kasmweb/chrome:1.15.0",
		Protocol:    ProtoVNC,
		// kasmweb/chrome exposes its KasmVNC HTTPS UI on 6901. For raw VNC
		// via Guacamole the port differs; 5901 is used here but must be
		// confirmed against the chosen image at deploy time.
		Port:           5901,
		CPURequest:     "500m",
		CPULimit:       "2",
		MemRequest:     "1Gi",
		MemLimit:       "2Gi",
		PersistentPath: "", // ephemeral browser — no persistent home by default
		NeedsEgress:    true,
	},
	{
		ID:             "terminal",
		Name:           "Terminal",
		Description:    "Full dev/ops shell over SSH",
		Image:          "lscr.io/linuxserver/openssh-server:latest",
		Protocol:       ProtoSSH,
		Port:           2222,
		CPURequest:     "100m",
		CPULimit:       "1",
		MemRequest:     "256Mi",
		MemLimit:       "1Gi",
		PersistentPath: "/config",
		NeedsEgress:    true,
	},
}

// Flavors returns the catalog in display order.
func Flavors() []Flavor {
	result := make([]Flavor, len(catalog))
	copy(result, catalog)
	return result
}

// FlavorByID returns the flavor and true, or zero+false.
func FlavorByID(id string) (Flavor, bool) {
	for _, f := range catalog {
		if f.ID == id {
			return f, true
		}
	}
	return Flavor{}, false
}
