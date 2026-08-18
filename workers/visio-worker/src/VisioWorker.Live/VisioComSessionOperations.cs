using System.Runtime.InteropServices;
using VisioWorker.Core;

namespace VisioWorker.Live;

/// <summary>
/// The small native surface used by the reusable session adapter. It is intentionally limited to
/// document/page lifecycle and semantic-shape reconciliation; callers cannot pass arbitrary COM
/// member names, scripts, VBA, or desktop commands through this interface.
/// </summary>
public interface IVisioComSessionNative
{
    VisioSessionDocument OpenOrCreate(VisioSessionKey sessionKey);
    void ReplaceOwnedShapes(VisioSessionDocument document, string ownershipMarker, DiagramDocument plan);
    void SaveAs(VisioSessionDocument document, string temporaryPath, string finalPath);
    void Close(VisioSessionDocument document);
    VisioSessionDocument Recover(VisioSessionKey sessionKey, string outputPath);
}

/// <summary>
/// Tracks which semantic shapes belong to each live session. A plan increment is reconciled on the
/// same page by removing only shapes durably marked as owned by that session, then drawing the
/// current allowlisted plan. This deliberately preserves user shapes and never creates another
/// document or page for an already open session.
/// </summary>
public sealed class VisioComSessionOperations : IVisioComSessionOperations, IDisposable
{
    private readonly IVisioComSessionNative _native;
    private readonly Dictionary<VisioSessionKey, ActiveSession> _sessions = [];
    private readonly Dictionary<string, VisioSessionKey> _keysByDocumentHandle = new(StringComparer.Ordinal);
    private bool _disposed;

    public VisioComSessionOperations(IVisioComSessionNative native)
    {
        _native = native ?? throw new ArgumentNullException(nameof(native));
    }

    public VisioSessionDocument OpenOrCreate(VisioSessionKey sessionKey)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(sessionKey);
        if (_sessions.TryGetValue(sessionKey, out var existing)) return existing.Document;

        var document = _native.OpenOrCreate(sessionKey);
        Register(sessionKey, document);
        return document;
    }

    public void ApplyPlan(VisioSessionDocument document, DiagramDocument plan) => ReplacePlan(document, plan);

    public void ApplyPlanDiff(VisioSessionDocument document, DiagramDocument plan) => ReplacePlan(document, plan);

    public void SaveAs(VisioSessionDocument document, string temporaryPath, string finalPath)
    {
        ThrowIfDisposed();
        var session = RequireSession(document);
        _native.SaveAs(session.Document, temporaryPath, finalPath);
    }

    public void Close(VisioSessionDocument document)
    {
        ThrowIfDisposed();
        var session = RequireSession(document);
        _native.Close(session.Document);
        _sessions.Remove(session.Key);
        _keysByDocumentHandle.Remove(session.Document.DocumentHandle);
    }

    public VisioSessionDocument Recover(VisioSessionKey sessionKey, string outputPath)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(sessionKey);
        if (_sessions.ContainsKey(sessionKey))
        {
            throw new InvalidOperationException("An open Visio session cannot be replaced through recovery.");
        }

        var document = _native.Recover(sessionKey, outputPath);
        Register(sessionKey, document);
        return document;
    }

    public void Dispose()
    {
        if (_disposed) return;
        foreach (var session in _sessions.Values.ToArray())
        {
            try { _native.Close(session.Document); }
            catch { }
        }
        _sessions.Clear();
        _keysByDocumentHandle.Clear();
        if (_native is IDisposable disposable) disposable.Dispose();
        _disposed = true;
    }

    private void ReplacePlan(VisioSessionDocument document, DiagramDocument plan)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(plan);
        var session = RequireSession(document);
        _native.ReplaceOwnedShapes(session.Document, OwnershipMarker.For(session.Key), plan);
    }

    private void Register(VisioSessionKey key, VisioSessionDocument document)
    {
        if (_keysByDocumentHandle.TryGetValue(document.DocumentHandle, out var existingKey) && existingKey != key)
        {
            throw new InvalidOperationException("The native backend returned one document handle for different Visio sessions.");
        }

        _sessions.Add(key, new ActiveSession(key, document));
        _keysByDocumentHandle.Add(document.DocumentHandle, key);
    }

    private ActiveSession RequireSession(VisioSessionDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);
        if (!_keysByDocumentHandle.TryGetValue(document.DocumentHandle, out var key)
            || !_sessions.TryGetValue(key, out var session)
            || session.Document != document)
        {
            throw new InvalidOperationException("The supplied Visio document handle is not open in this session adapter.");
        }

        return session;
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }

    private sealed class ActiveSession(VisioSessionKey key, VisioSessionDocument document)
    {
        public VisioSessionKey Key { get; } = key;
        public VisioSessionDocument Document { get; } = document;
    }
}

