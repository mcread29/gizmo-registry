param(
    [Parameter(Mandatory = $true)]
    [string] $PayloadPath
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;

public static class PiWindowsInput
{
    private const uint INPUT_MOUSE = 0;
    private const uint INPUT_KEYBOARD = 1;

    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;
    private const uint MOUSEEVENTF_HWHEEL = 0x1000;

    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X;
        public int Y;
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

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, INPUT[] inputs, int size);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    private static readonly Dictionary<string, ushort> NamedKeys =
        new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase)
        {
            { "BACKSPACE", 0x08 }, { "BACK", 0x08 },
            { "TAB", 0x09 },
            { "ENTER", 0x0D }, { "RETURN", 0x0D },
            { "SHIFT", 0x10 }, { "CTRL", 0x11 }, { "CONTROL", 0x11 },
            { "ALT", 0x12 }, { "MENU", 0x12 },
            { "PAUSE", 0x13 }, { "CAPSLOCK", 0x14 },
            { "ESC", 0x1B }, { "ESCAPE", 0x1B },
            { "SPACE", 0x20 },
            { "PAGEUP", 0x21 }, { "PGUP", 0x21 },
            { "PAGEDOWN", 0x22 }, { "PGDN", 0x22 },
            { "END", 0x23 }, { "HOME", 0x24 },
            { "LEFT", 0x25 }, { "UP", 0x26 }, { "RIGHT", 0x27 }, { "DOWN", 0x28 },
            { "PRINTSCREEN", 0x2C }, { "PRTSC", 0x2C },
            { "INSERT", 0x2D }, { "INS", 0x2D },
            { "DELETE", 0x2E }, { "DEL", 0x2E },
            { "LWIN", 0x5B }, { "WIN", 0x5B }, { "WINDOWS", 0x5B }, { "META", 0x5B },
            { "RWIN", 0x5C }, { "APPS", 0x5D },
            { "NUMLOCK", 0x90 }, { "SCROLLLOCK", 0x91 },
            { "LSHIFT", 0xA0 }, { "RSHIFT", 0xA1 },
            { "LCTRL", 0xA2 }, { "RCTRL", 0xA3 },
            { "LALT", 0xA4 }, { "RALT", 0xA5 },
            { "SEMICOLON", 0xBA }, { "EQUALS", 0xBB }, { "COMMA", 0xBC },
            { "MINUS", 0xBD }, { "PERIOD", 0xBE }, { "SLASH", 0xBF },
            { "BACKTICK", 0xC0 }, { "LBRACKET", 0xDB }, { "BACKSLASH", 0xDC },
            { "RBRACKET", 0xDD }, { "QUOTE", 0xDE }
        };

    public static void EnablePhysicalCoordinates()
    {
        try
        {
            if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware();
        }
        catch { try { SetProcessDPIAware(); } catch { } }
    }

    public static POINT CursorPosition()
    {
        POINT point;
        if (!GetCursorPos(out point))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "GetCursorPos failed");
        return point;
    }

    public static void MoveTo(int x, int y)
    {
        if (!SetCursorPos(x, y))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "SetCursorPos failed");
    }

    public static void SmoothMoveTo(int x, int y, int durationMs, int steps)
    {
        POINT start = CursorPosition();
        if (durationMs <= 0 || steps <= 1)
        {
            MoveTo(x, y);
            return;
        }

        int sleepMs = Math.Max(1, durationMs / steps);
        for (int index = 1; index <= steps; index++)
        {
            double progress = (double)index / steps;
            int nextX = (int)Math.Round(start.X + ((x - start.X) * progress));
            int nextY = (int)Math.Round(start.Y + ((y - start.Y) * progress));
            MoveTo(nextX, nextY);
            Thread.Sleep(sleepMs);
        }
    }

    private static void Send(INPUT input)
    {
        INPUT[] inputs = new INPUT[] { input };
        if (SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT))) != 1)
        {
            int error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error,
                "SendInput failed. Windows may be blocking input to an elevated or secure window");
        }
    }

    private static void SendMouse(uint flags, int data)
    {
        INPUT input = new INPUT();
        input.type = INPUT_MOUSE;
        input.data.mouse.mouseData = unchecked((uint)data);
        input.data.mouse.dwFlags = flags;
        Send(input);
    }

    private static uint MouseFlag(string button, bool down)
    {
        switch ((button ?? "left").ToLowerInvariant())
        {
            case "left": return down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
            case "right": return down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
            case "middle": return down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;
            default: throw new ArgumentException("Unknown mouse button: " + button);
        }
    }

    public static void MouseDown(string button) { SendMouse(MouseFlag(button, true), 0); }
    public static void MouseUp(string button) { SendMouse(MouseFlag(button, false), 0); }

    public static void Click(string button)
    {
        MouseDown(button);
        MouseUp(button);
    }

    public static void Scroll(int delta, bool horizontal)
    {
        SendMouse(horizontal ? MOUSEEVENTF_HWHEEL : MOUSEEVENTF_WHEEL, delta);
    }

    private static void SendKey(ushort virtualKey, bool up)
    {
        INPUT input = new INPUT();
        input.type = INPUT_KEYBOARD;
        input.data.keyboard.wVk = virtualKey;
        input.data.keyboard.dwFlags = up ? KEYEVENTF_KEYUP : 0;
        Send(input);
    }

    public static ushort ResolveKey(string value)
    {
        if (String.IsNullOrWhiteSpace(value))
            throw new ArgumentException("Key name cannot be empty");

        string key = value.Trim();
        ushort virtualKey;
        if (NamedKeys.TryGetValue(key, out virtualKey)) return virtualKey;

        if (key.Length == 1)
        {
            char character = Char.ToUpperInvariant(key[0]);
            if ((character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9'))
                return character;
        }

        if (key.Length >= 2 && key[0] == 'F')
        {
            int functionNumber;
            if (Int32.TryParse(key.Substring(1), out functionNumber) && functionNumber >= 1 && functionNumber <= 24)
                return (ushort)(0x6F + functionNumber);
        }

        if (key.StartsWith("VK_", StringComparison.OrdinalIgnoreCase))
        {
            int rawValue;
            if (Int32.TryParse(key.Substring(3), System.Globalization.NumberStyles.HexNumber,
                System.Globalization.CultureInfo.InvariantCulture, out rawValue) && rawValue >= 0 && rawValue <= 0xFF)
                return (ushort)rawValue;
        }

        throw new ArgumentException("Unknown key name: " + value);
    }

    public static void KeyChord(string[] keys)
    {
        List<ushort> pressed = new List<ushort>();
        try
        {
            foreach (string key in keys)
            {
                ushort virtualKey = ResolveKey(key);
                SendKey(virtualKey, false);
                pressed.Add(virtualKey);
            }
        }
        finally
        {
            for (int index = pressed.Count - 1; index >= 0; index--)
            {
                try { SendKey(pressed[index], true); } catch { }
            }
        }
    }

    public static void TypeText(string text, int intervalMs)
    {
        if (text == null) return;
        for (int index = 0; index < text.Length; index++)
        {
            INPUT down = new INPUT();
            down.type = INPUT_KEYBOARD;
            down.data.keyboard.wScan = text[index];
            down.data.keyboard.dwFlags = KEYEVENTF_UNICODE;
            Send(down);

            INPUT up = down;
            up.data.keyboard.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
            Send(up);

            if (intervalMs > 0 && index < text.Length - 1) Thread.Sleep(intervalMs);
        }
    }
}
"@

function Get-IntValue {
    param(
        [object] $Value,
        [int] $Default = 0
    )

    if ($null -eq $Value) { return $Default }
    return [Convert]::ToInt32($Value, [Globalization.CultureInfo]::InvariantCulture)
}

function Assert-ScreenPoint {
    param(
        [int] $X,
        [int] $Y,
        [string] $Label
    )

    $left = [PiWindowsInput]::GetSystemMetrics(76)
    $top = [PiWindowsInput]::GetSystemMetrics(77)
    $width = [PiWindowsInput]::GetSystemMetrics(78)
    $height = [PiWindowsInput]::GetSystemMetrics(79)
    $right = $left + $width - 1
    $bottom = $top + $height - 1

    if ($X -lt $left -or $X -gt $right -or $Y -lt $top -or $Y -gt $bottom) {
        throw "$Label ($X,$Y) is outside the virtual desktop bounds ($left,$top)-($right,$bottom)"
    }
}

function Get-Steps {
    param(
        [object] $RequestedSteps,
        [int] $DurationMs
    )

    if ($null -ne $RequestedSteps) { return Get-IntValue $RequestedSteps }
    if ($DurationMs -le 0) { return 1 }
    return [Math]::Min(200, [Math]::Max(2, [int][Math]::Ceiling($DurationMs / 10.0)))
}

try {
    $request = Get-Content -LiteralPath $PayloadPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -eq $request.actions -or @($request.actions).Count -eq 0) {
        throw "At least one action is required"
    }

    [PiWindowsInput]::EnablePhysicalCoordinates()
    $dryRun = $request.dryRun -eq $true
    $summaries = [Collections.Generic.List[string]]::new()

    foreach ($action in @($request.actions)) {
        $actionType = [string]$action.type
        $hasX = $null -ne $action.x
        $hasY = $null -ne $action.y
        if ($hasX -xor $hasY) { throw "$actionType action requires x and y together" }

        switch ($actionType) {
            "move" {
                if (-not $hasX) { throw "move action requires x and y" }
                $x = Get-IntValue $action.x
                $y = Get-IntValue $action.y
                $duration = Get-IntValue $action.durationMs
                $steps = Get-Steps $action.steps $duration
                Assert-ScreenPoint $x $y "Move destination"
                if (-not $dryRun) { [PiWindowsInput]::SmoothMoveTo($x, $y, $duration, $steps) }
                $summaries.Add("move to $x,$y")
            }
            "click" {
                if ($hasX) {
                    $x = Get-IntValue $action.x
                    $y = Get-IntValue $action.y
                    Assert-ScreenPoint $x $y "Click point"
                    if (-not $dryRun) { [PiWindowsInput]::MoveTo($x, $y) }
                }
                $button = if ($null -eq $action.button) { "left" } else { [string]$action.button }
                $count = if ($null -eq $action.count) { 1 } else { Get-IntValue $action.count }
                $interval = Get-IntValue $action.intervalMs
                if ($count -lt 1 -or $count -gt 5) { throw "click count must be between 1 and 5" }
                for ($index = 0; $index -lt $count; $index++) {
                    if (-not $dryRun) { [PiWindowsInput]::Click($button) }
                    if (-not $dryRun -and $index -lt ($count - 1) -and $interval -gt 0) {
                        Start-Sleep -Milliseconds $interval
                    }
                }
                $summaries.Add("$button click x$count")
            }
            "drag" {
                if ($null -eq $action.toX -or $null -eq $action.toY) {
                    throw "drag action requires toX and toY"
                }
                $toX = Get-IntValue $action.toX
                $toY = Get-IntValue $action.toY
                Assert-ScreenPoint $toX $toY "Drag destination"
                if ($hasX) {
                    $x = Get-IntValue $action.x
                    $y = Get-IntValue $action.y
                    Assert-ScreenPoint $x $y "Drag start"
                    if (-not $dryRun) { [PiWindowsInput]::MoveTo($x, $y) }
                }
                $button = if ($null -eq $action.button) { "left" } else { [string]$action.button }
                $duration = Get-IntValue $action.durationMs 250
                $steps = Get-Steps $action.steps $duration
                if (-not $dryRun) {
                    [PiWindowsInput]::MouseDown($button)
                    try { [PiWindowsInput]::SmoothMoveTo($toX, $toY, $duration, $steps) }
                    finally { [PiWindowsInput]::MouseUp($button) }
                }
                $summaries.Add("$button drag to $toX,$toY")
            }
            "scroll" {
                if ($null -eq $action.delta) { throw "scroll action requires delta" }
                $delta = Get-IntValue $action.delta
                if ($delta -eq 0) { throw "scroll delta cannot be zero" }
                if ($hasX) {
                    $x = Get-IntValue $action.x
                    $y = Get-IntValue $action.y
                    Assert-ScreenPoint $x $y "Scroll point"
                    if (-not $dryRun) { [PiWindowsInput]::MoveTo($x, $y) }
                }
                $axis = if ($null -eq $action.axis) { "vertical" } else { [string]$action.axis }
                if ($axis -ne "vertical" -and $axis -ne "horizontal") { throw "Unknown scroll axis: $axis" }
                if (-not $dryRun) { [PiWindowsInput]::Scroll($delta, $axis -eq "horizontal") }
                $summaries.Add("$axis scroll $delta")
            }
            "key" {
                $keys = @($action.keys | ForEach-Object { [string]$_ })
                if ($keys.Count -eq 0) { throw "key action requires at least one key" }
                foreach ($key in $keys) { [void][PiWindowsInput]::ResolveKey($key) }
                $count = if ($null -eq $action.count) { 1 } else { Get-IntValue $action.count }
                $interval = Get-IntValue $action.intervalMs
                for ($index = 0; $index -lt $count; $index++) {
                    if (-not $dryRun) { [PiWindowsInput]::KeyChord($keys) }
                    if (-not $dryRun -and $index -lt ($count - 1) -and $interval -gt 0) {
                        Start-Sleep -Milliseconds $interval
                    }
                }
                $summaries.Add("keys " + ($keys -join "+") + " x$count")
            }
            "type" {
                if ($null -eq $action.text) { throw "type action requires text" }
                $text = [string]$action.text
                $interval = Get-IntValue $action.intervalMs
                if (-not $dryRun) { [PiWindowsInput]::TypeText($text, $interval) }
                $summaries.Add("type $($text.Length) character(s)")
            }
            "wait" {
                if ($null -eq $action.durationMs) { throw "wait action requires durationMs" }
                $duration = Get-IntValue $action.durationMs
                if (-not $dryRun -and $duration -gt 0) { Start-Sleep -Milliseconds $duration }
                $summaries.Add("wait ${duration}ms")
            }
            default { throw "Unknown action type: $actionType" }
        }
    }

    $cursor = [PiWindowsInput]::CursorPosition()
    $left = [PiWindowsInput]::GetSystemMetrics(76)
    $top = [PiWindowsInput]::GetSystemMetrics(77)
    $width = [PiWindowsInput]::GetSystemMetrics(78)
    $height = [PiWindowsInput]::GetSystemMetrics(79)

    [ordered]@{
        success = $true
        dryRun = $dryRun
        actionCount = @($request.actions).Count
        actions = $summaries
        cursor = [ordered]@{ x = $cursor.X; y = $cursor.Y }
        virtualScreen = [ordered]@{
            left = $left
            top = $top
            width = $width
            height = $height
        }
    } | ConvertTo-Json -Depth 6 -Compress
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
