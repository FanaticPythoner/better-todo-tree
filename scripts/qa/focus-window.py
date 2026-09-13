import ctypes
import sys


def main() -> None:
    if len(sys.argv) != 2:
        raise ValueError("window id argument missing")

    x11 = ctypes.CDLL("libX11.so.6")
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XSetInputFocus.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
    x11.XSetInputFocus.restype = ctypes.c_int
    x11.XDefaultScreen.argtypes = [ctypes.c_void_p]
    x11.XDefaultScreen.restype = ctypes.c_int
    x11.XDisplayWidth.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XDisplayWidth.restype = ctypes.c_int
    x11.XDisplayHeight.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XDisplayHeight.restype = ctypes.c_int
    x11.XMoveResizeWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int,
                                    ctypes.c_int, ctypes.c_uint, ctypes.c_uint]
    x11.XMoveResizeWindow.restype = ctypes.c_int
    x11.XFlush.argtypes = [ctypes.c_void_p]
    x11.XFlush.restype = ctypes.c_int
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    x11.XCloseDisplay.restype = ctypes.c_int

    display = x11.XOpenDisplay(None)
    if display is None:
        raise RuntimeError("X11 display unavailable")

    try:
        window = int(sys.argv[1], 0)
        screen = x11.XDefaultScreen(display)
        width, height = x11.XDisplayWidth(display, screen), x11.XDisplayHeight(display, screen)
        if width <= 0 or height <= 0:
            raise RuntimeError("X11 display dimensions must be positive")
        if x11.XMoveResizeWindow(display, window, 0, 0, width, height) == 0:
            raise RuntimeError("X11 window placement rejected")
        result = x11.XSetInputFocus(display, window, 1, 0)
        if result == 0:
            raise RuntimeError("X11 input focus rejected")
        x11.XFlush(display)
    finally:
        x11.XCloseDisplay(display)


if __name__ == "__main__":
    main()
