using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;

namespace VisioWorker.Live;

/// <summary>
/// Resolves the actual Windows process that owns a Visio application window.
/// </summary>
public interface IVisioProcessWindowAdapter
{
    bool TryGetWindowProcessId(nint windowHandle, out int processId);

    bool TryGetProcessIdentity(int processId, out VisioProcessIdentity processIdentity);
}

/// <summary>
/// Process data used to prove that a later process lookup still identifies the launched Visio instance.
/// </summary>
public readonly record struct VisioProcessIdentity(string ExecutableName, DateTime ProcessStartTimeUtc);

internal sealed class OwnedVisioApplicationLease
{
    private const string VisioExecutableName = "VISIO.EXE";

    private OwnedVisioApplicationLease(int processId, DateTime processStartTimeUtc)
    {
        ProcessId = processId;
        ProcessStartTimeUtc = processStartTimeUtc;
    }

    public int ProcessId { get; }

    public DateTime ProcessStartTimeUtc { get; }

    public bool OwnsApplication => true;

    public string ExecutableName => VisioExecutableName;

    internal static OwnedVisioApplicationLease? TryCreate(
        object application,
        bool ownsApplication,
        IVisioProcessWindowAdapter processWindowAdapter)
    {
        ArgumentNullException.ThrowIfNull(application);
        ArgumentNullException.ThrowIfNull(processWindowAdapter);
        if (!ownsApplication || !TryGetWindowHandle(application, out var windowHandle)) return null;
        if (!processWindowAdapter.TryGetWindowProcessId(windowHandle, out var processId) || processId <= 0) return null;
        if (!processWindowAdapter.TryGetProcessIdentity(processId, out var identity) || !IsVerifiedVisio(identity)) return null;

        return new OwnedVisioApplicationLease(processId, identity.ProcessStartTimeUtc.ToUniversalTime());
    }

    /// <summary>
    /// Checks whether a future process lookup still identifies this exact Visio process. Task 2 owns
    /// any decision to terminate a process; this method deliberately performs no process action.
    /// </summary>
    internal bool MatchesCurrentProcess(IVisioProcessWindowAdapter processWindowAdapter)
    {
        ArgumentNullException.ThrowIfNull(processWindowAdapter);
        return OwnsApplication
            && processWindowAdapter.TryGetProcessIdentity(ProcessId, out var identity)
            && IsVerifiedVisio(identity)
            && identity.ProcessStartTimeUtc.ToUniversalTime() == ProcessStartTimeUtc;
    }

    private static bool TryGetWindowHandle(object application, out nint windowHandle)
    {
        try
        {
            dynamic visioApplication = application;
            var windowHandle32 = Convert.ToInt32(visioApplication.WindowHandle32, CultureInfo.InvariantCulture);
            if (windowHandle32 == 0)
            {
                windowHandle = 0;
                return false;
            }

            windowHandle = unchecked((nint)(uint)windowHandle32);
            return true;
        }
        catch
        {
            windowHandle = 0;
            return false;
        }
    }

    private static bool IsVerifiedVisio(VisioProcessIdentity identity) =>
        identity.ProcessStartTimeUtc != default
        && string.Equals(Path.GetFileName(identity.ExecutableName), VisioExecutableName, StringComparison.OrdinalIgnoreCase);
}

internal sealed class WindowsVisioProcessWindowAdapter : IVisioProcessWindowAdapter
{
    public bool TryGetWindowProcessId(nint windowHandle, out int processId)
    {
        processId = 0;
        if (!OperatingSystem.IsWindows() || windowHandle == 0) return false;

        var threadId = GetWindowThreadProcessId(windowHandle, out var nativeProcessId);
        if (threadId == 0 || nativeProcessId == 0 || nativeProcessId > int.MaxValue) return false;

        processId = unchecked((int)nativeProcessId);
        return true;
    }

    public bool TryGetProcessIdentity(int processId, out VisioProcessIdentity processIdentity)
    {
        processIdentity = default;
        if (processId <= 0) return false;

        try
        {
            using var process = Process.GetProcessById(processId);
            var processName = process.ProcessName;
            if (string.IsNullOrWhiteSpace(processName)) return false;
            var executableName = Path.HasExtension(processName) ? processName : processName + ".EXE";
            processIdentity = new VisioProcessIdentity(executableName, process.StartTime.ToUniversalTime());
            return true;
        }
        catch
        {
            return false;
        }
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(nint windowHandle, out uint processId);
}
