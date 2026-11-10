using System.Drawing.Printing;

namespace UdyogPos.Shell;

/// <summary>
/// Ctrl+Shift+P: printers of THIS PC. For each role (receipt, kitchen) pick
/// a Windows printer, a network printer (host + port) or nothing, with a
/// test print. Saves %LOCALAPPDATA%\UDYOGPOS\printers.json (DeviceConfig).
/// </summary>
internal sealed class PrinterSettingsForm : Form
{
    private readonly RoleBox _receiptBox;
    private readonly RoleBox _kitchenBox;
    private readonly CheckBox _autoPrintBox;
    private readonly TextBox _stationsBox;
    private readonly Label _statusLabel;
    private readonly DeviceConfig _config;

    public PrinterSettingsForm()
    {
        Text = "UDYOG POS printers";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterParent;
        MaximizeBox = false;
        MinimizeBox = false;
        ClientSize = new Size(480, 540);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;

        _config = DeviceConfig.Load();
        var installed = new List<string>();
        try
        {
            foreach (string name in PrinterSettings.InstalledPrinters)
            {
                installed.Add(name);
            }
        }
        catch
        {
            // No print spooler: the list stays empty, network printers still work.
        }

        var titleLabel = new Label
        {
            Text = "Printers on this PC",
            Font = new Font("Segoe UI", 11f, FontStyle.Bold),
            AutoSize = false,
            Location = new Point(20, 14),
            Size = new Size(440, 24),
        };

        _receiptBox = new RoleBox("Receipt printer (bills, cash drawer)", DeviceConfig.RoleReceipt, installed, _config.Receipt)
        {
            Location = new Point(20, 44),
        };
        _kitchenBox = new RoleBox("Kitchen printer (kitchen tickets)", DeviceConfig.RoleKitchen, installed, _config.Kitchen)
        {
            Location = new Point(20, 204),
        };

        _autoPrintBox = new CheckBox
        {
            Text = "Auto-print kitchen tickets on this PC",
            AutoSize = true,
            Location = new Point(20, 368),
            Font = new Font("Segoe UI", 9.5f),
            Checked = _config.AutoPrintKitchen,
        };

        var stationsLabel = new Label
        {
            Text = "Kitchen station ids (comma separated, empty = all stations)",
            AutoSize = false,
            Location = new Point(20, 398),
            Size = new Size(440, 20),
            Font = new Font("Segoe UI", 9f),
        };

        _stationsBox = new TextBox
        {
            Location = new Point(20, 420),
            Size = new Size(440, 24),
            Font = new Font("Segoe UI", 10f),
            Text = string.Join(", ", _config.KitchenStations),
        };

        _statusLabel = new Label
        {
            AutoSize = false,
            Location = new Point(20, 452),
            Size = new Size(440, 36),
            Font = new Font("Segoe UI", 9f),
            ForeColor = Color.Firebrick,
        };

        var saveButton = new Button
        {
            Text = "Save",
            Location = new Point(288, 494),
            Size = new Size(84, 30),
        };
        saveButton.Click += (_, _) => Save();

        var cancelButton = new Button
        {
            Text = "Cancel",
            Location = new Point(380, 494),
            Size = new Size(80, 30),
            DialogResult = DialogResult.Cancel,
        };

        AcceptButton = saveButton;
        CancelButton = cancelButton;

        Controls.Add(titleLabel);
        Controls.Add(_receiptBox);
        Controls.Add(_kitchenBox);
        Controls.Add(_autoPrintBox);
        Controls.Add(stationsLabel);
        Controls.Add(_stationsBox);
        Controls.Add(_statusLabel);
        Controls.Add(saveButton);
        Controls.Add(cancelButton);
    }

    private void Save()
    {
        if (!_receiptBox.TryGetTarget(out var receipt, out var receiptError))
        {
            _statusLabel.Text = "Receipt printer: " + receiptError;
            return;
        }
        if (!_kitchenBox.TryGetTarget(out var kitchen, out var kitchenError))
        {
            _statusLabel.Text = "Kitchen printer: " + kitchenError;
            return;
        }

        _config.Receipt = receipt;
        _config.Kitchen = kitchen;
        _config.AutoPrintKitchen = _autoPrintBox.Checked;
        _config.KitchenStations = ParseStations(_stationsBox.Text);

        try
        {
            _config.Save();
        }
        catch (Exception ex)
        {
            _statusLabel.Text = "Could not save: " + ex.Message;
            return;
        }

        DialogResult = DialogResult.OK;
        Close();
    }

    private static List<string> ParseStations(string text)
    {
        var result = new List<string>();
        foreach (var part in text.Split(','))
        {
            var id = part.Trim();
            if (id.Length > 0 && id.Length <= 100 && !result.Contains(id)) result.Add(id);
        }
        return result;
    }
}

/// <summary>One role (receipt or kitchen): not set / Windows printer / network printer, plus a test button.</summary>
internal sealed class RoleBox : GroupBox
{
    private readonly string _role;
    private readonly RadioButton _noneOption;
    private readonly RadioButton _windowsOption;
    private readonly RadioButton _networkOption;
    private readonly ComboBox _printerList;
    private readonly TextBox _hostBox;
    private readonly NumericUpDown _portBox;
    private readonly Button _testButton;
    private readonly Label _testStatus;

