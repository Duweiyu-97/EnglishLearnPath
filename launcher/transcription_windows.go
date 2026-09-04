//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

func hideTranscriptionWindow(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}
