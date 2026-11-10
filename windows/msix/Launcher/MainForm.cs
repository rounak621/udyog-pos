using System.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace UdyogPos.Shell;

internal sealed class MainForm : Form
{
    private readonly WebView2 _webView = new() { Dock = DockStyle.Fill };
    private readonly Label _errorLabel = new()
    {
        Dock = DockStyle.Fill,
        TextAlign = ContentAlignment.MiddleCenter,
        Font = new Font("Segoe UI", 11f),
        Visible = false,
    };
    private readonly AppConfig _config;
    private readonly EventWaitHandle _activateEvent;
    private RegisteredWaitHandle? _activateWaitHandle;

    public MainForm(EventWaitHandle activateEvent)
    {
        Text = "UDYOG POS";
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1360, 860);
        MinimumSize = new Size(900, 600);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;

        _config = AppConfig.Load();
        _activateEvent = activateEvent;

        BuildMenu();
        Controls.Add(_errorLabel);
        Controls.Add(_webView);

        Load += async (_, _) => await InitializeAsync();

        // A second launch (see Program.cs) signals this event: bring this
        // window to the front on the UI thread.
        _activateWaitHandle = ThreadPool.RegisterWaitForSingleObject(
            _activateEvent,
            (_, _) => BeginInvoke((Action)BringToFrontFromSecondLaunch),
            null,
            Timeout.InfiniteTimeSpan,
            false);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _activateWaitHandle?.Unregister(null);
        base.Dispose(disposing);
    }

    private void BuildMenu()
    {
        var menu = new MenuStrip();
        var fileMenu = new ToolStripMenuItem("File");

        var changeServer = new ToolStripMenuItem("Change server address…");
        changeServer.Click += async (_, _) => await ChangeServerAsync();
        fileMenu.DropDownItems.Add(changeServer);
        fileMenu.DropDownItems.Add(new ToolStripSeparator());

        var exit = new ToolStripMenuItem("Exit");
        exit.Click += (_, _) => Close();
        fileMenu.DropDownItems.Add(exit);

        var viewMenu = new ToolStripMenuItem("View");
        var reload = new ToolStripMenuItem("Reload") { ShortcutKeys = Keys.F5 };
        reload.Click += (_, _) => _webView.Reload();
        viewMenu.DropDownItems.Add(reload);

        menu.Items.Add(fileMenu);
        menu.Items.Add(viewMenu);
        MainMenuStrip = menu;
        Controls.Add(menu);
    }

    private async Task InitializeAsync()
    {
        if (string.IsNullOrWhiteSpace(_config.ServerUrl) || !AppConfig.IsValidServerUrl(_config.ServerUrl, out _))
        {
            await ChangeServerAsync(isFirstRun: true);
            if (_config.ServerUrl is null) return; // cancelled; the form is closing
        }

        Directory.CreateDirectory(AppConfig.WebView2UserDataFolder);
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(
                userDataFolder: AppConfig.WebView2UserDataFolder);
            await _webView.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            ShowMessage(
                "The Microsoft Edge WebView2 Runtime is required but isn't installed on this PC.\n\n" +
                "Install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 (Evergreen " +
                "Bootstrapper), then reopen UDYOG POS.");
            return;
        }
        catch (Exception ex)
        {
            ShowMessage($"Could not start the browser component.\n\n{ex.Message}");
            return;
        }

        var settings = _webView.CoreWebView2.Settings;
        settings.AreDevToolsEnabled = false;
        settings.AreDefaultContextMenusEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = true;
        settings.IsSwipeNavigationEnabled = false;

        _webView.CoreWebView2.NewWindowRequested += (_, args) =>
        {
            args.Handled = true;
            _webView.CoreWebView2.Navigate(args.Uri);
        };

        _webView.NavigationCompleted += (_, args) =>
        {
            if (!args.IsSuccess)
            {
                ShowMessage($"Could not reach {_config.ServerUrl}.\n\nCheck your internet connection, then choose View → Reload.");
            }
            else
            {
                _errorLabel.Visible = false;
                _webView.Visible = true;
            }
        };

        Navigate();
    }

    private void BringToFrontFromSecondLaunch()
    {
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }

    private void Navigate()
    {
        if (_config.ServerUrl is null) return;
        _webView.CoreWebView2.Navigate(_config.ServerUrl);
    }

    private void ShowMessage(string message)
    {
        _webView.Visible = false;
        _errorLabel.Text = message;
        _errorLabel.Visible = true;
    }

    private async Task ChangeServerAsync(bool isFirstRun = false)
    {
        using var dialog = new ServerSettingsForm(_config.ServerUrl);
        var result = dialog.ShowDialog(this);
        if (result != DialogResult.OK || dialog.Result is null)
        {
            if (isFirstRun) Close();
            return;
        }
        _config.ServerUrl = dialog.Result;
        _config.Save();
        if (_webView.CoreWebView2 is not null) Navigate();
        await Task.CompletedTask;
    }
}
