namespace UdyogPos.Shell;

internal static class Program
{
    // One app per Windows user session: a second launch (Start Menu, desktop
    // shortcut, auto-start) signals the running window to come to the front
    // and exits. "Local\" (not "Global\") because this is a per-user desktop
    // app, and Local\ needs no extra permissions.
    private const string SingleInstanceMutexName = "Local\\UDYOGPOS_SingleInstance_5B1C7E2D";
    private const string ActivateEventName = "Local\\UDYOGPOS_Activate_5B1C7E2D";

    [STAThread]
    private static void Main()
    {
        // A packaged app must never die with a raw unhandled-exception
        // dialog: show a plain message and exit cleanly instead.
        Application.ThreadException += (_, args) => ReportFatal(args.Exception);
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
            ReportFatal(args.ExceptionObject as Exception ?? new Exception(args.ExceptionObject?.ToString()));

        using var singleInstanceMutex = new Mutex(initiallyOwned: true, SingleInstanceMutexName, out var createdNew);
        if (!createdNew)
        {
            try
            {
                using var existingActivateEvent = EventWaitHandle.OpenExisting(ActivateEventName);
                existingActivateEvent.Set();
            }
            catch (WaitHandleCannotBeOpenedException)
            {
                // The first instance owns the mutex but has not created its
                // activate event yet; it will finish starting on its own.
            }
            return;
        }

        using var activateEvent = new EventWaitHandle(initialState: false, EventResetMode.AutoReset, ActivateEventName);

        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm(activateEvent));
    }

    private static void ReportFatal(Exception ex)
    {
        try
        {
            Directory.CreateDirectory(AppConfig.LogDir);
            var logPath = Path.Combine(AppConfig.LogDir, $"crash-{DateTime.UtcNow:yyyyMMdd-HHmmss}.log");
            File.WriteAllText(logPath, ex.ToString());
        }
        catch
        {
            // Logging is best-effort.
        }

        MessageBox.Show(
            $"UDYOG POS hit an unexpected error and needs to close.\n\n{ex.Message}\n\n" +
            $"Details were saved to:\n{AppConfig.LogDir}",
            "UDYOG POS",
            MessageBoxButtons.OK,
            MessageBoxIcon.Error);
    }
}
