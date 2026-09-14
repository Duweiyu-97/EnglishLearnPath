//go:build darwin

package main

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
)

const directoryPickerScript = `try
POSIX path of (choose folder with prompt "选择 English Learning Path 永久数据文件夹（可以新建文件夹）")
on error number -128
return ""
end try`

func selectDirectory() (string, bool, error) {
	command := exec.Command("/usr/bin/osascript", "-e", directoryPickerScript)
	output, err := command.Output()
	if err != nil {
		return "", false, fmt.Errorf("无法调用 macOS 文件夹选择器：%w", err)
	}
	selected := strings.TrimSpace(string(output))
	if selected == "" {
		return "", true, nil
	}
	return filepath.Clean(selected), false, nil
}
