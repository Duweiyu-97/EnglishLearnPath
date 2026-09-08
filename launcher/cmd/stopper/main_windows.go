//go:build windows

package main

import (
	"os/exec"
	"syscall"
	"unsafe"
)

const launcherImageName = "启动学习中心.exe"

var messageBoxW = syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")

func main() {
	// Closing the browser tab does not stop the loopback server. Match only the
	// packaged launcher image, and do not use /T: the browser is not disposable.
	err := exec.Command("taskkill.exe", "/F", "/IM", launcherImageName).Run()
	if err != nil {
		showMessage(
			"未发现正在运行的学习中心服务，或 Windows 拒绝了结束请求。\n\n如果旧文件夹仍无法删除，请等待几秒后重试；必要时以管理员身份运行本工具。",
			"English Learning Path",
			0x30,
		)
		return
	}
	showMessage(
		"已结束所有正在运行的 English Learning Path 服务。\n\n现在可以删除或替换旧版本文件夹。你的学习记录保存在此前选择的数据目录中，不会被此操作删除。",
		"English Learning Path",
		0x40,
	)
}

func showMessage(text, title string, icon uintptr) {
	textPointer, _ := syscall.UTF16PtrFromString(text)
	titlePointer, _ := syscall.UTF16PtrFromString(title)
	messageBoxW.Call(
		0,
		uintptr(unsafe.Pointer(textPointer)),
		uintptr(unsafe.Pointer(titlePointer)),
		icon,
	)
}