    public RoleBox(string title, string role, List<string> installedPrinters, PrinterTarget? current)
    {
        _role = role;
        Text = title;
        Size = new Size(440, 150);
        Font = new Font("Segoe UI", 9f);

        _noneOption = new RadioButton { Text = "Not set", AutoSize = true, Location = new Point(12, 22) };
        _windowsOption = new RadioButton { Text = "Windows printer", AutoSize = true, Location = new Point(12, 50) };
        _networkOption = new RadioButton { Text = "Network printer", AutoSize = true, Location = new Point(12, 82) };

        _printerList = new ComboBox
        {
            DropDownStyle = ComboBoxStyle.DropDownList,
            Location = new Point(150, 47),
            Size = new Size(276, 24),
        };
        foreach (var name in installedPrinters)
        {
            _printerList.Items.Add(name);
        }

        _hostBox = new TextBox { Location = new Point(150, 79), Size = new Size(190, 24) };
        var colon = new Label { Text = "Port", AutoSize = true, Location = new Point(346, 82) };
        _portBox = new NumericUpDown
        {
            Location = new Point(378, 79),
            Size = new Size(48, 24),
            Minimum = 1,
            Maximum = 65535,
            Value = 9100,
        };

        _testButton = new Button { Text = "Test print", Location = new Point(12, 112), Size = new Size(90, 28) };
        _testStatus = new Label { AutoSize = false, Location = new Point(110, 118), Size = new Size(316, 20) };
        _testButton.Click += async (_, _) => await TestAsync();

        Controls.Add(_noneOption);
        Controls.Add(_windowsOption);
        Controls.Add(_networkOption);
        Controls.Add(_printerList);
        Controls.Add(_hostBox);
        Controls.Add(colon);
        Controls.Add(_portBox);
        Controls.Add(_testButton);
        Controls.Add(_testStatus);

        // Current values.
        if (current is not null && current.Kind == PrinterTarget.KindWindows)
        {
            _windowsOption.Checked = true;
            if (!string.IsNullOrEmpty(current.Name))
            {
                if (!_printerList.Items.Contains(current.Name)) _printerList.Items.Add(current.Name);
                _printerList.SelectedItem = current.Name;
            }
        }
        else if (current is not null && current.Kind == PrinterTarget.KindNetwork)
        {
            _networkOption.Checked = true;
            _hostBox.Text = current.Host ?? string.Empty;
            if (current.Port >= 1 && current.Port <= 65535) _portBox.Value = current.Port;
        }
        else
        {
            _noneOption.Checked = true;
        }

        _noneOption.CheckedChanged += (_, _) => UpdateEnabled();
        _windowsOption.CheckedChanged += (_, _) => UpdateEnabled();
        _networkOption.CheckedChanged += (_, _) => UpdateEnabled();
        UpdateEnabled();
    }

    private void UpdateEnabled()
    {
        _printerList.Enabled = _windowsOption.Checked;
        _hostBox.Enabled = _networkOption.Checked;
        _portBox.Enabled = _networkOption.Checked;
        _testButton.Enabled = !_noneOption.Checked;
    }

    /// <summary>False with a message when the choice is incomplete. "Not set" gives a null target.</summary>
    public bool TryGetTarget(out PrinterTarget? target, out string error)
    {
        target = null;
        error = string.Empty;

        if (_noneOption.Checked) return true;

        if (_windowsOption.Checked)
        {
            if (_printerList.SelectedItem is not string name || name.Length == 0)
            {
                error = "choose a Windows printer.";
                return false;
            }
            target = new PrinterTarget { Kind = PrinterTarget.KindWindows, Name = name };
            return true;
        }

        var host = _hostBox.Text.Trim();
        if (host.Length == 0 || host.Length > 253 || Uri.CheckHostName(host) == UriHostNameType.Unknown)
        {
            error = "enter the printer's IP address or host name.";
            return false;
        }
        target = new PrinterTarget { Kind = PrinterTarget.KindNetwork, Host = host, Port = (int)_portBox.Value };
        return true;
    }

    private async Task TestAsync()
    {
        if (!TryGetTarget(out var target, out var error) || target is null)
        {
            SetStatus(error.Length > 0 ? error : "choose a printer first.", ok: false);
            return;
        }

        _testButton.Enabled = false;
        SetStatus("Printing…", ok: true);
        try
        {
            await RawPrinter.SendAsync(target, RawPrinter.TestSlip(_role));
            SetStatus("Sent to the printer.", ok: true);
        }
        catch (PrintFailure ex)
        {
            ShellLog.Write($"test print failed: {_role} {ex.Code}");
            SetStatus("Failed: " + ex.Code, ok: false);
        }
        catch (Exception ex)
        {
            ShellLog.Write($"test print failed: {_role} {ex.GetType().Name}");
            SetStatus("Failed: " + ex.Message, ok: false);
        }
        finally
        {
            _testButton.Enabled = true;
        }
    }

    private void SetStatus(string text, bool ok)
    {
        _testStatus.Text = text;
        _testStatus.ForeColor = ok ? Color.SeaGreen : Color.Firebrick;
    }
}
