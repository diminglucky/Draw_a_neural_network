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
    VisioSessionDocument SaveAs(VisioSessionDocument document, string temporaryPath, string finalPath, Action originalClosed);
    void Close(VisioSessionDocument document);
    VisioSessionDocument Recover(VisioSessionKey sessionKey, VisioSessionRecoveryManifest manifest);
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

    public VisioSessionDocument SaveAs(VisioSessionDocument document, string temporaryPath, string finalPath)
    {
        ThrowIfDisposed();
        var session = RequireSession(document);
        var saved = _native.SaveAs(session.Document, temporaryPath, finalPath, () => RemoveRegistration(session));
        Register(session.Key, saved);
        return saved;
    }

    public void Close(VisioSessionDocument document)
    {
        ThrowIfDisposed();
        var session = RequireSession(document);
        _native.Close(session.Document);
        _sessions.Remove(session.Key);
        _keysByDocumentHandle.Remove(session.Document.DocumentHandle);
    }

    public VisioSessionDocument Recover(VisioSessionKey sessionKey, VisioSessionRecoveryManifest manifest)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(sessionKey);
        if (_sessions.ContainsKey(sessionKey))
        {
            throw new InvalidOperationException("An open Visio session cannot be replaced through recovery.");
        }

        var document = _native.Recover(sessionKey, manifest);
        Register(sessionKey, document);
        return document;
    }

    public void Dispose()
    {
        if (_disposed) return;
        var failures = new List<Exception>();
        foreach (var session in _sessions.Values.ToArray())
        {
            try
            {
                _native.Close(session.Document);
                RemoveRegistration(session);
            }
            catch (Exception error)
            {
                failures.Add(new InvalidOperationException(
                    "A native Visio session could not be closed during adapter disposal.",
                    error));
            }
        }

        if (failures.Count != 0)
        {
            throw new AggregateException("One or more native Visio sessions could not be released.", failures);
        }

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

    private void RemoveRegistration(ActiveSession session)
    {
        _sessions.Remove(session.Key);
        _keysByDocumentHandle.Remove(session.Document.DocumentHandle);
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

internal static class NativeIdentity
{
    public const string DocumentShapeDataKey = "synapse.workerDocumentIdentity";
    public const string PageShapeDataKey = "synapse.workerPageIdentity";
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
        dynamic? document = null;
        dynamic? page = null;
        Exception? primaryFailure = null;
        try
        {
            document = _documentsCollection!.Add("");
            page = document.Pages.Item(1);
            var result = CreateWorkerOwnedIdentity(document, page);
            _documents.Add(result.DocumentHandle, new NativeDocument(result, document, page));
            document = null;
            page = null;
            return result;
        }
        catch (Exception error)
        {
            primaryFailure = error;
            throw;
        }
        finally
        {
            if (document is not null)
            {
                CloseUnexpectedDocument(document, page, primaryFailure, "Visio document creation cleanup failed.");
            }
        }
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

    public VisioSessionDocument SaveAs(VisioSessionDocument document, string temporaryPath, string finalPath, Action originalClosed)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(originalClosed);
        var native = RequireDocument(document);
        RequireNativeIdentity(document);
        native.Document.SaveAs(temporaryPath);
        native.Document.Close();
        _documents.Remove(document.DocumentHandle);
        originalClosed();
        VisioComEngine.ReleaseCom(native.Page);
        VisioComEngine.ReleaseCom(native.Document);
        File.Move(temporaryPath, finalPath, overwrite: true);
        dynamic? reopened = null;
        dynamic? page = null;
        Exception? primaryFailure = null;
        try
        {
            reopened = _documentsCollection!.Open(finalPath);
            VerifyDocumentPathAndIdentity(reopened, document, finalPath);
            page = FindExpectedPage(reopened, document);
            var saved = StableDocumentIdentity(finalPath, page, document.NativeDocumentIdentity!, document.NativePageIdentity!);
            if (!string.Equals(saved.NativeDocumentIdentity, document.NativeDocumentIdentity, StringComparison.Ordinal)
                || !string.Equals(saved.NativePageIdentity, document.NativePageIdentity, StringComparison.Ordinal))
            {
                throw new WorkerProtocolException("Saved Visio document/page identity does not match the live session.");
            }
            _documents.Remove(document.DocumentHandle);
            _documents.Add(saved.DocumentHandle, new NativeDocument(saved, reopened, page));
            reopened = null;
            page = null;
            return saved;
        }
        catch (Exception error)
        {
            primaryFailure = error;
            throw;
        }
        finally
        {
            if (reopened is not null)
            {
                CloseUnexpectedDocument(reopened, page, primaryFailure, "Saved Visio document cleanup failed.");
            }
        }
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

    public VisioSessionDocument Recover(VisioSessionKey sessionKey, VisioSessionRecoveryManifest manifest)
    {
        ThrowIfDisposed();
        RequireNativeIdentity(manifest.Document);
        EnsureApplication();
        dynamic? document = null;
        dynamic? page = null;
        Exception? primaryFailure = null;
        try
        {
            document = _documentsCollection!.Open(manifest.OutputPath);
            VerifyDocumentPathAndIdentity(document, manifest.Document, manifest.OutputPath);
            page = FindExpectedPage(document, manifest.Document);
            var result = StableDocumentIdentity(
                manifest.OutputPath,
                page,
                manifest.Document.NativeDocumentIdentity!,
                manifest.Document.NativePageIdentity!);
            if (result != manifest.Document) throw new WorkerProtocolException("Recovered Visio document/page identity does not match the recovery manifest.");
            _documents.Add(result.DocumentHandle, new NativeDocument(result, document, page));
            document = null;
            page = null;
            return result;
        }
        catch (Exception error)
        {
            primaryFailure = error;
            throw;
        }
        finally
        {
            if (document is not null)
            {
                CloseUnexpectedDocument(document, page, primaryFailure, "Unexpected recovered Visio document cleanup failed.");
            }
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        var failures = new List<Exception>();
        foreach (var document in _documents.Values.ToArray())
        {
            try
            {
                if (VisioDocumentLifecycle.ShouldDiscardUnsavedChangesOnExplicitClose()) document.Document.Saved = true;
                document.Document.Close();
                _documents.Remove(document.SessionDocument.DocumentHandle);
                VisioComEngine.ReleaseCom(document.Page);
                VisioComEngine.ReleaseCom(document.Document);
            }
            catch (Exception error)
            {
                failures.Add(new WorkerProtocolException("Native Visio document close failed during disposal.", error));
            }
        }
        if (failures.Count != 0)
        {
            throw new AggregateException("One or more native Visio documents could not be closed during disposal.", failures);
        }
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

    private static VisioSessionDocument CreateWorkerOwnedIdentity(dynamic document, dynamic page)
    {
        var documentIdentity = Guid.NewGuid().ToString("N");
        var pageIdentity = Guid.NewGuid().ToString("N");
        WriteDocumentIdentity(document, documentIdentity);
        WritePageIdentity(page, pageIdentity);
        return new VisioSessionDocument(
            "visio-document-" + Guid.NewGuid().ToString("N"),
            "visio-page-" + Guid.NewGuid().ToString("N"),
            documentIdentity,
            pageIdentity);
    }

    private static VisioSessionDocument StableDocumentIdentity(
        string outputPath,
        dynamic page,
        string nativeDocumentIdentity,
        string nativePageIdentity)
    {
        var normalizedPath = Path.GetFullPath(outputPath);
        var pageId = Convert.ToInt32(page.ID, System.Globalization.CultureInfo.InvariantCulture);
        var documentHandle = "visio-vsdx-" + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(normalizedPath))).ToLowerInvariant();
        return new VisioSessionDocument(
            documentHandle,
            documentHandle + "-page-" + pageId.ToString(System.Globalization.CultureInfo.InvariantCulture),
            nativeDocumentIdentity,
            nativePageIdentity);
    }

    private static dynamic FindExpectedPage(dynamic document, VisioSessionDocument expected)
    {
        dynamic? matched = null;
        dynamic? pages = null;
        try
        {
            pages = document.Pages;
            var count = Convert.ToInt32(pages.Count, System.Globalization.CultureInfo.InvariantCulture);
            for (var index = 1; index <= count; index++)
            {
                dynamic? candidate = null;
                try
                {
                    candidate = pages.Item(index);
                    var candidateIdentity = ReadPageIdentityOrNull(candidate);
                    if (candidateIdentity is not null
                        && string.Equals(candidateIdentity, expected.NativePageIdentity, StringComparison.Ordinal))
                    {
                        if (matched is not null)
                        {
                            VisioComEngine.ReleaseCom(matched);
                            matched = null;
                            throw new WorkerProtocolException("Recovered Visio VSDX contains more than one page with the manifest page identity.");
                        }
                        matched = candidate;
                        candidate = null;
                    }
                }
                finally
                {
                    VisioComEngine.ReleaseCom(candidate);
                }
            }
        }
        finally
        {
            VisioComEngine.ReleaseCom(pages);
        }

        return matched ?? throw new WorkerProtocolException("Recovered Visio VSDX does not contain the manifest page identity.");
    }

    private static void VerifyDocumentPathAndIdentity(dynamic document, VisioSessionDocument expected, string expectedPath)
    {
        var normalizedExpected = Path.GetFullPath(expectedPath);
        var fullName = Convert.ToString(document.FullName, System.Globalization.CultureInfo.InvariantCulture);
        if (string.IsNullOrWhiteSpace(fullName)
            || !string.Equals(Path.GetFullPath(fullName), normalizedExpected, StringComparison.OrdinalIgnoreCase))
        {
            throw new WorkerProtocolException("Recovered Visio document path does not match the recovery manifest.");
        }

        if (!string.Equals(ReadDocumentIdentity(document), expected.NativeDocumentIdentity, StringComparison.Ordinal))
        {
            throw new WorkerProtocolException("Recovered Visio document identity does not match the recovery manifest.");
        }
    }

    private static void WriteDocumentIdentity(dynamic document, string identity)
    {
        dynamic? documentSheet = null;
        try
        {
            documentSheet = document.DocumentSheet;
            WriteAndVerifyIdentity(documentSheet, NativeIdentity.DocumentShapeDataKey, identity);
        }
        finally
        {
            VisioComEngine.ReleaseCom(documentSheet);
        }
    }

    private static void WritePageIdentity(dynamic page, string identity)
    {
        dynamic? pageSheet = null;
        try
        {
            pageSheet = page.PageSheet;
            WriteAndVerifyIdentity(pageSheet, NativeIdentity.PageShapeDataKey, identity);
        }
        finally
        {
            VisioComEngine.ReleaseCom(pageSheet);
        }
    }

    private static string ReadDocumentIdentity(dynamic document)
    {
        dynamic? documentSheet = null;
        try
        {
            documentSheet = document.DocumentSheet;
            return ReadRequiredIdentity(documentSheet, NativeIdentity.DocumentShapeDataKey);
        }
        finally
        {
            VisioComEngine.ReleaseCom(documentSheet);
        }
    }

    private static string? ReadPageIdentityOrNull(dynamic page)
    {
        dynamic? pageSheet = null;
        try
        {
            pageSheet = page.PageSheet;
            return ReadIdentityOrNull(pageSheet, NativeIdentity.PageShapeDataKey);
        }
        finally
        {
            VisioComEngine.ReleaseCom(pageSheet);
        }
    }

    private static void WriteAndVerifyIdentity(dynamic shapeSheet, string key, string identity)
    {
        VisioComEngine.SetRequiredShapeData(shapeSheet, key, identity);
        if (!string.Equals(ReadRequiredIdentity(shapeSheet, key), identity, StringComparison.Ordinal))
        {
            throw new WorkerProtocolException("Native Visio session identity was not persisted.");
        }
    }

    private static string ReadRequiredIdentity(dynamic shapeSheet, string key)
    {
        string? identity = VisioComEngine.ReadShapeDataOrNullStrict((object)shapeSheet, key);
        return identity is null
            ? throw new WorkerProtocolException("Native Visio session identity is missing or invalid.")
            : ValidateIdentity(identity);
    }

    private static string? ReadIdentityOrNull(dynamic shapeSheet, string key)
    {
        var identity = VisioComEngine.ReadShapeDataOrNullStrict((object)shapeSheet, key);
        return identity is null ? null : ValidateIdentity(identity);
    }

    private static string ValidateIdentity(string identity)
    {
        if (identity is null || identity.Length != 32 || !identity.All(Uri.IsHexDigit))
        {
            throw new WorkerProtocolException("Native Visio session identity is missing or invalid.");
        }
        return identity.ToLowerInvariant();
    }

    private static void RequireNativeIdentity(VisioSessionDocument document)
    {
        if (!document.HasNativeIdentity)
        {
            throw new WorkerProtocolException("Recovery requires native Visio document and page identities.");
        }
    }

    private static void CloseUnexpectedDocument(
        dynamic document,
        dynamic? page,
        Exception? primaryFailure,
        string message)
    {
        Exception? closeFailure = null;
        try
        {
            document.Close();
        }
        catch (Exception error)
        {
            closeFailure = new WorkerProtocolException(message, error);
        }
        finally
        {
            VisioComEngine.ReleaseCom(page);
            VisioComEngine.ReleaseCom(document);
        }

        if (closeFailure is not null)
        {
            throw primaryFailure is null
                ? closeFailure
                : new WorkerProtocolException(message, new AggregateException(primaryFailure, closeFailure));
        }
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
        if (_launched && _app is not null) VisioComEngine.TrySet(() => _app.Quit());
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
