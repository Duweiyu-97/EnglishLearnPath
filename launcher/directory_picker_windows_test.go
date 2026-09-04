//go:build windows

package main

import (
	"os"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

var (
	testUser32DLL                    = syscall.NewLazyDLL("user32.dll")
	testProcEnumWindows              = testUser32DLL.NewProc("EnumWindows")
	testProcGetWindowThreadProcessID = testUser32DLL.NewProc("GetWindowThreadProcessId")
	testProcGetClassNameW            = testUser32DLL.NewProc("GetClassNameW")
	testProcPostMessageW             = testUser32DLL.NewProc("PostMessageW")
)

const wmClose = 0x0010

func TestNativePickersCanBeCanceledAndReopened(t *testing.T) {
	if os.Getenv("ENGLISH_LEARN_PATH_UI_TEST") != "1" {
		t.Skip("set ENGLISH_LEARN_PATH_UI_TEST=1 to run the interactive Windows picker smoke test")
	}

	for attempt := 0; attempt < 2; attempt++ {
		closed := closeNextNativeDialog()
		selected, canceled, err := selectDirectory()
		if err != nil {
			t.Fatalf("directory picker attempt %d: %v", attempt+1, err)
		}
		if selected != "" || !canceled || !<-closed {
			t.Fatalf("directory picker attempt %d did not cancel cleanly", attempt+1)
		}
	}

}

func closeNextNativeDialog() <-chan bool {
	result := make(chan bool, 1)
	go func() {
		deadline := time.Now().Add(8 * time.Second)
		for time.Now().Before(deadline) {
			closed := false
			callback := syscall.NewCallback(func(window, _ uintptr) uintptr {
				var processID uint32
				testProcGetWindowThreadProcessID.Call(window, uintptr(unsafe.Pointer(&processID)))
				if processID != uint32(os.Getpid()) {
					return 1
				}
				className := make([]uint16, 64)
				length, _, _ := testProcGetClassNameW.Call(window, uintptr(unsafe.Pointer(&className[0])), uintptr(len(className)))
				if syscall.UTF16ToString(className[:length]) != "#32770" {
					return 1
				}
				testProcPostMessageW.Call(window, wmClose, 0, 0)
				closed = true
				return 0
			})
			testProcEnumWindows.Call(callback, 0)
			if closed {
				result <- true
				return
			}
			time.Sleep(80 * time.Millisecond)
		}
		result <- false
	}()
	return result
}
