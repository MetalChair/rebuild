//go:build windows && portable

package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

func launchWindow(url string) error {
	for _, dir := range []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("LOCALAPPDATA")} {
		if dir == "" {
			continue
		}
		edge := filepath.Join(dir, "Microsoft", "Edge", "Application", "msedge.exe")
		if _, err := os.Stat(edge); err == nil {
			cmd := exec.Command(edge, "--app="+url, "--no-first-run")
			if err := cmd.Start(); err == nil {
				return cmd.Process.Release()
			}
		}
	}
	rundll := filepath.Join(os.Getenv("SystemRoot"), "System32", "rundll32.exe")
	cmd := exec.Command(rundll, "url.dll,FileProtocolHandler", url)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("open Diet Pro window: %w", err)
	}
	return cmd.Process.Release()
}

func showStartupError(message string) {
	title, _ := windows.UTF16PtrFromString("Diet Pro")
	body, _ := windows.UTF16PtrFromString(message)
	windows.NewLazySystemDLL("user32.dll").NewProc("MessageBoxW").Call(
		0, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(title)), 0x10)
}

func shutdownServer(srv *http.Server) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		srv.Close()
		return err
	}
	return nil
}
