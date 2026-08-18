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
    void SaveAs(VisioSessionDocument document, string temporaryPath, string finalPath);
    void Close(VisioSessionDocument document);
    VisioSessionDocument Recover(VisioSessionKey sessionKey, string outputPath);
}

/// <summary>
/// Runs the fixed reusable-session operation set on one COM STA runner. The contract tests use a
/// recording <see cref="IVisioComSessionOperations"/> implementation; they prove session boundaries,
/// STA serialization, and path policy only. They do not prove Microsoft Visio is installed, that COM
/// drawing succeeds, or that a VSDX can be saved and read back on a real Windows host.
/// </summary>
public sealed class VisioComSessionBackend : IVisioSessionBackend, IAsyncDisposable
{
    private readonly VisioComEngineOptions _options;
    private readonly IVisioComSessionOperations _operations;
    private readonly ComStaRunner _runner;

    public VisioComSessionBackend(VisioComEngineOptions options, IVisioComSessionOperations operations)
    {
        _options = options;
        _operations = operations ?? throw new ArgumentNullException(nameof(operations));
        _runner = new ComStaRunner();
    }

    public string NormalizeOutputPath(string outputPath) => PathPolicy.ValidateOutputPath(outputPath, _options.OutputRoot);

    public Task<VisioSessionDocument> OpenOrCreateAsync(VisioSessionKey sessionKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(sessionKey);
        return InvokeAsync(() => _operations.OpenOrCreate(sessionKey), cancellationToken);
    }

    public Task ApplyPlanAsync(VisioSessionDocument document, DiagramDocument plan, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(plan);
        return InvokeAsync(() => _operations.ApplyPlan(document, plan), cancellationToken);
    }

    public Task ApplyPlanDiffAsync(VisioSessionDocument document, DiagramDocument plan, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(plan);
        return InvokeAsync(() => _operations.ApplyPlanDiff(document, plan), cancellationToken);
    }

    public async Task SaveAsAsync(VisioSessionDocument document, string outputPath, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(document);
        var finalPath = NormalizeOutputPath(outputPath);
        Directory.CreateDirectory(Path.GetDirectoryName(finalPath)!);
        var temporaryPath = finalPath + $".{Guid.NewGuid():N}.partial.vsdx";
        try
        {
            await InvokeAsync(() => _operations.SaveAs(document, temporaryPath, finalPath), cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            TryDelete(temporaryPath);
        }
    }

    public Task CloseAsync(VisioSessionDocument document, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(document);
        return InvokeAsync(() => _operations.Close(document), cancellationToken);
    }

    public Task<VisioSessionDocument> RecoverAsync(VisioSessionKey sessionKey, string outputPath, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(sessionKey);
        var finalPath = NormalizeOutputPath(outputPath);
        return InvokeAsync(() => _operations.Recover(sessionKey, finalPath), cancellationToken);
    }

    public ValueTask DisposeAsync() => _runner.DisposeAsync();

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
