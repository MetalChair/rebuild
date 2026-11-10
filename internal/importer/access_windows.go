package importer

import (
	"context"
	_ "embed"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unicode/utf16"
)

//go:embed export_access.ps1
var accessExporter string

func ExportAccess(ctx context.Context, input, csvDir string) error {
	windows := os.Getenv("SystemRoot")
	if windows == "" {
		return errors.New("could not locate Windows PowerShell")
	}
	// The Jet 4.0 provider is 32-bit. SysWOW64 is its host on 64-bit Windows.
	ps := filepath.Join(windows, "SysWOW64", "WindowsPowerShell", "v1.0", "powershell.exe")
	if _, err := os.Stat(ps); err != nil {
		ps = filepath.Join(windows, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	}
	units := utf16.Encode([]rune(accessExporter))
	command := make([]byte, 2*len(units))
	for i, unit := range units {
		command[2*i], command[2*i+1] = byte(unit), byte(unit>>8)
	}
	cmd := exec.CommandContext(ctx, ps, "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", base64.StdEncoding.EncodeToString(command))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	cmd.Env = append(os.Environ(), "DIETPRO_MDB_SOURCE="+input, "DIETPRO_CSV_DEST="+csvDir)
	output, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	// The helper emits a short error code. Database values never enter its logs.
	text := string(output)
	switch {
	case strings.Contains(text, "DIETPRO_PROVIDER"):
		return errors.New("The 32-bit Microsoft Access database provider is unavailable on this PC.")
	case strings.Contains(text, "DIETPRO_OPEN"):
		return errors.New("Windows could not open this Access file. Check that it is a readable, unencrypted Diet Pro .mdb.")
	case strings.Contains(text, "DIETPRO_TABLES"):
		return errors.New("This Access file does not contain the expected Diet Pro tables.")
	default:
		return fmt.Errorf("Windows could not export the Diet Pro tables: %w", err)
	}
}
