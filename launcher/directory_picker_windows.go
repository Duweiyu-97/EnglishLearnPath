//go:build windows

package main

import (
	"fmt"
	"path/filepath"
	"runtime"
	"syscall"
	"unicode/utf16"
	"unsafe"
)

const (
	coinitApartmentThreaded = 0x2
	bifReturnOnlyFSDirs     = 0x0001
	bifEditBox              = 0x0010
	bifNewDialogStyle       = 0x0040
	ofnHideReadOnly         = 0x00000004
	ofnNoChangeDir          = 0x00000008
	ofnAllowMultiSelect     = 0x00000200
	ofnPathMustExist        = 0x00000800
	ofnFileMustExist        = 0x00001000
	ofnExplorer             = 0x00080000
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

type openFileNameW struct {
	lStructSize       uint32
	hwndOwner         uintptr
	hInstance         uintptr
	lpstrFilter       *uint16
	lpstrCustomFilter *uint16
	nMaxCustFilter    uint32
	nFilterIndex      uint32
	lpstrFile         *uint16
	nMaxFile          uint32
	lpstrFileTitle    *uint16
	nMaxFileTitle     uint32
	lpstrInitialDir   *uint16
	lpstrTitle        *uint16
	flags             uint32
	nFileOffset       uint16
	nFileExtension    uint16
	lpstrDefExt       *uint16
	lCustData         uintptr
	lpfnHook          uintptr
	lpTemplateName    *uint16
	pvReserved        uintptr
	dwReserved        uint32
	flagsEx           uint32
}

var (
	ole32DLL                 = syscall.NewLazyDLL("ole32.dll")
	shell32DLL               = syscall.NewLazyDLL("shell32.dll")
	user32DLL                = syscall.NewLazyDLL("user32.dll")
	comdlg32DLL              = syscall.NewLazyDLL("comdlg32.dll")
	procCoInitializeEx       = ole32DLL.NewProc("CoInitializeEx")
	procCoUninitialize       = ole32DLL.NewProc("CoUninitialize")
	procCoTaskMemFree        = ole32DLL.NewProc("CoTaskMemFree")
	procSHBrowseForFolderW   = shell32DLL.NewProc("SHBrowseForFolderW")
	procSHGetPathFromIDListW = shell32DLL.NewProc("SHGetPathFromIDListW")
	procGetForegroundWindow  = user32DLL.NewProc("GetForegroundWindow")
	procGetOpenFileNameW     = comdlg32DLL.NewProc("GetOpenFileNameW")
	procCommDlgExtendedError = comdlg32DLL.NewProc("CommDlgExtendedError")
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

// selectArchiveFiles uses the native Windows common file dialog so importing
// listening/reading ZIP updates has the same cancel-safe, console-free behavior
// as selecting the permanent data directory.
func selectArchiveFiles(kind string) ([]string, bool, error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	label := "虾滑听力"
	if kind == "reading" {
		label = "ZYZ 阅读"
	}
	title, err := syscall.UTF16PtrFromString("选择" + label + " ZIP，可多选")
	if err != nil {
		return nil, false, err
	}
	defaultExtension, err := syscall.UTF16PtrFromString("zip")
	if err != nil {
		return nil, false, err
	}
	filter := utf16.Encode([]rune("ZIP 压缩包 (*.zip)\x00*.zip\x00所有文件 (*.*)\x00*.*\x00\x00"))
	filesBuffer := make([]uint16, 65536)
	owner, _, _ := procGetForegroundWindow.Call()
	dialog := openFileNameW{
		lStructSize:  uint32(unsafe.Sizeof(openFileNameW{})),
		hwndOwner:    owner,
		lpstrFilter:  &filter[0],
		nFilterIndex: 1,
		lpstrFile:    &filesBuffer[0],
		nMaxFile:     uint32(len(filesBuffer)),
		lpstrTitle:   title,
		flags:        ofnExplorer | ofnAllowMultiSelect | ofnFileMustExist | ofnPathMustExist | ofnNoChangeDir | ofnHideReadOnly,
		lpstrDefExt:  defaultExtension,
	}

	ok, _, _ := procGetOpenFileNameW.Call(uintptr(unsafe.Pointer(&dialog)))
	if ok == 0 {
		code, _, _ := procCommDlgExtendedError.Call()
		if code == 0 {
			return nil, true, nil
		}
		return nil, false, fmt.Errorf("Windows 文件选择器失败（错误码 0x%X）", code)
	}
	paths := parseMultiSelectBuffer(filesBuffer)
	if len(paths) == 0 {
		return nil, true, nil
	}
	return paths, false, nil
}

func parseMultiSelectBuffer(buffer []uint16) []string {
	parts := make([]string, 0, 4)
	for start := 0; start < len(buffer) && buffer[start] != 0; {
		end := start
		for end < len(buffer) && buffer[end] != 0 {
			end++
		}
		parts = append(parts, syscall.UTF16ToString(buffer[start:end]))
		start = end + 1
	}
	if len(parts) <= 1 {
		return parts
	}
	root := parts[0]
	paths := make([]string, 0, len(parts)-1)
	for _, name := range parts[1:] {
		paths = append(paths, filepath.Join(root, name))
	}
	return paths
}
