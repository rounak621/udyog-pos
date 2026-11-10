using System.Drawing.Printing;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace UdyogPos.Shell;

/// <summary>Error returned to the web app as { ok: false, error: Code }.</summary>
internal sealed class BridgeError : Exception
{
    public string Code { get; }

    public BridgeError(string code) : base(code)
    {
        Code = code;
    }
}

/// <summary>
/// Message bridge between the hosted web app and this PC's printers.
///
/// Request (web -> shell, window.chrome.webview.postMessage):
///   { id: string, type: string, payload: object }
/// Reply (shell -> web, PostWebMessageAsJson):
///   { id, ok: true, data } or { id, ok: false, error }
///
/// Trust: a message is handled only when its Source is the configured server
/// origin; anything else is ignored without a reply. Messages arrive only on
/// WebViews this shell created (ShellWindow wires the handler). No command
/// reads or writes arbitrary files or starts processes; the printer config
/// can be read here but only changed in the printer settings form.
/// </summary>
internal sealed class NativeBridge
{
    public const int BridgeVersion = 1;
    private const int MaxMessageChars = 1_000_000; // about 1 MB of JSON

    private readonly Func<Uri, bool> _isAppOrigin;

    public NativeBridge(Func<Uri, bool> isAppOrigin)
    {
        _isAppOrigin = isAppOrigin;
    }

    /// <summary>
    /// Called from CoreWebView2.WebMessageReceived on the UI thread. Everything
    /// read from the event args is read before the first await.
    /// </summary>
    public async Task HandleAsync(CoreWebView2 core, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var source) || !_isAppOrigin(source))
        {
            return; // not our server: ignore silently
        }

        string json;
        try
        {
            json = e.WebMessageAsJson;
        }
        catch
        {
            return;
        }

        string? id;
        string? type;
        JsonElement payload;
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return;
            id = GetString(root, "id");
            type = GetString(root, "type");
            payload = root.TryGetProperty("payload", out var p) ? p.Clone() : default;
        }
        catch
        {
            return; // not a bridge message
        }

        if (string.IsNullOrEmpty(id) || id.Length > 100) return;

        string replyJson;
        if (json.Length > MaxMessageChars)
        {
            replyJson = ErrorReply(id, "too_large");
        }
        else
        {
            try
            {
                var data = await ExecuteAsync(type, payload);
                replyJson = JsonSerializer.Serialize(new { id, ok = true, data }, DeviceConfig.JsonOptions);
            }
            catch (BridgeError ex)
            {
                replyJson = ErrorReply(id, ex.Code);
            }
            catch (PrintFailure ex)
            {
                ShellLog.Write($"print failed: {type} {ex.Code}");
                replyJson = ErrorReply(id, ex.Code);
            }
            catch (Exception ex)
            {
                ShellLog.Write($"bridge error: {type} {ex.GetType().Name}");
                replyJson = ErrorReply(id, "internal_error");
            }
        }

        try
        {
            core.PostWebMessageAsJson(replyJson);
        }
        catch
        {
            // The window closed or navigated away; nothing to reply to.
        }
    }

    private static string ErrorReply(string id, string code) =>
        JsonSerializer.Serialize(new { id, ok = false, error = code }, DeviceConfig.JsonOptions);

    private static string? GetString(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object) return null;
        if (!obj.TryGetProperty(name, out var value)) return null;
        return value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    private static async Task<object?> ExecuteAsync(string? type, JsonElement payload)
    {
        switch (type)
        {
            case "hello":
                return new { bridgeVersion = BridgeVersion, shellVersion = ShellWindow.ShellVersion };

            case "getPrinters":
            {
                var installed = new List<string>();
                foreach (string name in PrinterSettings.InstalledPrinters)
                {
                    installed.Add(name);
                }
                var config = DeviceConfig.Load();
                return new { installed, receipt = config.Receipt, kitchen = config.Kitchen };
            }

            case "getDeviceConfig":
            {
                var config = DeviceConfig.Load();
                return new
                {
                    receipt = config.Receipt,
                    kitchen = config.Kitchen,
                    autoPrintKitchen = config.AutoPrintKitchen,
                    kitchenStations = config.KitchenStations,
                };
            }

            case "printRaw":
            {
                var role = GetString(payload, "role");
                var base64 = GetString(payload, "dataBase64");
                if (string.IsNullOrEmpty(base64)) throw new BridgeError("bad_data");
                byte[] data;
                try
                {
                    data = Convert.FromBase64String(base64);
                }
                catch (FormatException)
                {
                    throw new BridgeError("bad_data");
                }
                if (data.Length == 0) throw new BridgeError("bad_data");
                await SendToRoleAsync(role, data);
                return null;
            }

            case "printTest":
            {
                var role = GetString(payload, "role");
                await SendToRoleAsync(role, RawPrinter.TestSlip(role ?? string.Empty));
                return null;
            }

            default:
                throw new BridgeError("unknown_command");
        }
    }

    private static async Task SendToRoleAsync(string? role, byte[] data)
    {
        if (role != DeviceConfig.RoleReceipt && role != DeviceConfig.RoleKitchen)
        {
            throw new BridgeError("bad_role");
        }
        var target = DeviceConfig.Load().ForRole(role);
        if (target is null) throw new BridgeError("not_configured");
        await RawPrinter.SendAsync(target, data);
    }
}
