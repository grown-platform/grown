package sharing

import (
	"errors"

	"github.com/jackc/pgx/v5"
)

// isNoRows reports whether err is pgx's "no rows" sentinel.
func isNoRows(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}
