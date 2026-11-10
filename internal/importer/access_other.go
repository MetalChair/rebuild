//go:build !windows

package importer

import (
	"context"
	"errors"
)

func ExportAccess(ctx context.Context, input, csvDir string) error {
	return errors.New("Direct Access import requires Windows. Use the CSV importer on this platform.")
}
