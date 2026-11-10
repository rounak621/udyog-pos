using System.Text.Json;
using System.Text.Json.Serialization;

namespace UdyogPos.Shell;

/// <summary>
/// One printer target. Kind is "windows" (an installed Windows printer, by
/// name, printed RAW through the spooler) or "network" (raw TCP, usually
/// port 9100). Paper width and code page are NOT stored here: they come
/// from the branch settings on the server, which builds the bytes.
/// </summary>
internal sealed class PrinterTarget
{
    public const string KindWindows = "windows";
    public const string KindNetwork = "network";

    public string Kind { get; set; } = KindWindows;
    public string? Name { get; set; }
    public string? Host { get; set; }
    public int Port { get; set; } = 9100;

    public bool IsUsable()
    {
        if (Kind == KindWindows) return !string.IsNullOrWhiteSpace(Name);
        if (Kind == KindNetwork) return !string.IsNullOrWhiteSpace(Host) && Port > 0 && Port <= 65535;
        return false;
    }
}

/// <summary>
/// Printers of THIS PC (not of the branch), saved in
/// %LOCALAPPDATA%\UDYOGPOS\printers.json. Only the printer settings form
/// writes it; the web app can read it through the bridge but never change it.
/// </summary>
internal sealed class DeviceConfig
{
    public const string RoleReceipt = "RECEIPT";
    public const string RoleKitchen = "KITCHEN";

    public PrinterTarget? Receipt { get; set; }
    public PrinterTarget? Kitchen { get; set; }
    public bool AutoPrintKitchen { get; set; }
    public List<string> KitchenStations { get; set; } = new();

    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = true,
    };

    public static string ConfigPath => Path.Combine(AppConfig.ConfigDir, "printers.json");

    /// <summary>Target for a role, or null when the role is unknown or not set up.</summary>
    public PrinterTarget? ForRole(string? role)
    {
        PrinterTarget? target = null;
        if (role == RoleReceipt) target = Receipt;
        else if (role == RoleKitchen) target = Kitchen;
        return target is not null && target.IsUsable() ? target : null;
    }

    public static DeviceConfig Load()
    {
        try
        {
            if (File.Exists(ConfigPath))
            {
                var cfg = JsonSerializer.Deserialize<DeviceConfig>(File.ReadAllText(ConfigPath), JsonOptions);
                if (cfg is not null)
                {
                    cfg.KitchenStations ??= new List<string>();
                    return cfg;
                }
            }
        }
        catch (Exception ex)
        {
            // Bad JSON: start again from defaults (the next save overwrites it).
            ShellLog.Write($"printers.json unreadable, using defaults: {ex.GetType().Name}");
        }
        return new DeviceConfig();
    }

    public void Save()
    {
        Directory.CreateDirectory(AppConfig.ConfigDir);
        File.WriteAllText(ConfigPath, JsonSerializer.Serialize(this, JsonOptions));
    }
}
