using VisioWorker.Core;

namespace VisioWorker.Live;

/// <summary>
/// Fixed, typed native operations available to a reusable Visio session. This deliberately has no
/// generic COM method, script, VBA, shell, or command-string entrypoint. A future COM implementation
/// owns opaque document/page handles and must create/update named shapes only through these operations.
/// </summary>
public interface IVisioComSessionOperations
{
    VisioSessionDocument OpenOrCreate(VisioSessionKey sessionKey);
    void ApplyPlan(VisioSessionDocument document, DiagramDocument plan);
    void ApplyPlanDiff(VisioSessionDocument document, DiagramDocument plan);
    ReadbackResult Readback(VisioSessionDocument document, DiagramDocument plan);
    VisioSessionDocument SaveAs(VisioSessionDocument document, string temporaryPath, string finalPath);
    void Close(VisioSessionDocument document);
    VisioSessionDocument Recover(VisioSessionKey sessionKey, VisioSessionRecoveryManifest manifest);
}

/// <summary>
/// Runs the fixed reusable-session operation set on one COM STA runner. The contract tests use a
/// recording <see cref="IVisioComSessionOperations"/> implementation; they prove session boundaries,
/// STA serialization, and path policy only. They do not prove Microsoft Visio is installed, that COM
/// drawing succeeds, or that a VSDX can be saved and read back on a real Windows host.
/// </summary>
public sealed class VisioComSessionBackend : IVisioSessionBackend, IVisioSessionReadbackBackend, IAsyncDisposable
{
    private readonly VisioComEngineOptions _options;
    private readonly IVisioComSessionOperations _operations;
    private readonly ComStaRunner _runner;
    private readonly bool _ownsRunner;
    private int _disposeState;

    public VisioComSessionBackend(VisioComEngineOptions options, IVisioComSessionOperations operations)
        : this(options, operations, new ComStaRunner(), ownsRunner: true)
    {
    }

    internal VisioComSessionBackend(
        VisioComEngineOptions options,
        IVisioComSessionOperations operations,
        ComStaRunner runner,
        bool ownsRunner)
    {
        _options = options;
        _operations = operations ?? throw new ArgumentNullException(nameof(operations));
        _runner = runner ?? throw new ArgumentNullException(nameof(runner));
        _ownsRunner = ownsRunner;
    }

    public string NormalizeOutputPath(string outputPath)
    {
        ThrowIfDisposed();
        return PathPolicy.ValidateOutputPath(outputPath, _options.OutputRoot);
    }

    public Task<VisioSessionDocument> OpenOrCreateAsync(VisioSessionKey sessionKey, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(sessionKey);
        return InvokeAsync(() => _operations.OpenOrCreate(sessionKey), cancellationToken);
    }

    public Task ApplyPlanAsync(VisioSessionDocument document, DiagramDocument plan, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(plan);
        return InvokeAsync(() => _operations.ApplyPlan(document, plan), cancellationToken);
    }

    public Task ApplyPlanDiffAsync(VisioSessionDocument document, DiagramDocument plan, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(plan);
        return InvokeAsync(() => _operations.ApplyPlanDiff(document, plan), cancellationToken);
    }

    public Task<ReadbackResult> ReadbackAsync(VisioSessionDocument document, DiagramDocument plan, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(plan);
        return InvokeAsync(() => _operations.Readback(document, plan), cancellationToken);
    }

    public async Task<VisioSessionDocument> SaveAsAsync(VisioSessionDocument document, string outputPath, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(document);
        var finalPath = NormalizeOutputPath(outputPath);
        Directory.CreateDirectory(Path.GetDirectoryName(finalPath)!);
        var temporaryPath = finalPath + $".{Guid.NewGuid():N}.partial.vsdx";
        try
        {
            return await InvokeAsync(() => _operations.SaveAs(document, temporaryPath, finalPath), cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            TryDelete(temporaryPath);
        }
    }

    public Task CloseAsync(VisioSessionDocument document, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(document);
        return InvokeAsync(() => _operations.Close(document), cancellationToken);
    }

    public Task<VisioSessionDocument> RecoverAsync(VisioSessionKey sessionKey, VisioSessionRecoveryManifest manifest, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(sessionKey);
        ArgumentNullException.ThrowIfNull(manifest);
        if (manifest.Key != sessionKey) throw new WorkerProtocolException("Recovery manifest session does not match the requested session.");
        _ = NormalizeOutputPath(manifest.OutputPath);
        return InvokeAsync(() => _operations.Recover(sessionKey, manifest), cancellationToken);
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.CompareExchange(ref _disposeState, 1, 0) != 0) return;
        try
        {
            await _runner.InvokeAsync(() =>
            {
                if (_operations is IDisposable disposable) disposable.Dispose();
                return true;
            }).ConfigureAwait(false);
        }
        catch
        {
            Volatile.Write(ref _disposeState, 0);
            throw;
        }

        try
        {
            if (_ownsRunner) await _runner.DisposeAsync().ConfigureAwait(false);
        }
        finally
        {
            Volatile.Write(ref _disposeState, 2);
        }
    }

    private async Task InvokeAsync(Action action, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        await _runner.InvokeAsync(() =>
        {
            action();
            return true;
        }).ConfigureAwait(false);
    }

    private Task<T> InvokeAsync<T>(Func<T> action, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return _runner.InvokeAsync(action);
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposeState) != 0, this);
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch
        {
            // A failed cleanup must not conceal the original native operation result.
        }
    }
}
