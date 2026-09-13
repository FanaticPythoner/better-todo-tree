import ctypes
import sys


def main() -> None:
    if len(sys.argv) < 2:
        raise ValueError("key sequence missing")

    x11 = ctypes.CDLL("libX11.so.6")
    xtst = ctypes.CDLL("libXtst.so.6")
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XStringToKeysym.argtypes = [ctypes.c_char_p]
    x11.XStringToKeysym.restype = ctypes.c_ulong
    x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    x11.XKeysymToKeycode.restype = ctypes.c_uint
    x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XSync.restype = ctypes.c_int
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    x11.XCloseDisplay.restype = ctypes.c_int
    xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
    xtst.XTestFakeKeyEvent.restype = ctypes.c_int

    display = x11.XOpenDisplay(None)
    if display is None:
        raise RuntimeError("X11 display unavailable")

    def keycode(name: str) -> int:
        keysym = x11.XStringToKeysym(name.encode("ascii"))
        code = x11.XKeysymToKeycode(display, keysym)
        if keysym == 0 or code == 0:
            raise ValueError(f"unsupported key {name}")
        return code

    def press(name: str) -> None:
        code = keycode(name)
        if xtst.XTestFakeKeyEvent(display, code, 1, 10) == 0:
            raise RuntimeError(f"key press rejected for {name}")
        if xtst.XTestFakeKeyEvent(display, code, 0, 10) == 0:
            raise RuntimeError(f"key release rejected for {name}")

    try:
        for token in sys.argv[1:]:
            if token.startswith("text="):
                for character in token[5:]:
                    press(character)
            elif token.startswith("key="):
                press(token[4:])
            else:
                raise ValueError(f"invalid key token {token}")
        x11.XSync(display, 0)
    finally:
        x11.XCloseDisplay(display)


if __name__ == "__main__":
    main()
