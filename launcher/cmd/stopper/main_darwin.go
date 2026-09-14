//go:build darwin

package main

import (
	"errors"
	"os/exec"
)

const launcherProcessName = "EnglishLearnPath"

func main() {
	err := exec.Command("/usr/bin/pkill", "-x", launcherProcessName).Run()
	var exitError *exec.ExitError
	if err == nil || (errors.As(err, &exitError) && exitError.ExitCode() == 1) {
		return
	}
}
