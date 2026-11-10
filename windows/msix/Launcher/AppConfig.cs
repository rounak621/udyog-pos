using System.Net.Http;
using System.Reflection;
using System.Text.Json;

namespace UdyogPos.Shell;

/// <summary>Saved size/position of one window (main, or a second window such as the customer display).</summary>
internal sealed class WindowPlacement
{
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public bool Maximized { get; set; }
    public bool FullScreen { get; set; }
}

/// <summary>
/// Per-user configuration: the UDYOG POS server origin and window
/// placements. Stored under %LOCALAPPDATA%\UDYOGPOS (not inside the
/// read-only MSIX install folder). Never holds credentials: sign-in is the
/// web app's own httpOnly cookie inside the WebView2 profile.
/// </summary>
internal sealed class AppConfig
{
    public string? ServerUrl { get; set; }

    public Dictionary<string, WindowPlacement> WindowPlacements { get; set; } = new();

    internal static string ConfigDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "UDYOGPOS");

    public static string ConfigPath => Path.Combine(ConfigDir, "config.json");

    public static string WebView2UserDataFolder => Path.Combine(ConfigDir, "WebView2");

    public static string LogDir => Path.Combine(ConfigDir, "logs");

    /// <summary>
    /// Optional build-time pre-fill for the first-run form
    /// (MSBuild property DefaultServerUrl, see Launcher.csproj). Empty = blank form.
    /// </summary>
    public static string? BuildDefaultServerUrl
    {
        get
        {
            var value = typeof(AppConfig).Assembly
                .GetCustomAttributes<AssemblyMetadataAttribute>()
                .FirstOrDefault(a => a.Key == "DefaultServerUrl")?.Value;
            return TryNormalizeServerUrl(value ?? string.Empty, out var normalized, out _) ? normalized : null;
        }
    }

    public static AppConfig Load()
    {
        try
        {
            if (File.Exists(ConfigPath))
            {
                var cfg = JsonSerializer.Deserialize<AppConfig>(File.ReadAllText(ConfigPath));
                if (cfg is not null)
                {
                    cfg.WindowPlacements ??= new();
                    return cfg;
                }
            }
        }
        catch
        {
            // Corrupt/unreadable config: start with first-run defaults.
        }
        return new AppConfig();
    }

    public void Save()
    {
        Directory.CreateDirectory(ConfigDir);
        var json = JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(ConfigPath, json);
    }

    /// <summary>True when the value is already a normalized, allowed server origin.</summary>
    public static bool IsValidServerUrl(string? value) =>
        value is not null && TryNormalizeServerUrl(value, out var normalized, out _) && normalized == value;

    /// <summary>
    /// Turns what the user typed into an origin ("https://host[:port]").
    /// HTTPS only; plain http is accepted only for localhost/127.0.0.1
    /// (development). Path, query and fragment are dropped; user:password
    /// in the URL is rejected.
    /// </summary>
    public static bool TryNormalizeServerUrl(string input, out string normalized, out string? error)
    {
        normalized = string.Empty;
        error = null;
        var trimmed = (input ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            error = "Enter the server address.";
            return false;
        }

        if (!trimmed.Contains("://", StringComparison.Ordinal))
        {
            trimmed = "https://" + trimmed;
        }

        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri) || string.IsNullOrEmpty(uri.Host))
        {
            error = "That doesn't look like a valid address. Example: pos.example.com";
            return false;
        }

        if (!string.IsNullOrEmpty(uri.UserInfo))
        {
            error = "Do not put a user name or password in the address.";
            return false;
        }

        var isLocalhost = uri.Host is "localhost" or "127.0.0.1";
        if (uri.Scheme != Uri.UriSchemeHttps && !(uri.Scheme == Uri.UriSchemeHttp && isLocalhost))
        {
            error = "The address must start with https:// (plain http is allowed only for localhost).";
            return false;
        }

        normalized = uri.GetLeftPart(UriPartial.Authority);
        return true;
    }

    /// <summary>
    /// Calls GET {origin}/api/health so the form can say right away whether
    /// the address answers like a UDYOG POS server.
    /// </summary>
    public static async Task<(bool Ok, string Message)> TestConnectionAsync(string serverUrl, CancellationToken ct)
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
            using var response = await client.GetAsync($"{serverUrl}/api/health", ct);
            if (response.IsSuccessStatusCode) return (true, "Connected.");
            return (false, $"Reached that address, but it didn't respond like a UDYOG POS server (HTTP {(int)response.StatusCode}).");
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return (false, "The server didn't respond in time. Check the address and your internet connection.");
        }
        catch (OperationCanceledException)
        {
            return (false, "Cancelled.");
        }
        catch (HttpRequestException ex)
        {
            return (false, $"Could not reach that address. Check it and your internet connection.\n({ex.Message})");
        }
        catch (Exception ex)
        {
            return (false, $"Could not connect: {ex.Message}");
        }
    }
}
