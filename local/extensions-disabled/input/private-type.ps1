param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Capture", "Type")]
    [string] $Mode,

    [string] $ExpectedForeground,
    [string] $ExpectedFocused
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;

public static class PiPrivateTyping
{
    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct GUITHREADINFO
    {
        public int cbSize;
        public uint flags;
        public IntPtr hwndActive;
        public IntPtr hwndFocus;
        public IntPtr hwndCapture;
        public IntPtr hwndMenuOwner;
        public IntPtr hwndMoveSize;
        public IntPtr hwndCaret;
        public RECT rcCaret;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public INPUTUNION data;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct INPUTUNION
    {
        [FieldOffset(0)] public MOUSEINPUT mouse;
        [FieldOffset(0)] public KEYBDINPUT keyboard;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    public struct FocusSnapshot
    {
        public IntPtr Foreground;
        public IntPtr Focused;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetGUIThreadInfo(uint threadId, ref GUITHREADINFO info);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, INPUT[] inputs, int size);

    public static FocusSnapshot CaptureFocus()
    {
        GUITHREADINFO info = new GUITHREADINFO();
        info.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
        if (!GetGUIThreadInfo(0, ref info))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "GetGUIThreadInfo failed");

        FocusSnapshot snapshot = new FocusSnapshot();
        snapshot.Foreground = GetForegroundWindow();
        snapshot.Focused = info.hwndFocus;
        if (snapshot.Foreground == IntPtr.Zero || snapshot.Focused == IntPtr.Zero)
            throw new InvalidOperationException("No focused control was detected");
        return snapshot;
    }

    private static void EnsureFocus(IntPtr expectedForeground, IntPtr expectedFocused)
    {
        FocusSnapshot current = CaptureFocus();
        if (current.Foreground != expectedForeground || current.Focused != expectedFocused)
            throw new InvalidOperationException("FOCUS_CHANGED");
    }

    private static void SendUnicode(char character, bool keyUp)
    {
        INPUT input = new INPUT();
        input.type = INPUT_KEYBOARD;
        input.data.keyboard.wScan = character;
        input.data.keyboard.dwFlags = KEYEVENTF_UNICODE | (keyUp ? KEYEVENTF_KEYUP : 0);
        INPUT[] inputs = new INPUT[] { input };

        if (SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT))) != 1)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "SendInput failed");
    }

    public static void TypeText(string text, IntPtr expectedForeground, IntPtr expectedFocused)
    {
        EnsureFocus(expectedForeground, expectedFocused);
        for (int index = 0; index < text.Length; index++)
        {
            EnsureFocus(expectedForeground, expectedFocused);
            SendUnicode(text[index], false);
            SendUnicode(text[index], true);
            if (index < text.Length - 1) Thread.Sleep(1);
        }
    }
}
"@

try {
    if ($Mode -eq "Capture") {
        $snapshot = [PiPrivateTyping]::CaptureFocus()
        [ordered]@{
            foreground = $snapshot.Foreground.ToInt64().ToString([Globalization.CultureInfo]::InvariantCulture)
            focused = $snapshot.Focused.ToInt64().ToString([Globalization.CultureInfo]::InvariantCulture)
        } | ConvertTo-Json -Compress
        exit 0
    }

    if ([string]::IsNullOrWhiteSpace($ExpectedForeground) -or [string]::IsNullOrWhiteSpace($ExpectedFocused)) {
        throw "Expected focus handles are required"
    }

    $foreground = [long]::Parse($ExpectedForeground, [Globalization.CultureInfo]::InvariantCulture)
    $focused = [long]::Parse($ExpectedFocused, [Globalization.CultureInfo]::InvariantCulture)
    $encoded = [Console]::In.ReadToEnd().Trim()
    $privateText = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($encoded))
    [PiPrivateTyping]::TypeText($privateText, [IntPtr]::new($foreground), [IntPtr]::new($focused))
    [Console]::Out.Write("OK")
    exit 0
}
catch {
    if ($_.Exception.ToString().Contains("FOCUS_CHANGED")) {
        [Console]::Error.Write("FOCUS_CHANGED")
    }
    else {
        [Console]::Error.Write("PRIVATE_TYPING_FAILED")
    }
    exit 1
}
