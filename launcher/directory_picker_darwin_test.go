//go:build darwin

package main

import (
	"strings"
	"testing"
)

func TestMacOSDirectoryPickerUsesNativeChooseFolder(t *testing.T) {
	for _, required := range []string{"choose folder", "POSIX path", "error number -128"} {
		if !strings.Contains(directoryPickerScript, required) {
			t.Fatalf("directory picker script is missing %q", required)
		}
	}
}
