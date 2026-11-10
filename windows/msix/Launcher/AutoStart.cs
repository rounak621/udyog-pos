using Microsoft.Win32;
using WinStartupTask = global::Windows.ApplicationModel.StartupTask;
using WinStartupTaskState = global::Windows.ApplicationModel.StartupTaskState;

namespace UdyogPos.Shell;

/// <summary>
/// "Start UDYOG POS when I sign in to Windows" (default OFF).
///
/// Installed as MSIX: uses the package's StartupTask (AppxManifest.xml,
/// TaskId below). A packaged app's HKCU writes are redirected to a private
/// per-app copy of the registry, so an HKCU Run value would not be seen by
/// Windows at sign-in. Unpackaged (dev run of the .exe): uses the HKCU Run key.
/// Both are per-user and reversible.
/// </summary>
internal static class AutoStart
{
    private const string TaskId = "UDYOGPOSStartup"; // must match AppxManifest.xml
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValueName = "UDYOGPOS";

    private static bool IsPackaged
    {
        get
        {
            try { return global::Windows.ApplicationModel.Package.Current is not null; }
            catch { return false; } // no package identity
        }
    }

    public static async Task<bool> IsEnabledAsync()
    {
        try
        {
            if (IsPackaged)
            {
                var task = await WinStartupTask.GetAsync(TaskId);
                return task.State is WinStartupTaskState.Enabled or WinStartupTaskState.EnabledByPolicy;
            }
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath);
            return key?.GetValue(RunValueName) is string;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Returns null on success, else a message for the user.</summary>
    public static async Task<string?> SetEnabledAsync(bool enabled)
    {
        try
        {
            if (IsPackaged)
            {
                var task = await WinStartupTask.GetAsync(TaskId);
                if (!enabled)
                {
                    task.Disable();
                    return null;
                }
                var state = await task.RequestEnableAsync();
                return state switch
                {
                    WinStartupTaskState.Enabled or WinStartupTaskState.EnabledByPolicy => null,
                    WinStartupTaskState.DisabledByUser =>
                        "Windows has start-up turned off for UDYOG POS. Turn it on in Task Manager > Startup apps.",
                    WinStartupTaskState.DisabledByPolicy => "Start-up is blocked by your organisation's policy.",
                    _ => "Windows did not turn on start-up.",
                };
            }

            using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath);
            if (enabled) key.SetValue(RunValueName, $"\"{Application.ExecutablePath}\"");
            else key.DeleteValue(RunValueName, throwOnMissingValue: false);
            return null;
        }
        catch (Exception ex)
        {
            return $"Could not change start-up: {ex.Message}";
        }
    }
}
