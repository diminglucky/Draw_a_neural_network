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

internal interface IVisioProcessExitAdapter
{
    bool WaitForExit(int processId, TimeSpan timeout);

    void TerminateProcess(int processId);
}

internal interface IVisioApplicationExitAdapter
{
    void RequestQuit(object application);
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

internal sealed class OwnedVisioApplicationExit
{
    private readonly IVisioProcessWindowAdapter _processWindowAdapter;
    private readonly IVisioProcessExitAdapter _processExitAdapter;
    private readonly IVisioApplicationExitAdapter _applicationExitAdapter;
    private readonly TimeSpan _exitTimeout;
    private bool _quitRequested;
    private bool _completed;

    internal OwnedVisioApplicationExit(
        OwnedVisioApplicationLease lease,
        IVisioProcessWindowAdapter processWindowAdapter,
        IVisioProcessExitAdapter processExitAdapter,
        IVisioApplicationExitAdapter applicationExitAdapter,
        TimeSpan exitTimeout)
    {
        Lease = lease ?? throw new ArgumentNullException(nameof(lease));
        _processWindowAdapter = processWindowAdapter ?? throw new ArgumentNullException(nameof(processWindowAdapter));
        _processExitAdapter = processExitAdapter ?? throw new ArgumentNullException(nameof(processExitAdapter));
        _applicationExitAdapter = applicationExitAdapter ?? throw new ArgumentNullException(nameof(applicationExitAdapter));
        if (exitTimeout <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(exitTimeout));
        _exitTimeout = exitTimeout;
    }

    internal OwnedVisioApplicationLease Lease { get; }

    internal static OwnedVisioApplicationExit? RequireForShutdown(
        bool workerCreatedApplication,
        OwnedVisioApplicationExit? ownedExit)
    {
        if (!workerCreatedApplication) return null;
        return ownedExit ?? throw new WorkerProtocolException(
            "Worker-created Visio application has no verified owned Visio process lease; COM Quit and process termination were not attempted.");
    }

    internal void RequestQuit(object application)
    {
        ArgumentNullException.ThrowIfNull(application);
        if (_quitRequested) return;
        if (!Lease.MatchesCurrentProcess(_processWindowAdapter))
        {
            throw new WorkerProtocolException(
                "The owned Visio process no longer matches its verified lease; COM Quit was not attempted.");
        }

        try
        {
            _applicationExitAdapter.RequestQuit(application);
            _quitRequested = true;
        }
        catch (Exception error)
        {
            throw new WorkerProtocolException($"Visio application quit failed: {error.Message}", error);
        }
    }

    internal void WaitForExitOrTerminate()
    {
        if (_completed) return;
        if (!_quitRequested)
        {
            throw new InvalidOperationException("COM Quit must be requested before waiting for the owned Visio process to exit.");
        }

        if (WaitForExit())
        {
            _completed = true;
            return;
        }

        if (!Lease.MatchesCurrentProcess(_processWindowAdapter))
        {
            throw new WorkerProtocolException(
                "The owned Visio process no longer matches its verified lease; exact-PID termination was not attempted.");
        }

        try
        {
            _processExitAdapter.TerminateProcess(Lease.ProcessId);
        }
        catch (Exception error)
        {
            throw new WorkerProtocolException(
                $"Terminating the exact owned Visio process failed: {error.Message}",
                error);
        }

        if (!WaitForExit())
        {
            throw new WorkerProtocolException("The exact owned Visio process did not exit after termination was requested.");
        }

        _completed = true;
    }

    private bool WaitForExit()
    {
        try
        {
            return _processExitAdapter.WaitForExit(Lease.ProcessId, _exitTimeout);
        }
        catch (Exception error)
        {
            throw new WorkerProtocolException(
                $"Waiting for the exact owned Visio process to exit failed: {error.Message}",
                error);
        }
    }
}

internal sealed class ComVisioApplicationExitAdapter : IVisioApplicationExitAdapter
{
    public void RequestQuit(object application)
    {
        ArgumentNullException.ThrowIfNull(application);
        dynamic visioApplication = application;
        visioApplication.Quit();
    }
}

internal sealed class WindowsVisioProcessWindowAdapter : IVisioProcessWindowAdapter, IVisioProcessExitAdapter
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

    public bool WaitForExit(int processId, TimeSpan timeout)
    {
        if (processId <= 0) throw new ArgumentOutOfRangeException(nameof(processId));
        if (timeout <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(timeout));

        try
        {
            using var process = Process.GetProcessById(processId);
            var timeoutMilliseconds = checked((int)Math.Ceiling(timeout.TotalMilliseconds));
            return process.WaitForExit(timeoutMilliseconds);
        }
        catch (ArgumentException)
        {
            return true;
        }
    }

    public void TerminateProcess(int processId)
    {
        if (processId <= 0) throw new ArgumentOutOfRangeException(nameof(processId));
        using var process = Process.GetProcessById(processId);
        process.Kill(entireProcessTree: false);
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(nint windowHandle, out uint processId);
}
