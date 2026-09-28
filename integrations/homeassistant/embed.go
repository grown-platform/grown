// Package homeassistant embeds the grown Home Assistant custom integration
// (custom_components/grown) so the Grown server can hand it out; see
// internal/hacomponent. It lives next to the Python sources because go:embed
// cannot reach outside a package's directory.
package homeassistant

import "embed"

// Component holds custom_components/grown. The all: prefix keeps
// underscore-prefixed files (__init__.py); build caches such as __pycache__
// are filtered out when the zip is built.
//
//go:embed all:custom_components/grown
var Component embed.FS

// ComponentRoot is the directory inside Component that holds the integration.
const ComponentRoot = "custom_components/grown"
