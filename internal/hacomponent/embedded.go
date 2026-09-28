package hacomponent

import homeassistant "code.pick.haus/grown/grown/integrations/homeassistant"

// Embedded serves the integration compiled into this binary, zipped as
// custom_components/grown/...
func Embedded() *Handler {
	return New(homeassistant.Component, homeassistant.ComponentRoot, "custom_components/grown")
}
