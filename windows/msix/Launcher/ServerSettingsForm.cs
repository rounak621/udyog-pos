using System.Runtime.InteropServices;

namespace UdyogPos.Shell;

/// <summary>
/// First-run and Ctrl+Shift+S form: the UDYOG POS server address (HTTPS
/// origin, see AppConfig.TryNormalizeServerUrl) and the start-at-sign-in
/// option. The address is checked against GET /api/health before saving
/// unless the user chooses "Save without checking". No credentials here:
/// sign-in happens in the web app.
/// </summary>
internal sealed class ServerSettingsForm : Form
{
    private readonly TextBox _urlBox;
    private readonly Label _statusLabel;
    private readonly Button _saveButton;
    private readonly LinkLabel _skipTestLink;
    private readonly CheckBox _autoStartBox;
    private bool _autoStartLoading = true;
    private CancellationTokenSource? _testCts;

    public string? Result { get; private set; }

    public ServerSettingsForm(string? currentUrl, string shellVersion)
    {
        Text = "UDYOG POS settings";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        ClientSize = new Size(460, 300);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;

        var titleLabel = new Label
        {
            Text = "UDYOG POS server address",
            Font = new Font("Segoe UI", 11f, FontStyle.Bold),
            AutoSize = false,
            Location = new Point(20, 16),
            Size = new Size(420, 24),
        };

        var helpLabel = new Label
        {
            Text = "Ask UDYOG support for this address if you don't have it.",
            AutoSize = false,
            ForeColor = SystemColors.GrayText,
            Location = new Point(20, 44),
            Size = new Size(420, 20),
        };

        _urlBox = new TextBox
        {
            Location = new Point(20, 70),
            Size = new Size(420, 24),
            Text = currentUrl ?? string.Empty,
            Font = new Font("Segoe UI", 10f),
        };
        SetCueBanner(_urlBox, "https://pos.example.com");

        _statusLabel = new Label
        {
            AutoSize = false,
            Location = new Point(20, 100),
            Size = new Size(420, 36),
            Font = new Font("Segoe UI", 9f),
        };

        _skipTestLink = new LinkLabel
        {
            Text = "Save without checking",
            AutoSize = true,
            Location = new Point(20, 140),
            Font = new Font("Segoe UI", 8.5f),
        };
        _skipTestLink.LinkClicked += async (_, _) => await SaveAsync(skipTest: true);

        _autoStartBox = new CheckBox
        {
            Text = "Start UDYOG POS when I sign in to Windows",
            AutoSize = true,
            Location = new Point(20, 176),
            Font = new Font("Segoe UI", 9.5f),
            Enabled = false, // enabled once the current state is known
        };
        _autoStartBox.CheckedChanged += async (_, _) => await ToggleAutoStartAsync();

        _saveButton = new Button
        {
            Text = "Save",
            Location = new Point(268, 216),
            Size = new Size(84, 30),
            DialogResult = DialogResult.None,
        };
        _saveButton.Click += async (_, _) => await SaveAsync(skipTest: false);

        var cancelButton = new Button
        {
            Text = "Cancel",
            Location = new Point(360, 216),
            Size = new Size(80, 30),
            DialogResult = DialogResult.Cancel,
        };

        var versionLabel = new Label
        {
            Text = $"UDYOG POS for Windows, version {shellVersion}",
            AutoSize = false,
            ForeColor = SystemColors.GrayText,
            Location = new Point(20, 268),
            Size = new Size(420, 20),
            Font = new Font("Segoe UI", 8.5f),
        };

        AcceptButton = _saveButton;
        CancelButton = cancelButton;

        Controls.AddRange(new Control[]
        {
            titleLabel, helpLabel, _urlBox, _statusLabel, _skipTestLink,
            _autoStartBox, _saveButton, cancelButton, versionLabel,
        });

        Shown += async (_, _) =>
        {
            _autoStartBox.Checked = await AutoStart.IsEnabledAsync();
            _autoStartLoading = false;
            _autoStartBox.Enabled = true;
        };
    }

    private async Task ToggleAutoStartAsync()
    {
        if (_autoStartLoading) return;
        var wanted = _autoStartBox.Checked;
        _autoStartBox.Enabled = false;
        var error = await AutoStart.SetEnabledAsync(wanted);
        if (error is not null)
        {
            _autoStartLoading = true;
            _autoStartBox.Checked = !wanted; // revert the tick, nothing changed
            _autoStartLoading = false;
            SetStatus(error, isError: true);
        }
        _autoStartBox.Enabled = true;
    }

    private async Task SaveAsync(bool skipTest)
    {
        if (!AppConfig.TryNormalizeServerUrl(_urlBox.Text, out var normalized, out var error))
        {
            SetStatus(error!, isError: true);
            return;
        }
        _urlBox.Text = normalized;

        if (skipTest)
        {
            Accept(normalized);
            return;
        }

        _testCts?.Cancel();
        using var cts = new CancellationTokenSource();
        _testCts = cts;

        SetBusy(true);
        SetStatus("Checking connection…", isError: false);
        var (ok, message) = await AppConfig.TestConnectionAsync(normalized, cts.Token);
        if (cts.IsCancellationRequested) return; // superseded by a newer attempt

        SetBusy(false);
        if (ok) Accept(normalized);
        else SetStatus(message, isError: true);
    }

    private void Accept(string normalized)
    {
        Result = normalized;
        DialogResult = DialogResult.OK;
        Close();
    }

    private void SetBusy(bool busy)
    {
        _urlBox.Enabled = !busy;
        _saveButton.Enabled = !busy;
        _skipTestLink.Enabled = !busy;
        _saveButton.Text = busy ? "Checking…" : "Save";
    }

    private void SetStatus(string text, bool isError)
    {
        _statusLabel.Text = text;
        _statusLabel.ForeColor = isError ? Color.Firebrick : Color.SeaGreen;
    }

    private static void SetCueBanner(TextBox textBox, string text) =>
        NativeMethods.SendMessage(textBox.Handle, NativeMethods.EM_SETCUEBANNER, IntPtr.Zero, text);

    private static class NativeMethods
    {
        public const int EM_SETCUEBANNER = 0x1501;

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, string lParam);
    }
}
