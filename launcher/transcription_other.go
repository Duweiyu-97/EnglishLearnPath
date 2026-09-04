//go:build !windows

package main

import "os/exec"

func hideTranscriptionWindow(command *exec.Cmd) {}
