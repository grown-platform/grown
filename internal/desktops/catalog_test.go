package desktops

import "testing"

func TestFlavorsCount(t *testing.T) {
	flavors := Flavors()
	if len(flavors) != 3 {
		t.Fatalf("Flavors() returned %d flavors, want 3", len(flavors))
	}
}

func TestFlavorsOrder(t *testing.T) {
	want := []string{"linux-desktop", "browser", "terminal"}
	flavors := Flavors()
	for i, id := range want {
		if flavors[i].ID != id {
			t.Errorf("Flavors()[%d].ID = %q, want %q", i, flavors[i].ID, id)
		}
	}
}

func TestFlavorByIDBrowser(t *testing.T) {
	f, ok := FlavorByID("browser")
	if !ok {
		t.Fatal("FlavorByID(\"browser\") not found")
	}
	if f.Protocol != ProtoVNC {
		t.Errorf("browser Protocol = %q, want %q", f.Protocol, ProtoVNC)
	}
}

func TestFlavorByIDTerminal(t *testing.T) {
	f, ok := FlavorByID("terminal")
	if !ok {
		t.Fatal("FlavorByID(\"terminal\") not found")
	}
	if f.Protocol != ProtoSSH {
		t.Errorf("terminal Protocol = %q, want %q", f.Protocol, ProtoSSH)
	}
	if f.Port != 2222 {
		t.Errorf("terminal Port = %d, want 2222", f.Port)
	}
}

func TestFlavorByIDMissing(t *testing.T) {
	_, ok := FlavorByID("nope")
	if ok {
		t.Error("FlavorByID(\"nope\") returned true, want false")
	}
}

func TestFlavorByIDZeroValue(t *testing.T) {
	f, _ := FlavorByID("nope")
	if f.ID != "" || f.Name != "" || f.Image != "" {
		t.Error("FlavorByID(\"nope\") returned non-zero Flavor")
	}
}

func TestFlavorFieldsNonEmpty(t *testing.T) {
	validProtocols := map[Protocol]bool{
		ProtoVNC: true,
		ProtoSSH: true,
	}
	for _, f := range Flavors() {
		if f.ID == "" {
			t.Errorf("flavor has empty ID")
		}
		if f.Name == "" {
			t.Errorf("flavor %q has empty Name", f.ID)
		}
		if f.Image == "" {
			t.Errorf("flavor %q has empty Image", f.ID)
		}
		if !validProtocols[f.Protocol] {
			t.Errorf("flavor %q has invalid Protocol %q", f.ID, f.Protocol)
		}
	}
}