internal static class OwnershipMarker
{
    public const string ShapeDataKey = "synapse.sessionOwner";

    public static string For(VisioSessionKey key)
    {
        ArgumentNullException.ThrowIfNull(key);
        var identity = string.Join("\n", key.TenantId, key.UserId, key.DeviceId, key.WorkflowId);
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(identity)));
    }
}

/// <summary>
/// Owns the actual dynamic COM references for all sessions created by one adapter instance. The
/// surrounding <see cref="VisioComSessionBackend"/> invokes every method on its single STA runner.
/// </summary>
internal sealed class VisioComSessionNative : IVisioComSessionNative, IDisposable
{
    private readonly VisioComEngineOptions _options;
    private readonly Dictionary<string, NativeDocument> _documents = new(StringComparer.Ordinal);
    private dynamic? _app;
    private dynamic? _documentsCollection;
    private bool _launched;
    private bool _disposed;

    public VisioComSessionNative(VisioComEngineOptions options)
    {
        _options = options;
    }

    public VisioSessionDocument OpenOrCreate(VisioSessionKey sessionKey)
    {
        ThrowIfDisposed();
        EnsureApplication();
        dynamic document = _documentsCollection!.Add("");
        dynamic page = document.Pages.Item(1);
        var handle = "visio-document-" + Guid.NewGuid().ToString("N");
        var result = new VisioSessionDocument(handle, "visio-page-" + Guid.NewGuid().ToString("N"));
        _documents.Add(handle, new NativeDocument(result, document, page));
        return result;
    }

    public void ReplaceOwnedShapes(VisioSessionDocument document, string ownershipMarker, DiagramDocument plan)
    {
        ThrowIfDisposed();
        var native = RequireDocument(document);
        ArgumentException.ThrowIfNullOrWhiteSpace(ownershipMarker);
        DeleteOwnedShapes(native.Page, ownershipMarker);
        var existingShapeIds = ReadShapeIds(native.Page);
        VisioComEngine.ConfigureAndDrawDocument(native.Page, plan);
        TagNewShapes(native.Page, existingShapeIds, ownershipMarker);
    }

    public void SaveAs(VisioSessionDocument document, string temporaryPath, string finalPath)
    {
        ThrowIfDisposed();
        var native = RequireDocument(document);
        native.Document.SaveAs(temporaryPath);
        native.Document.Close();
        VisioComEngine.ReleaseCom(native.Page);
        VisioComEngine.ReleaseCom(native.Document);
        File.Move(temporaryPath, finalPath, overwrite: true);
        dynamic reopened = _documentsCollection!.Open(finalPath);
        dynamic page = reopened.Pages.Item(1);
        native.Document = reopened;
        native.Page = page;
    }

    public void Close(VisioSessionDocument document)
    {
        if (_disposed) return;
        var native = RequireDocument(document);
        if (VisioDocumentLifecycle.ShouldDiscardUnsavedChangesOnExplicitClose()) native.Document.Saved = true;
        native.Document.Close();
        _documents.Remove(document.DocumentHandle);
        VisioComEngine.ReleaseCom(native.Page);
        VisioComEngine.ReleaseCom(native.Document);
        ReleaseApplicationIfIdle();
    }

    public VisioSessionDocument Recover(VisioSessionKey sessionKey, string outputPath)
    {
        ThrowIfDisposed();
        EnsureApplication();
        dynamic document = _documentsCollection!.Open(outputPath);
        dynamic page = document.Pages.Item(1);
        var result = new VisioSessionDocument("visio-document-" + Guid.NewGuid().ToString("N"), "visio-page-" + Guid.NewGuid().ToString("N"));
        _documents.Add(result.DocumentHandle, new NativeDocument(result, document, page));
        return result;
    }

    public void Dispose()
    {
        if (_disposed) return;
        foreach (var document in _documents.Values.ToArray())
        {
            VisioComEngine.TryClose(document.Document);
            VisioComEngine.ReleaseCom(document.Page);
            VisioComEngine.ReleaseCom(document.Document);
        }
        _documents.Clear();
        QuitLaunchedApplication();
        VisioComEngine.ReleaseCom(_documentsCollection);
        VisioComEngine.ReleaseCom(_app);
        _documentsCollection = null;
        _app = null;
        _disposed = true;
    }

