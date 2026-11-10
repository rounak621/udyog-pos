using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace UdyogPos.Shell;

/// <summary>
/// One desktop window hosting the UDYOG POS web app. The main window owns
/// the menu and settings; same-origin popups (window.open / target=_blank,
/// e.g. /customer-display) become extra ShellWindows on the SAME
/// CoreWebView2Environment and profile, so BroadcastChannel and the session
/// cookie are shared.
///
/// Origin lock: top-level navigation is allowed only to the configured
/// server origin. Other http(s), mailto: and tel: links open in the user's
/// default handler; every other scheme (file:, custom protocols) is dropped.
/// </summary>
internal sealed class ShellWindow : Form
{
    private static CoreWebView2Environment? s_environment;
    private static string? s_offlineHtml;

    private readonly AppConfig _config;
    private readonly bool _isMain;
    private readonly string _placementKey;
    private readonly WebView2 _webView = new() { Dock = DockStyle.Fill };
    private readonly Label _messageLabel = new()
    {
        Dock = DockStyle.Fill,
        TextAlign = ContentAlignment.MiddleCenter,
        Font = new Font("Segoe UI", 11f),
        Visible = false,
    };
    private readonly NoticeBar _notice = new();
    private readonly MenuStrip? _menu;
    private readonly RegisteredWaitHandle? _activateWaitHandle;
    private readonly NativeBridge _bridge;

    private bool _fullScreen;
    private bool _restoreFullScreen;
    private FormWindowState _stateBeforeFullScreen = FormWindowState.Normal;
    private bool _offlinePageShown;
    private bool _navigatingToOfflinePage;
    private string? _lastAppUrl;

    public static string ShellVersion =>
        Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "0.0.0.0";

    public WebView2 WebView => _webView;

