//go:build windows

package main

import (
	"fmt"
	"runtime"
	"syscall"
	"unsafe"
)

const (
	coinitApartmentThreaded = 0x2
	bifReturnOnlyFSDirs     = 0x0001
	bifEditBox              = 0x0010
	bifNewDialogStyle       = 0x0040
)

type browseInfoW struct {
	hwndOwner      uintptr
	pidlRoot       uintptr
	pszDisplayName *uint16
	lpszTitle      *uint16
	ulFlags        uint32
	lpfn           uintptr
	lParam         uintptr
	iImage         int32
}

var (
	ole32DLL                 = syscall.NewLazyDLL("ole32.dll")
	shell32DLL               = syscall.NewLazyDLL("shell32.dll")
	user32DLL                = syscall.NewLazyDLL("user32.dll")
	procCoInitializeEx       = ole32DLL.NewProc("CoInitializeEx")
	procCoUninitialize       = ole32DLL.NewProc("CoUninitialize")
	procCoTaskMemFree        = ole32DLL.NewProc("CoTaskMemFree")
	procSHBrowseForFolderW   = shell32DLL.NewProc("SHBrowseForFolderW")
	procSHGetPathFromIDListW = shell32DLL.NewProc("SHGetPathFromIDListW")
	procGetForegroundWindow  = user32DLL.NewProc("GetForegroundWindow")
)

// selectDirectory uses the native Windows shell dialog directly. The previous
// PowerShell/WinForms bridge could leave a console process waiting after the
// user canceled the dialog, which kept the HTTP request and both UI buttons
// disabled. A native modal dialog returns zero immediately on Cancel or close.
func selectDirectory() (string, bool, error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	result, _, _ := procCoInitializeEx.Call(0, coinitApartmentThreaded)
	if int32(result) < 0 {
		return "", false, fmt.Errorf("无法初始化 Windows 文件夹选择器（HRESULT 0x%08X）", uint32(result))
	}
	defer procCoUninitialize.Call()

	title, err := syscall.UTF16PtrFromString("选择 English Learning Path 永久数据文件夹（可新建文件夹）")
	if err != nil {
		return "", false, err
	}
	displayName := make([]uint16, syscall.MAX_PATH)
	owner, _, _ := procGetForegroundWindow.Call()
	info := browseInfoW{
		hwndOwner:      owner,
		pszDisplayName: &displayName[0],
		lpszTitle:      title,
		ulFlags:        bifReturnOnlyFSDirs | bifEditBox | bifNewDialogStyle,
	}

	itemIDList, _, _ := procSHBrowseForFolderW.Call(uintptr(unsafe.Pointer(&info)))
	if itemIDList == 0 {
		return "", true, nil
	}
	defer procCoTaskMemFree.Call(itemIDList)

	path := make([]uint16, syscall.MAX_PATH)
	ok, _, callErr := procSHGetPathFromIDListW.Call(itemIDList, uintptr(unsafe.Pointer(&path[0])))
	if ok == 0 {
		return "", false, fmt.Errorf("无法读取所选文件夹路径：%v", callErr)
	}
	selected := syscall.UTF16ToString(path)
	if selected == "" {
		return "", true, nil
	}
	return selected, false, nil
}