    private void EnsureApplication()
    {
        if (_app is not null) return;
        _app = VisioComEngine.ConnectVisio(_options, out _launched);
        VisioComEngine.TrySet(() => _app.Visible = _options.Visible);
        VisioComEngine.TrySet(() => _app.AlertResponse = 1);
        _documentsCollection = _app.Documents;
    }

    private NativeDocument RequireDocument(VisioSessionDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);
        if (!_documents.TryGetValue(document.DocumentHandle, out var native) || native.SessionDocument != document)
        {
            throw new InvalidOperationException("The supplied Visio document handle is not open in the COM session.");
        }
        return native;
    }

    private static void DeleteOwnedShapes(dynamic page, string ownershipMarker)
    {
        dynamic? shapes = null;
        try
        {
            shapes = page.Shapes;
            var count = Convert.ToInt32(shapes.Count, System.Globalization.CultureInfo.InvariantCulture);
            for (var index = count; index >= 1; index--)
            {
                dynamic? shape = null;
                try
                {
                    shape = shapes.Item(index);
                    if (string.Equals(VisioComEngine.ReadShapeDataOrNullStrict(shape, OwnershipMarker.ShapeDataKey), ownershipMarker, StringComparison.Ordinal))
                    {
                        shape.Delete();
                    }
                }
                finally
                {
                    VisioComEngine.ReleaseCom(shape);
                }
            }
        }
        finally
        {
            VisioComEngine.ReleaseCom(shapes);
        }

        if (CountOwnedShapes(page, ownershipMarker) != 0)
        {
            throw new WorkerProtocolException("Visio session reconciliation could not remove every previously owned shape.");
        }
    }

    private static int CountOwnedShapes(dynamic page, string ownershipMarker)
    {
        dynamic? shapes = null;
        try
        {
            shapes = page.Shapes;
            var count = Convert.ToInt32(shapes.Count, System.Globalization.CultureInfo.InvariantCulture);
            var owned = 0;
            for (var index = 1; index <= count; index++)
            {
                dynamic? shape = null;
                try
                {
                    shape = shapes.Item(index);
                    if (string.Equals(VisioComEngine.ReadShapeDataOrNullStrict(shape, OwnershipMarker.ShapeDataKey), ownershipMarker, StringComparison.Ordinal)) owned++;
                }
                finally
                {
                    VisioComEngine.ReleaseCom(shape);
                }
            }
            return owned;
        }
        finally
        {
            VisioComEngine.ReleaseCom(shapes);
        }
    }

    private static HashSet<int> ReadShapeIds(dynamic page)
    {
        var result = new HashSet<int>();
        foreach (dynamic shape in page.Shapes)
        {
            try { result.Add(Convert.ToInt32(shape.ID, System.Globalization.CultureInfo.InvariantCulture)); }
            finally { VisioComEngine.ReleaseCom(shape); }
        }
        return result;
    }

    private static void TagNewShapes(dynamic page, IReadOnlySet<int> existingShapeIds, string ownershipMarker)
    {
        foreach (dynamic shape in page.Shapes)
        {
            try
            {
                var id = Convert.ToInt32(shape.ID, System.Globalization.CultureInfo.InvariantCulture);
                if (!existingShapeIds.Contains(id))
                {
                    VisioComEngine.SetRequiredShapeData(shape, OwnershipMarker.ShapeDataKey, ownershipMarker);
                    if (!string.Equals(VisioComEngine.ReadShapeDataOrNullStrict(shape, OwnershipMarker.ShapeDataKey), ownershipMarker, StringComparison.Ordinal))
                    {
                        throw new WorkerProtocolException("Visio session ownership marker was not persisted on a created shape.");
                    }
                }
            }
            finally
            {
                VisioComEngine.ReleaseCom(shape);
            }
        }
    }

    private void ReleaseApplicationIfIdle()
    {
        if (_documents.Count != 0) return;
        QuitLaunchedApplication();
        VisioComEngine.ReleaseCom(_documentsCollection);
        VisioComEngine.ReleaseCom(_app);
        _documentsCollection = null;
        _app = null;
        _launched = false;
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }

    private void QuitLaunchedApplication()
    {
        if (!_launched || _app is null) return;
        try
        {
            _app.Quit();
        }
        catch (Exception error)
        {
            throw new WorkerProtocolException($"Visio application quit failed: {error.Message}", error);
        }
    }

    private sealed class NativeDocument(VisioSessionDocument sessionDocument, dynamic document, dynamic page)
    {
        public VisioSessionDocument SessionDocument { get; } = sessionDocument;
        public dynamic Document { get; set; } = document;
        public dynamic Page { get; set; } = page;
    }
}
