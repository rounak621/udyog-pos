using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;

namespace UdyogPos.Shell;

/// <summary>A print failure with a short code the web app can show or log.</summary>
internal sealed class PrintFailure : Exception
{
    public string Code { get; }

    public PrintFailure(string code) : base(code)
    {
        Code = code;
    }
}

/// <summary>
/// Sends ready-made ESC/POS bytes to a printer: RAW through the Windows
/// spooler (USB/any printer with a Windows driver) or raw TCP (LAN printer).
/// Never looks at, changes or logs the bytes.
/// </summary>
internal static class RawPrinter
{
    // One job at a time: a LAN printer usually accepts one connection, and
    // the drawer pulse must not interleave with a receipt.
    private static readonly SemaphoreSlim Gate = new(1, 1);

    public static async Task SendAsync(PrinterTarget target, byte[] data)
    {
        await Gate.WaitAsync();
        try
        {
            if (target.Kind == PrinterTarget.KindWindows)
            {
                var name = target.Name ?? string.Empty;
                await Task.Run(() => SendToWindowsPrinter(name, data));
            }
            else if (target.Kind == PrinterTarget.KindNetwork)
            {
                await SendToNetworkPrinterAsync(target.Host ?? string.Empty, target.Port, data);
            }
            else
            {
                throw new PrintFailure("not_configured");
            }
        }
        finally
        {
            Gate.Release();
        }
    }

    /// <summary>Tiny local test slip: ESC @, one line, feeds, partial cut (GS V 1).</summary>
    public static byte[] TestSlip(string role)
    {
        var bytes = new List<byte> { 0x1B, 0x40 };
        bytes.AddRange(Encoding.ASCII.GetBytes("UDYOG POS printer test\n"));
        bytes.AddRange(Encoding.ASCII.GetBytes("Role: " + role + "\n"));
        bytes.AddRange(Encoding.ASCII.GetBytes("\n\n\n\n"));
        bytes.AddRange(new byte[] { 0x1D, 0x56, 0x01 });
        return bytes.ToArray();
    }

    // ------------------------------------------------------------ spooler

    private static void SendToWindowsPrinter(string printerName, byte[] data)
    {
        if (string.IsNullOrWhiteSpace(printerName)) throw new PrintFailure("not_configured");

        if (!NativeMethods.OpenPrinter(printerName, out var handle, IntPtr.Zero))
        {
            throw new PrintFailure($"printer_open_failed ({Marshal.GetLastWin32Error()})");
        }

        try
        {
            var docInfo = new NativeMethods.DOC_INFO_1
            {
                pDocName = "UDYOG POS",
                pOutputFile = null,
                pDataType = "RAW",
            };
            if (NativeMethods.StartDocPrinter(handle, 1, docInfo) == 0)
            {
                throw new PrintFailure($"start_doc_failed ({Marshal.GetLastWin32Error()})");
            }

            try
            {
                if (!NativeMethods.StartPagePrinter(handle))
                {
                    throw new PrintFailure($"start_page_failed ({Marshal.GetLastWin32Error()})");
                }

                try
                {
                    var buffer = Marshal.AllocHGlobal(data.Length);
                    try
                    {
                        Marshal.Copy(data, 0, buffer, data.Length);
                        if (!NativeMethods.WritePrinter(handle, buffer, data.Length, out var written))
                        {
                            throw new PrintFailure($"write_failed ({Marshal.GetLastWin32Error()})");
                        }
                        if (written != data.Length)
                        {
                            throw new PrintFailure("write_incomplete");
                        }
                    }
                    finally
                    {
                        Marshal.FreeHGlobal(buffer);
                    }
                }
                finally
                {
                    NativeMethods.EndPagePrinter(handle);
                }
            }
            finally
            {
                NativeMethods.EndDocPrinter(handle);
            }
        }
        finally
        {
            NativeMethods.ClosePrinter(handle);
        }
    }

    // ---------------------------------------------------------------- TCP

    private static async Task SendToNetworkPrinterAsync(string host, int port, byte[] data)
    {
        if (string.IsNullOrWhiteSpace(host) || port <= 0 || port > 65535)
        {
            throw new PrintFailure("not_configured");
        }

        using var client = new TcpClient();
        using (var connectTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(5)))
        {
            try
            {
                await client.ConnectAsync(host, port, connectTimeout.Token);
            }
            catch (OperationCanceledException)
            {
                throw new PrintFailure("connect_timeout");
            }
            catch (SocketException ex)
            {
                throw new PrintFailure($"connect_failed ({ex.SocketErrorCode})");
            }
        }

        var stream = client.GetStream();
        using (var writeTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(5)))
        {
            try
            {
                await stream.WriteAsync(data.AsMemory(), writeTimeout.Token);
                await stream.FlushAsync(writeTimeout.Token);
            }
            catch (OperationCanceledException)
            {
                throw new PrintFailure("write_timeout");
            }
            catch (IOException)
            {
                throw new PrintFailure("write_failed");
            }
        }
    }

    private static class NativeMethods
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public class DOC_INFO_1
        {
            [MarshalAs(UnmanagedType.LPWStr)] public string? pDocName;
            [MarshalAs(UnmanagedType.LPWStr)] public string? pOutputFile;
            [MarshalAs(UnmanagedType.LPWStr)] public string? pDataType;
        }

        [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

        [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true)]
        public static extern bool ClosePrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In] DOC_INFO_1 pDocInfo);

        [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
        public static extern bool EndDocPrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
        public static extern bool StartPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
        public static extern bool EndPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true)]
        public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
    }
}

/// <summary>Plain text log in %LOCALAPPDATA%\UDYOGPOS\logs\shell.log. Never pass print data here.</summary>
internal static class ShellLog
{
    private static readonly object Lock = new();

    public static void Write(string message)
    {
        try
        {
            lock (Lock)
            {
                Directory.CreateDirectory(AppConfig.LogDir);
                File.AppendAllText(
                    Path.Combine(AppConfig.LogDir, "shell.log"),
                    $"{DateTime.UtcNow:O} {message}{Environment.NewLine}");
            }
        }
        catch
        {
            // Logging is best-effort.
        }
    }
}