    public ShellWindow(AppConfig config, bool isMain, string placementKey, EventWaitHandle? activateEvent)
    {
        _config = config;
        _isMain = isMain;
        _placementKey = placementKey;
        _bridge = new NativeBridge(IsAppOrigin);

        Text = "UDYOG POS";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
        MinimumSize = isMain ? new Size(900, 600) : new Size(320, 240);

        Controls.Add(_webView);
        Controls.Add(_messageLabel);
        Controls.Add(_notice);
        if (isMain)
        {
            _menu = BuildMenu();
            Controls.Add(_menu);
            MainMenuStrip = _menu;
        }
        // Dock order: index 0 docks last, so the fill controls take what the
        // menu (top) and notice bar (bottom) leave.
        _messageLabel.BringToFront();
        _webView.BringToFront();

        ApplyPlacement();
        Shown += (_, _) => { if (_restoreFullScreen) SetFullScreen(true); };
        FormClosing += (_, _) =>
        {
            if (_isMain)
            {
                // Close second windows first so they save their own placement.
                foreach (var other in Application.OpenForms.OfType<ShellWindow>().Where(w => w != this).ToList())
                {
                    other.Close();
                }
            }
            SavePlacement();
        };

        if (isMain)
        {
            Load += async (_, _) => await InitializeMainAsync();
        }

        if (activateEvent is not null)
        {
            // A second launch (Program.cs) signals this: come to the front.
            _activateWaitHandle = ThreadPool.RegisterWaitForSingleObject(
                activateEvent,
                (_, _) => { if (IsHandleCreated) BeginInvoke((Action)BringToFrontFromSecondLaunch); },
                null,
                Timeout.InfiniteTimeSpan,
                false);
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _activateWaitHandle?.Unregister(null);
        base.Dispose(disposing);
    }

    // ---------------------------------------------------------------- setup

    private MenuStrip BuildMenu()
    {
        var menu = new MenuStrip();

        var fileMenu = new ToolStripMenuItem("File");
        var settings = new ToolStripMenuItem("Settings…") { ShortcutKeyDisplayString = "Ctrl+Shift+S" };
        settings.Click += async (_, _) => await OpenSettingsAsync();
        var printers = new ToolStripMenuItem("Printers…") { ShortcutKeyDisplayString = "Ctrl+Shift+P" };
        printers.Click += (_, _) => OpenPrinterSettings();
        var exit = new ToolStripMenuItem("Exit");
        exit.Click += (_, _) => Close();
        fileMenu.DropDownItems.Add(settings);
        fileMenu.DropDownItems.Add(printers);
        fileMenu.DropDownItems.Add(new ToolStripSeparator());
        fileMenu.DropDownItems.Add(exit);

        var viewMenu = new ToolStripMenuItem("View");
        var reload = new ToolStripMenuItem("Reload") { ShortcutKeyDisplayString = "F5" };
        reload.Click += (_, _) => Reload();
        var fullScreen = new ToolStripMenuItem("Full screen") { ShortcutKeyDisplayString = "F11" };
        fullScreen.Click += (_, _) => SetFullScreen(!_fullScreen);
        var actualSize = new ToolStripMenuItem("Actual size") { ShortcutKeyDisplayString = "Ctrl+0" };
        actualSize.Click += (_, _) => _webView.ZoomFactor = 1.0;
        viewMenu.DropDownItems.Add(reload);
        viewMenu.DropDownItems.Add(fullScreen);
        viewMenu.DropDownItems.Add(actualSize);

        menu.Items.Add(fileMenu);
        menu.Items.Add(viewMenu);
        return menu;
    }

    private async Task InitializeMainAsync()
    {
        if (!AppConfig.IsValidServerUrl(_config.ServerUrl))
        {
            if (!await OpenSettingsAsync())
            {
                Close(); // first run cancelled
                return;
            }
        }

        if (!await AttachAsync()) return;
        _webView.CoreWebView2.Navigate(_config.ServerUrl!);
    }

    private static async Task<CoreWebView2Environment> GetEnvironmentAsync()
    {
        if (s_environment is not null) return s_environment;
        Directory.CreateDirectory(AppConfig.WebView2UserDataFolder);
        // Autoplay without a user gesture, so the KDS chime plays on a
        // screen nobody has clicked yet.
        var options = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required");
        s_environment = await CoreWebView2Environment.CreateAsync(null, AppConfig.WebView2UserDataFolder, options);
        return s_environment;
    }

    /// <summary>Creates the CoreWebView2 and wires every handler. False on failure (message shown).</summary>
    public async Task<bool> AttachAsync()
    {
        try
        {
            await _webView.EnsureCoreWebView2Async(await GetEnvironmentAsync());
        }
        catch (WebView2RuntimeNotFoundException)
        {
            ShowMessage(
                "The Microsoft Edge WebView2 Runtime is required but isn't installed on this PC.\n\n" +
                "Install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 (Evergreen " +
                "Bootstrapper), then reopen UDYOG POS.");
            return false;
        }
        catch (Exception ex)
        {
            ShowMessage($"Could not start the browser component.\n\n{ex.Message}");
            return false;
        }

        var core = _webView.CoreWebView2;
        var settings = core.Settings;
#if DEBUG
        settings.AreDevToolsEnabled = true;
        settings.AreDefaultContextMenusEnabled = true;
        settings.IsStatusBarEnabled = true;
#else
        settings.AreDevToolsEnabled = false;
        settings.AreDefaultContextMenusEnabled = false;
        settings.IsStatusBarEnabled = false;
#endif
        // Browser keys stay on: Ctrl+P (print), Ctrl+F, copy/paste.
        settings.AreBrowserAcceleratorKeysEnabled = true;
        settings.IsZoomControlEnabled = true;
        settings.IsSwipeNavigationEnabled = false;
        settings.UserAgent = $"{settings.UserAgent} UDYOGPOS-Shell/{ShellVersion}";

        core.NavigationStarting += OnNavigationStarting;
        core.FrameNavigationStarting += OnFrameNavigationStarting;
        core.NavigationCompleted += OnNavigationCompleted;
        core.NewWindowRequested += OnNewWindowRequested;
        core.DownloadStarting += OnDownloadStarting;
        core.PermissionRequested += OnPermissionRequested;
        core.WebMessageReceived += OnWebMessageReceived;
        core.ContainsFullScreenElementChanged += (_, _) => SetFullScreen(core.ContainsFullScreenElement);
        core.WindowCloseRequested += (_, _) => { if (!_isMain) Close(); };

        _messageLabel.Visible = false;
        _webView.Visible = true;
        return true;
    }

    // ----------------------------------------------------------- origin lock

    private Uri? AppOrigin =>
        _config.ServerUrl is { } url && Uri.TryCreate(url, UriKind.Absolute, out var origin) ? origin : null;

    private bool IsAppOrigin(Uri uri)
    {
        var origin = AppOrigin;
        return origin is not null
            && uri.Scheme == origin.Scheme
            && string.Equals(uri.Host, origin.Host, StringComparison.OrdinalIgnoreCase)
            && uri.Port == origin.Port;
    }

    private static void OpenExternally(Uri uri)
    {
        if (uri.Scheme is not ("http" or "https" or "mailto" or "tel")) return;
        try
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
        catch
        {
            // No default handler: nothing to open.
        }
    }

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        // Our own offline page (NavigateToString) is the only non-app page
        // allowed; the flag is one-shot and set right before navigating to it.
        if (_navigatingToOfflinePage)
        {
            _navigatingToOfflinePage = false;
            return;
        }

        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri))
        {
            e.Cancel = true;
            return;
        }

        if (IsAppOrigin(uri))
        {
            _offlinePageShown = false;
            _lastAppUrl = uri.AbsoluteUri;
            return;
        }

        e.Cancel = true;
        OpenExternally(uri);
    }

    private void OnFrameNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        // iframes (e.g. the receipt/KOT print frame) may load web content,
        // but never local files or custom protocols.
        if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)
            && uri.Scheme is "http" or "https" or "about" or "data" or "blob")
        {
            return;
        }
        e.Cancel = true;
    }

    private async void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) || !IsAppOrigin(uri))
        {
            e.Handled = true;
            if (uri is not null) OpenExternally(uri);
            return;
        }

        // Same origin: a real second window on the same environment/profile.
        var deferral = e.GetDeferral();
        try
        {
            var window = new ShellWindow(_config, isMain: false, PlacementKeyFor(uri), activateEvent: null);
            window.Show();
            if (await window.AttachAsync())
            {
                e.NewWindow = window.WebView.CoreWebView2;
            }
            else
            {
                window.Close();
            }
            e.Handled = true;
        }
        catch
        {
            e.Handled = true;
        }
        finally
        {
            deferral.Complete();
        }
    }

    /// <summary>One saved placement per first path segment, e.g. "window:/customer-display".</summary>
    private static string PlacementKeyFor(Uri uri)
    {
        var first = uri.AbsolutePath.Trim('/').Split('/')[0];
        return "window:/" + first;
    }

    // --------------------------------------------------- offline/error page

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (e.IsSuccess) return;
        // Our own cancels (external links) and superseded navigations.
        if (e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;
        // The server answered with an HTTP error: that is the server's page, not "offline".
        if (e.HttpStatusCode != 0) return;
        ShowOfflinePage();
    }

    private void ShowOfflinePage()
    {
        _offlinePageShown = true;
        _navigatingToOfflinePage = true;
        _webView.CoreWebView2.NavigateToString(OfflineHtml);
    }

    private static string OfflineHtml => s_offlineHtml ??= LoadOfflineHtml();

    private static string LoadOfflineHtml()
    {
        var asm = typeof(ShellWindow).Assembly;
        using var htmlStream = asm.GetManifestResourceStream("offline.html")
            ?? throw new InvalidOperationException("offline.html resource missing");
        using var reader = new StreamReader(htmlStream);
        var html = reader.ReadToEnd();

        using var logoStream = asm.GetManifestResourceStream("logo.png")
            ?? throw new InvalidOperationException("logo.png resource missing");
        using var buffer = new MemoryStream();
        logoStream.CopyTo(buffer);
        return html.Replace("{{LOGO}}", "data:image/png;base64," + Convert.ToBase64String(buffer.ToArray()));
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        // App pages talk to the print bridge (it checks the origin itself).
        if (!_offlinePageShown)
        {
            _ = _bridge.HandleAsync(_webView.CoreWebView2, e);
            return;
        }

        // The local offline page only ever says "retry".
        string? message;
        try { message = e.TryGetWebMessageAsString(); }
        catch { return; }
        if (message == "retry") Retry();
    }

    private void Retry()
    {
        var target = _lastAppUrl ?? _config.ServerUrl;
        if (target is not null) _webView.CoreWebView2?.Navigate(target);
    }

    private void Reload()
    {
        if (_webView.CoreWebView2 is null) return;
        if (_offlinePageShown) Retry();
        else _webView.Reload();
    }

    // ------------------------------------------------------------ downloads

    private void OnDownloadStarting(object? sender, CoreWebView2DownloadStartingEventArgs e)
    {
        var name = Path.GetFileName(e.ResultFilePath);
        if (string.IsNullOrWhiteSpace(name)) name = "download";
        var target = UniquePath(DownloadsFolder(), name);
        e.ResultFilePath = target;
        e.Handled = true; // no default download flyout; we show our own notice

        var operation = e.DownloadOperation;
        operation.StateChanged += (_, _) =>
        {
            if (operation.State == CoreWebView2DownloadState.Completed)
            {
                _notice.ShowSaved(operation.ResultFilePath);
            }
            else if (operation.State == CoreWebView2DownloadState.Interrupted
                     && operation.InterruptReason != CoreWebView2DownloadInterruptReason.UserCanceled)
            {
                _notice.ShowText("Download failed.");
            }
        };
    }

    private static string DownloadsFolder()
    {
        string? path = null;
        try
        {
            if (NativeMethods.SHGetKnownFolderPath(NativeMethods.FolderIdDownloads, 0, IntPtr.Zero, out var p) == 0) path = p;
        }
        catch
        {
            // fall back below
        }
        path ??= Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        Directory.CreateDirectory(path);
        return path;
    }

    private static string UniquePath(string folder, string fileName)
    {
        var baseName = Path.GetFileNameWithoutExtension(fileName);
        var ext = Path.GetExtension(fileName);
        var candidate = Path.Combine(folder, fileName);
        for (var i = 1; File.Exists(candidate) && i < 1000; i++)
        {
            candidate = Path.Combine(folder, $"{baseName} ({i}){ext}");
        }
        return candidate;
    }

    // ---------------------------------------------------------- permissions

    private void OnPermissionRequested(object? sender, CoreWebView2PermissionRequestedEventArgs e)
    {
        var fromApp = Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) && IsAppOrigin(uri);
        if (e.PermissionKind == CoreWebView2PermissionKind.ClipboardRead)
        {
            e.State = fromApp ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
            return;
        }
        // Any other origin gets nothing; the app origin keeps WebView2's normal prompt.
        if (!fromApp) e.State = CoreWebView2PermissionState.Deny;
    }

    // ------------------------------------------------- keys and full screen

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        switch (keyData)
        {
            case Keys.F11:
                SetFullScreen(!_fullScreen);
                return true;
            case Keys.F5:
            case Keys.Control | Keys.R:
                Reload();
                return true;
            case Keys.Control | Keys.D0:
            case Keys.Control | Keys.NumPad0:
                _webView.ZoomFactor = 1.0;
                return true;
            case Keys.Control | Keys.Shift | Keys.P:
                BeginInvoke((Action)OpenPrinterSettings);
                return true;
            case Keys.Control | Keys.Shift | Keys.S when _isMain:
                // Not inside the WebView2 key callback: open the modal form afterwards.
                BeginInvoke((Action)(() => _ = OpenSettingsAsync()));
                return true;
        }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    private void SetFullScreen(bool on)
    {
        if (on == _fullScreen) return;
        _fullScreen = on;
        if (on)
        {
            _stateBeforeFullScreen = WindowState;
            if (_menu is not null) _menu.Visible = false;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Normal; // re-maximize so the borderless window covers the taskbar
            WindowState = FormWindowState.Maximized;
        }
        else
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            WindowState = _stateBeforeFullScreen;
            if (_menu is not null) _menu.Visible = true;
        }
    }

    private void BringToFrontFromSecondLaunch()
    {
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }

    // ------------------------------------------------------------ placement

    private void ApplyPlacement()
    {
        if (_config.WindowPlacements.TryGetValue(_placementKey, out var p) && p.Width > 0 && p.Height > 0)
        {
            var bounds = new Rectangle(p.X, p.Y, p.Width, p.Height);
            // Only restore onto a screen that still exists (second monitor unplugged = default spot).
            if (Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(bounds)))
            {
                StartPosition = FormStartPosition.Manual;
                Bounds = bounds;
                if (p.Maximized) WindowState = FormWindowState.Maximized;
                // Second windows (customer display) come back full screen on their monitor.
                _restoreFullScreen = !_isMain && p.FullScreen;
                return;
            }
        }
        StartPosition = FormStartPosition.CenterScreen;
        Size = _isMain ? new Size(1360, 860) : new Size(1024, 700);
    }

    private void SavePlacement()
    {
        var bounds = WindowState == FormWindowState.Normal && !_fullScreen ? Bounds : RestoreBounds;
        _config.WindowPlacements[_placementKey] = new WindowPlacement
        {
            X = bounds.X,
            Y = bounds.Y,
            Width = bounds.Width,
            Height = bounds.Height,
            Maximized = _fullScreen
                ? _stateBeforeFullScreen == FormWindowState.Maximized
                : WindowState == FormWindowState.Maximized,
            FullScreen = _fullScreen,
        };
        try { _config.Save(); }
        catch { /* best-effort */ }
    }

    // ------------------------------------------------------------- settings

    /// <summary>Shows the settings form. True when an address was saved.</summary>
    private async Task<bool> OpenSettingsAsync()
    {
        using var dialog = new ServerSettingsForm(_config.ServerUrl ?? AppConfig.BuildDefaultServerUrl, ShellVersion);
        if (dialog.ShowDialog(this) != DialogResult.OK || dialog.Result is null) return false;

        var changed = dialog.Result != _config.ServerUrl;
        _config.ServerUrl = dialog.Result;
        _config.Save();
        if (changed && _webView.CoreWebView2 is not null)
        {
            _lastAppUrl = null;
            _webView.CoreWebView2.Navigate(_config.ServerUrl);
        }
        await Task.CompletedTask;
        return true;
    }

    private void OpenPrinterSettings()
    {
        using var dialog = new PrinterSettingsForm();
        dialog.ShowDialog(this);
    }

    private void ShowMessage(string message)
    {
        _webView.Visible = false;
        _messageLabel.Text = message;
        _messageLabel.Visible = true;
    }

    private static class NativeMethods
    {
        public static readonly Guid FolderIdDownloads = new("374DE290-123F-4565-9164-39C4925E467B");

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        public static extern int SHGetKnownFolderPath(
            [MarshalAs(UnmanagedType.LPStruct)] Guid rfid, uint dwFlags, IntPtr hToken, out string pszPath);
    }
}

/// <summary>Small non-blocking bar at the bottom of a window ("Saved to Downloads").</summary>
internal sealed class NoticeBar : Panel
{
    private readonly Label _text = new() { AutoSize = true, Location = new Point(12, 9), Font = new Font("Segoe UI", 9.5f) };
    private readonly LinkLabel _openFolder = new() { Text = "Open folder", AutoSize = true, Font = new Font("Segoe UI", 9.5f) };
    private readonly Button _close = new() { Text = "×", FlatStyle = FlatStyle.Flat, Size = new Size(28, 24) };
    private readonly System.Windows.Forms.Timer _hideTimer = new() { Interval = 8000 };
    private string? _path;

    public NoticeBar()
    {
        Dock = DockStyle.Bottom;
        Height = 34;
        Visible = false;
        BackColor = Color.FromArgb(0x1A, 0x1A, 0x1A);
        _text.ForeColor = Color.White;
        _openFolder.LinkColor = Color.FromArgb(0xFF, 0x7A, 0x1A);
        _openFolder.ActiveLinkColor = Color.FromArgb(0xFF, 0x7A, 0x1A);
        _close.ForeColor = Color.White;
        _close.FlatAppearance.BorderSize = 0;
        _close.Anchor = AnchorStyles.Top | AnchorStyles.Right;

        _openFolder.LinkClicked += (_, _) => OpenFolder();
        _close.Click += (_, _) => Hide();
        _hideTimer.Tick += (_, _) => Hide();

        Controls.Add(_text);
        Controls.Add(_openFolder);
        Controls.Add(_close);
        Resize += (_, _) => _close.Location = new Point(Width - _close.Width - 8, 5);
    }

    public void ShowSaved(string path)
    {
        _path = path;
        ShowCore($"Saved to Downloads: {Path.GetFileName(path)}", showLink: true);
    }

    public void ShowText(string text)
    {
        _path = null;
        ShowCore(text, showLink: false);
    }

    private void ShowCore(string text, bool showLink)
    {
        _text.Text = text;
        _openFolder.Visible = showLink;
        _openFolder.Location = new Point(_text.Left + _text.PreferredWidth + 12, 9);
        Visible = true;
        _hideTimer.Stop();
        _hideTimer.Start();
    }

    private new void Hide()
    {
        _hideTimer.Stop();
        Visible = false;
    }

    private void OpenFolder()
    {
        if (_path is null) return;
        try
        {
            Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{_path}\"") { UseShellExecute = true });
        }
        catch
        {
            // best-effort
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _hideTimer.Dispose();
        base.Dispose(disposing);
    }
}
