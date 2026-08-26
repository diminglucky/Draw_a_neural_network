using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using VisioWorker.Core;

namespace VisioWorker.Live;

/// <summary>
/// Fixed native operation set for a user-selected existing Visio page. It has no document/page
/// creation, opening-by-path, output-path, or SaveAs operation.
/// </summary>
internal interface ISelectedPageVisioComOperations
{
    void EnsureVisibleApplication();
    SelectedPageTarget? AttachActiveSelection();
    void RevalidateActiveSelection(SelectedPageTarget target);
    void BeginApply(SelectedPageTarget target);
    void BeginRead(SelectedPageTarget target);
    PreparedSelectedPageRegion PrepareOwnedRegion(SelectedPageTarget target, DiagramDocument plan);
    void ApplyOwnedRegion(SelectedPageTarget target, string ownershipNamespace, PreparedSelectedPageRegion preparedRegion);
    void SaveSelectedDocument(SelectedPageTarget target);
    SelectedPageReadback ReadSelectedPage(SelectedPageTarget target, string ownershipNamespace);
    void ReleaseSession(SelectedPageTarget target);
}

internal sealed class PreparedSelectedPageRegion
{
    internal PreparedSelectedPageRegion(SelectedPageTarget target, DiagramDocument plan)
    {
        ArgumentNullException.ThrowIfNull(target);
        ArgumentNullException.ThrowIfNull(plan);
        Target = target;
        Plan = plan;
    }

    internal SelectedPageTarget Target { get; }
    internal DiagramDocument Plan { get; }
}

/// <summary>
/// STA-confined implementation of <see cref="ISelectedPageSessionBackend"/>. It attaches only to
/// <c>Application.ActiveWindow.Page</c>; it never creates, opens, closes, or SaveAs-es a document.
/// </summary>
public sealed class SelectedPageVisioComBackend : ISelectedPageSessionBackend, IAsyncDisposable
{
    private readonly ISelectedPageVisioComOperations _operations;
    private readonly ComStaRunner _runner;
    private readonly bool _ownsRunner;
    private int _disposeState;

    public SelectedPageVisioComBackend(VisioComEngineOptions options)
        : this(new SelectedPageVisioComNative(options), new ComStaRunner(), ownsRunner: true)
    {
    }

    internal SelectedPageVisioComBackend(ISelectedPageVisioComOperations operations)
        : this(operations, new ComStaRunner(), ownsRunner: true)
    {
    }

    internal SelectedPageVisioComBackend(ISelectedPageVisioComOperations operations, ComStaRunner runner, bool ownsRunner)
    {
        _operations = operations ?? throw new ArgumentNullException(nameof(operations));
        _runner = runner ?? throw new ArgumentNullException(nameof(runner));
        _ownsRunner = ownsRunner;
    }

    public Task EnsureVisibleApplicationAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        return InvokeAsync(_operations.EnsureVisibleApplication, cancellationToken);
    }

    public Task<SelectedPageTarget?> AttachActiveSelectionAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        return InvokeAsync(_operations.AttachActiveSelection, cancellationToken);
    }

    public Task RevalidateAttachedTargetAsync(SelectedPageTarget target, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(target);
        return InvokeAsync(() => _operations.RevalidateActiveSelection(target), cancellationToken);
    }

    public Task BeginApplyAttemptAsync(SelectedPageTarget target)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(target);
        return _runner.InvokeAsync(() =>
        {
            _operations.BeginApply(target);
            return true;
        });
    }

    public Task BeginReadAttemptAsync(SelectedPageTarget target)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(target);
        return _runner.InvokeAsync(() =>
        {
            _operations.BeginRead(target);
            return true;
        });
    }

    public async Task ApplyOwnedRegionAsync(SelectedPageTarget target, string ownershipNamespace, DiagramDocument plan, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(target);
        await BeginApplyAttemptAsync(target).ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentException.ThrowIfNullOrWhiteSpace(ownershipNamespace);
        ArgumentNullException.ThrowIfNull(plan);
        await InvokeAsync(() =>
        {
            _operations.RevalidateActiveSelection(target);
            var preparedRegion = _operations.PrepareOwnedRegion(target, plan);
            ArgumentNullException.ThrowIfNull(preparedRegion);
            if (!EqualityComparer<SelectedPageTarget>.Default.Equals(target, preparedRegion.Target))
            {
                throw new InvalidOperationException("The prepared Visio region does not match the requested selected-page target.");
            }
            _operations.RevalidateActiveSelection(target);
            _operations.ApplyOwnedRegion(target, ownershipNamespace, preparedRegion);
        }, cancellationToken).ConfigureAwait(false);
    }

    public async Task SaveSelectedDocumentAsync(SelectedPageTarget target, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(target);
        await InvokeAsync(() =>
        {
            _operations.RevalidateActiveSelection(target);
            _operations.SaveSelectedDocument(target);
        }, cancellationToken).ConfigureAwait(false);
    }

    public async Task<SelectedPageReadback> ReadSelectedPageAsync(SelectedPageTarget target, string ownershipNamespace, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(target);
        await BeginReadAttemptAsync(target).ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentException.ThrowIfNullOrWhiteSpace(ownershipNamespace);
        return await InvokeAsync(() =>
        {
            _operations.RevalidateActiveSelection(target);
            var readback = _operations.ReadSelectedPage(target, ownershipNamespace);
            if (!readback.Matches(target) || !string.Equals(readback.OwnershipNamespace, ownershipNamespace, StringComparison.Ordinal))
            {
                throw new InvalidOperationException("The selected Visio readback did not match the requested ownership namespace.");
            }
            return readback;
        }, cancellationToken).ConfigureAwait(false);
    }

    public Task ReleaseSessionAsync(SelectedPageTarget target, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(target);
        return InvokeAsync(() => _operations.ReleaseSession(target), cancellationToken);
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

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposeState) != 0, this);

}

/// <summary>
/// Holds only COM references acquired from the user's active Visio window. Releasing this object
/// releases references; it never closes the user's document or quits their application.
/// </summary>
internal sealed class SelectedPageVisioComNative : ISelectedPageVisioComOperations, ISelectedPageShapeMutation, IDisposable
{
    private readonly VisioComEngineOptions _options;
    private dynamic? _application;
    private dynamic? _window;
    private dynamic? _document;
    private dynamic? _page;
    private SelectedPagePromotedRegionManifest? _expectedPromotedManifest;
    private string? _preSaveVerifiedHash;
    private string? _savedManifestHash;
    private bool _disposed;

    public SelectedPageVisioComNative(VisioComEngineOptions options)
    {
        _options = options;
    }

    public void EnsureVisibleApplication()
    {
        ThrowIfDisposed();
        if (_application is null)
        {
            _application = VisioComEngine.ConnectRunningVisio();
        }
        VisioComEngine.TrySet(() => _application.Visible = true);
    }

    public SelectedPageTarget? AttachActiveSelection()
    {
        ThrowIfDisposed();
        ResetVerificationState();
        EnsureVisibleApplication();
        dynamic? window = null;
        dynamic? page = null;
        dynamic? document = null;
        try
        {
            window = _application!.ActiveWindow;
            if (window is null) return null;
            page = window.Page;
            if (page is null) return null;
            document = page.Document;
            if (document is null) return null;

            var target = ReadTarget(document, page);
            ReleaseAttachedReferences();
            _window = window;
            _page = page;
            _document = document;
            window = null;
            page = null;
            document = null;
            return target;
        }
        catch (WorkerProtocolException)
        {
            throw;
        }
        catch (Exception error)
        {
            throw new WorkerProtocolException($"Visio selected-page attachment failed: {error.Message}", error);
        }
        finally
        {
            VisioComEngine.ReleaseCom(document);
            VisioComEngine.ReleaseCom(page);
            VisioComEngine.ReleaseCom(window);
        }
    }

    public void RevalidateActiveSelection(SelectedPageTarget target)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(target);
        RevalidateActiveTarget(target);
    }

    public void BeginApply(SelectedPageTarget target)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(target);
        RequireTarget(target);
        ResetVerificationState();
    }

    public void BeginRead(SelectedPageTarget target)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(target);
        RequireTarget(target);
        _preSaveVerifiedHash = null;
    }

    public PreparedSelectedPageRegion PrepareOwnedRegion(SelectedPageTarget target, DiagramDocument plan)
    {
        ThrowIfDisposed();
        RequireTarget(target);
        ArgumentNullException.ThrowIfNull(plan);
        return new PreparedSelectedPageRegion(target, VisioComEngine.PrepareSelectedPageRegion(_page!, plan));
    }

    public void ApplyOwnedRegion(SelectedPageTarget target, string ownershipNamespace, PreparedSelectedPageRegion preparedRegion)
    {
        ThrowIfDisposed();
        RequireTarget(target);
        ResetVerificationState();
        ArgumentException.ThrowIfNullOrWhiteSpace(ownershipNamespace);
        ArgumentNullException.ThrowIfNull(preparedRegion);
        if (!EqualityComparer<SelectedPageTarget>.Default.Equals(target, preparedRegion.Target))
        {
            throw new InvalidOperationException("The prepared Visio region does not match the requested selected-page target.");
        }
        try
        {
            var manifest = SelectedPageOwnedRegionReplacement.Execute(
                this,
                preparedRegion,
                ownershipNamespace,
                StagingNamespace(target, ownershipNamespace));
            _expectedPromotedManifest = FreezeManifest(manifest);
        }
        catch
        {
            ResetVerificationState();
            throw;
        }
    }

    public void SaveSelectedDocument(SelectedPageTarget target)
    {
        ThrowIfDisposed();
        RequireTarget(target);
        var verifiedHash = _preSaveVerifiedHash
            ?? throw new WorkerProtocolException("Saving the selected Visio document requires a successful exact pre-save readback.");
        _preSaveVerifiedHash = null;
        try
        {
            _document!.Save();
            _savedManifestHash = verifiedHash;
        }
        catch (Exception error)
        {
            throw new WorkerProtocolException($"Saving the selected Visio document failed: {error.Message}", error);
        }
    }

    public SelectedPageReadback ReadSelectedPage(SelectedPageTarget target, string ownershipNamespace)
    {
        ThrowIfDisposed();
        RequireTarget(target);
        _preSaveVerifiedHash = null;
        var expectedManifest = _expectedPromotedManifest
            ?? throw new WorkerProtocolException("Selected-page exact readback requires a promoted-region manifest from a successful apply.");
        if (!EqualityComparer<SelectedPageTarget>.Default.Equals(expectedManifest.Target, target)
            || !string.Equals(expectedManifest.OwnershipNamespace, ownershipNamespace, StringComparison.Ordinal))
        {
            throw new WorkerProtocolException("Selected-page exact readback did not match the promoted-region target or ownership namespace.");
        }
        var userShapeCount = 0;
        var ownedShapes = new List<SelectedPageReadbackShape>();
        var actualEntries = new List<SelectedPageShapeCreationEntry>();
        dynamic? shapes = null;
        try
        {
            shapes = _page!.Shapes;
            var count = Convert.ToInt32(shapes.Count, CultureInfo.InvariantCulture);
            for (var index = 1; index <= count; index++)
            {
                dynamic? shape = null;
                try
                {
                    shape = shapes.Item(index);
                    var marker = VisioComEngine.ReadShapeDataOrNullStrict(shape, OwnershipMarker.ShapeDataKey);
                    if (marker is null)
                    {
                        userShapeCount++;
                        continue;
                    }
                    if (!string.Equals(marker, ownershipNamespace, StringComparison.Ordinal)) continue;
                    IReadOnlyList<string> semanticIds = ReadSourceMappingSemanticIds((object)shape);
                    if (semanticIds.Count == 0)
                    {
                        throw new WorkerProtocolException("Selected-page owned shape is missing its source mapping semantic IDs.");
                    }
                    var role = ReadRendererRole((object)shape);
                    var nativeShapeId = NativeShapeId((object)shape);
                    if (!int.TryParse(nativeShapeId, NumberStyles.Integer, CultureInfo.InvariantCulture, out var shapeId) || shapeId <= 0)
                    {
                        throw new WorkerProtocolException("Selected-page owned shape has an invalid native shape ID.");
                    }
                    ownedShapes.Add(new SelectedPageReadbackShape(nativeShapeId, ownershipNamespace, semanticIds));
                    actualEntries.Add(new SelectedPageShapeCreationEntry(shapeId, semanticIds, role));
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

        VerifyExactPromotedRegion(expectedManifest, actualEntries);
        var manifestHash = CanonicalManifestHash(target, ownershipNamespace, actualEntries);
        if (_savedManifestHash is not null)
        {
            if (!string.Equals(_savedManifestHash, manifestHash, StringComparison.Ordinal))
            {
                throw new WorkerProtocolException("Selected-page post-save readback did not reproduce the saved promoted-region manifest.");
            }
        }
        else
        {
            _preSaveVerifiedHash = manifestHash;
        }

        return new SelectedPageReadback(
            Valid: true,
            target.DocumentId,
            target.PageId,
            target.DocumentFingerprint,
            target.PageFingerprint,
            target.ExpectedRevision,
            ownershipNamespace,
            userShapeCount,
            ownedShapes,
            UnclassifiedShapeCount: 0);
    }

    public void ReleaseSession(SelectedPageTarget target)
    {
        ThrowIfDisposed();
        RequireTarget(target);
        ResetVerificationState();
        ReleaseAttachedReferences();
    }

    public void Dispose()
    {
        if (_disposed) return;
        ResetVerificationState();
        ReleaseAttachedReferences();
        VisioComEngine.ReleaseCom(_application);
        _application = null;
        _disposed = true;
    }

    private void RequireTarget(SelectedPageTarget expected)
    {
        if (_document is null || _page is null) throw new InvalidOperationException("No selected Visio page is attached.");
        var actual = ReadTarget(_document, _page);
        if (!EqualityComparer<SelectedPageTarget>.Default.Equals(expected, actual))
        {
            ResetVerificationState();
            throw new InvalidOperationException("The selected Visio document or page changed before the operation could run.");
        }
    }

    private void RevalidateActiveTarget(SelectedPageTarget expected)
    {
        ThrowIfDisposed();
        if (_application is null) throw new InvalidOperationException("No Visio application is attached.");
        dynamic? window = null;
        dynamic? page = null;
        dynamic? document = null;
        try
        {
            window = _application.ActiveWindow;
            if (window is null) throw new WorkerProtocolException("The selected Visio document or page changed before old-shape cleanup.");
            page = window.Page;
            if (page is null) throw new WorkerProtocolException("The selected Visio document or page changed before old-shape cleanup.");
            document = page.Document;
            if (document is null) throw new WorkerProtocolException("The selected Visio document or page changed before old-shape cleanup.");
            var actual = ReadTarget(document, page);
            if (!EqualityComparer<SelectedPageTarget>.Default.Equals(expected, actual))
            {
                throw new WorkerProtocolException("The selected Visio document or page changed before old-shape cleanup.");
            }
        }
        catch (WorkerProtocolException)
        {
            ResetVerificationState();
            throw;
        }
        catch (Exception error)
        {
            ResetVerificationState();
            throw new WorkerProtocolException($"Final selected-page target revalidation failed: {error.Message}", error);
        }
        finally
        {
            ReleaseTemporaryCom(document);
            ReleaseTemporaryCom(page);
            ReleaseTemporaryCom(window);
        }
    }

    private static void ReleaseTemporaryCom(object? value)
    {
        if (value is null || !Marshal.IsComObject(value)) return;
        try { Marshal.ReleaseComObject(value); }
        catch { }
    }

    private static SelectedPageTarget ReadTarget(dynamic document, dynamic page)
    {
        dynamic? pages = null;
        try
        {
            var documentId = StableIdentifier("document", RequiredComValue(document, "ID"));
            var pageId = StableIdentifier("page", RequiredComValue(page, "ID"));
            var documentName = OptionalComValue(document, "Name");
            var pageName = OptionalComValue(page, "Name");
            var pageWidth = TryPageMetric(page, "PageWidth");
            var pageHeight = TryPageMetric(page, "PageHeight");
            pages = document.Pages;
            var pageCount = OptionalComValue(pages, "Count");
            var documentFingerprint = Hash(documentId, documentName, pageCount);
            var pageFingerprint = Hash(documentId, pageId, pageName, pageWidth, pageHeight);
            var expectedRevision = PositiveRevision(OptionalComValue(page, "ID"));
            return new SelectedPageTarget(documentId, pageId, documentFingerprint, pageFingerprint, expectedRevision);
        }
        finally
        {
            ReleaseTemporaryCom(pages);
        }
    }

    private static string RequiredComValue(dynamic value, string member)
    {
        try
        {
            var result = Convert.ToString(value.GetType().InvokeMember(member, System.Reflection.BindingFlags.GetProperty, null, value, null), CultureInfo.InvariantCulture);
            if (!string.IsNullOrWhiteSpace(result)) return result;
        }
        catch
        {
            try
            {
                var result = member switch
                {
                    "ID" => Convert.ToString(value.ID, CultureInfo.InvariantCulture),
                    _ => null,
                };
                if (!string.IsNullOrWhiteSpace(result)) return result!;
            }
            catch { }
        }
        throw new WorkerProtocolException($"Visio selected-page {member} is unavailable.");
    }

    private static string OptionalComValue(dynamic value, string member)
    {
        try
        {
            return member switch
            {
                "Name" => Convert.ToString(value.Name, CultureInfo.InvariantCulture) ?? string.Empty,
                "Count" => Convert.ToString(value.Count, CultureInfo.InvariantCulture) ?? string.Empty,
                "ID" => Convert.ToString(value.ID, CultureInfo.InvariantCulture) ?? string.Empty,
                _ => string.Empty,
            };
        }
        catch
        {
            return string.Empty;
        }
    }

    private static string TryPageMetric(dynamic page, string cellName)
    {
        try
        {
            var value = VisioComEngine.ReadSelectedPageMetric((object)page, cellName, double.NaN);
            return double.IsFinite(value) && value > 0
                ? value.ToString("R", CultureInfo.InvariantCulture)
                : string.Empty;
        }
        catch
        {
            return string.Empty;
        }
    }

    private static int PositiveRevision(string raw)
    {
        return int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) && value > 0 ? value : 1;
    }

    private static string StableIdentifier(string prefix, string value) => prefix + "-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant()[..32];

    private static string Hash(params string[] values) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join("\0", values)))).ToLowerInvariant();

    private static string StagingNamespace(SelectedPageTarget target, string ownershipNamespace)
    {
        ArgumentNullException.ThrowIfNull(target);
        ArgumentException.ThrowIfNullOrWhiteSpace(ownershipNamespace);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join(
            "\0",
            "selected-page-staging-v1",
            ownershipNamespace,
            target.DocumentId,
            target.PageId,
            target.DocumentFingerprint,
            target.PageFingerprint))));
    }

    private static void DeleteOwnedShapes(dynamic page, string ownershipNamespace)
    {
        dynamic? shapes = null;
        try
        {
            shapes = page.Shapes;
            var count = Convert.ToInt32(shapes.Count, CultureInfo.InvariantCulture);
            for (var index = count; index >= 1; index--)
            {
                dynamic? shape = null;
                try
                {
                    shape = shapes.Item(index);
                    if (string.Equals(VisioComEngine.ReadShapeDataOrNullStrict(shape, OwnershipMarker.ShapeDataKey), ownershipNamespace, StringComparison.Ordinal))
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
    }

    private static HashSet<int> ReadOwnedShapeIds(dynamic page, string ownershipNamespace)
    {
        var result = new HashSet<int>();
        dynamic? shapes = null;
        try
        {
            shapes = page.Shapes;
            var count = Convert.ToInt32(shapes.Count, CultureInfo.InvariantCulture);
            for (var index = 1; index <= count; index++)
            {
                dynamic? shape = null;
                try
                {
                    shape = shapes.Item(index);
                    if (string.Equals(VisioComEngine.ReadShapeDataOrNullStrict(shape, OwnershipMarker.ShapeDataKey), ownershipNamespace, StringComparison.Ordinal))
                    {
                        result.Add(Convert.ToInt32(shape.ID, CultureInfo.InvariantCulture));
                    }
                }
                finally
                {
                    VisioComEngine.ReleaseCom(shape);
                }
            }
            return result;
        }
        finally
        {
            VisioComEngine.ReleaseCom(shapes);
        }
    }

    private static SelectedPageShapeDeletionOutcome DeleteShapes(dynamic page, IReadOnlySet<int> shapeIds)
    {
        var requested = shapeIds.ToHashSet();
        var deleted = new HashSet<int>();
        var missing = new HashSet<int>();
        var failed = new HashSet<int>();
        if (requested.Count == 0) return new SelectedPageShapeDeletionOutcome(requested, deleted, missing, failed);
        dynamic? shapes = null;
        var completeEnumeration = true;
        try
        {
            int count;
            try
            {
                shapes = page.Shapes;
                count = Convert.ToInt32(shapes.Count, CultureInfo.InvariantCulture);
            }
            catch
            {
                failed.UnionWith(requested);
                return new SelectedPageShapeDeletionOutcome(requested, deleted, missing, failed);
            }

            var found = new HashSet<int>();
            for (var index = count; index >= 1; index--)
            {
                dynamic? shape = null;
                try
                {
                    shape = shapes.Item(index);
                    var id = Convert.ToInt32(shape.ID, CultureInfo.InvariantCulture);
                    if (!requested.Contains(id)) continue;
                    found.Add(id);
                    try
                    {
                        shape.Delete();
                        deleted.Add(id);
                    }
                    catch
                    {
                        failed.Add(id);
                    }
                }
                catch
                {
                    completeEnumeration = false;
                }
                finally
                {
                    VisioComEngine.ReleaseCom(shape);
                }
            }

            if (completeEnumeration)
            {
                missing.UnionWith(requested.Except(found));
            }
            else
            {
                failed.UnionWith(requested.Except(deleted));
            }
        }
        finally
        {
            VisioComEngine.ReleaseCom(shapes);
        }
        return new SelectedPageShapeDeletionOutcome(requested, deleted, missing, failed);
    }

    private static void TagAndVerifyShapes(dynamic page, IReadOnlyList<SelectedPageShapeCreationEntry> entries, string ownershipNamespace)
    {
        var entriesByShapeId = entries.ToDictionary(entry => entry.ShapeId);
        var shapeIds = entriesByShapeId.Keys.ToHashSet();
        var foundShapeIds = new HashSet<int>();
        dynamic? shapes = null;
        try
        {
            shapes = page.Shapes;
            var count = Convert.ToInt32(shapes.Count, CultureInfo.InvariantCulture);
            for (var index = 1; index <= count; index++)
            {
                dynamic? shape = null;
                try
                {
                    shape = shapes.Item(index);
                    int id = Convert.ToInt32(shape.ID, CultureInfo.InvariantCulture);
                    if (!shapeIds.Contains(id)) continue;
                    foundShapeIds.Add(id);
                    if (!entriesByShapeId.TryGetValue(id, out var entry))
                    {
                        throw new WorkerProtocolException("Selected-page created shape is absent from its exact creation manifest.");
                    }
                    VisioComEngine.SetRequiredShapeData(shape, OwnershipMarker.ShapeDataKey, ownershipNamespace);
                    if (!string.Equals(VisioComEngine.ReadShapeDataOrNullStrict(shape, OwnershipMarker.ShapeDataKey), ownershipNamespace, StringComparison.Ordinal))
                    {
                        throw new WorkerProtocolException("Selected-page ownership marker was not persisted on a created shape.");
                    }
                    VisioComEngine.SetRequiredShapeData(shape, "synapse.sourceMappingSemanticIds", string.Join(",", entry.SemanticIds));
                    if (!ReadSourceMappingSemanticIds((object)shape).SequenceEqual(entry.SemanticIds, StringComparer.Ordinal))
                    {
                        throw new WorkerProtocolException("Selected-page source mapping semantic IDs were not persisted on a created shape.");
                    }
                    VisioComEngine.SetRequiredShapeData(shape, "synapse.rendererRole", entry.Role.ToString());
                    if (!string.Equals(VisioComEngine.ReadShapeDataOrNullStrict(shape, "synapse.rendererRole"), entry.Role.ToString(), StringComparison.Ordinal))
                    {
                        throw new WorkerProtocolException("Selected-page renderer role was not persisted on a created shape.");
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
        if (!foundShapeIds.SetEquals(shapeIds))
        {
            throw new WorkerProtocolException("Selected-page replacement lost a newly created shape before staging completed.");
        }
    }

    private static void PromoteAndVerifyShapes(dynamic page, IReadOnlySet<int> shapeIds, string stagingNamespace, string finalNamespace)
    {
        var foundShapeIds = new HashSet<int>();
        dynamic? shapes = null;
        try
        {
            shapes = page.Shapes;
            var count = Convert.ToInt32(shapes.Count, CultureInfo.InvariantCulture);
            for (var index = 1; index <= count; index++)
            {
                dynamic? shape = null;
                try
                {
                    shape = shapes.Item(index);
                    var id = Convert.ToInt32(shape.ID, CultureInfo.InvariantCulture);
                    if (!shapeIds.Contains(id)) continue;
                    foundShapeIds.Add(id);
                    if (!string.Equals(VisioComEngine.ReadShapeDataOrNullStrict(shape, OwnershipMarker.ShapeDataKey), stagingNamespace, StringComparison.Ordinal))
                    {
                        throw new WorkerProtocolException("Selected-page staged shape ownership changed before promotion.");
                    }
                    if (ReadSourceMappingSemanticIds((object)shape).Count == 0)
                    {
                        throw new WorkerProtocolException("Selected-page staged shape lost its source mapping before promotion.");
                    }
                    VisioComEngine.SetRequiredShapeData(shape, OwnershipMarker.ShapeDataKey, finalNamespace);
                    if (!string.Equals(VisioComEngine.ReadShapeDataOrNullStrict(shape, OwnershipMarker.ShapeDataKey), finalNamespace, StringComparison.Ordinal))
                    {
                        throw new WorkerProtocolException("Selected-page final ownership marker was not persisted on a promoted shape.");
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
        if (!foundShapeIds.SetEquals(shapeIds))
        {
            throw new WorkerProtocolException("Selected-page replacement lost a staged shape before promotion completed.");
        }
    }

    IReadOnlySet<int> ISelectedPageShapeMutation.ReadOwnedShapeIds(string ownershipNamespace) => ReadOwnedShapeIds(_page!, ownershipNamespace);

    void ISelectedPageShapeMutation.DeleteOwnedShapes(string ownershipNamespace) => DeleteOwnedShapes(_page!, ownershipNamespace);

    void ISelectedPageShapeMutation.DrawPrepared(
        PreparedSelectedPageRegion preparedRegion,
        SelectedPageShapeCreationJournal creationJournal) =>
        VisioComEngine.DrawPreparedSelectedPageRegion((object)_page!, preparedRegion, creationJournal.Record);

    void ISelectedPageShapeMutation.TagAndVerifyShapes(IReadOnlyList<SelectedPageShapeCreationEntry> entries, string ownershipNamespace) =>
        TagAndVerifyShapes(_page!, entries, ownershipNamespace);

    void ISelectedPageShapeMutation.PromoteAndVerifyShapes(IReadOnlySet<int> shapeIds, string stagingNamespace, string finalNamespace) =>
        PromoteAndVerifyShapes(_page!, shapeIds, stagingNamespace, finalNamespace);

    void ISelectedPageShapeMutation.RevalidateActiveTarget(SelectedPageTarget target) => RevalidateActiveTarget(target);

    SelectedPageShapeDeletionOutcome ISelectedPageShapeMutation.DeleteShapes(IReadOnlySet<int> shapeIds) => DeleteShapes(_page!, shapeIds);

    private static SelectedPagePromotedRegionManifest FreezeManifest(SelectedPagePromotedRegionManifest manifest)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        if (manifest.Entries.Count == 0
            || manifest.Entries.Any(entry => entry.ShapeId <= 0 || entry.SemanticIds.Count == 0))
        {
            throw new WorkerProtocolException("Selected-page promoted-region manifest is empty or invalid.");
        }

        var entries = manifest.Entries
            .OrderBy(entry => entry.ShapeId)
            .Select(entry => new SelectedPageShapeCreationEntry(
                entry.ShapeId,
                Array.AsReadOnly(entry.SemanticIds.ToArray()),
                entry.Role))
            .ToArray();
        if (entries.Select(entry => entry.ShapeId).Distinct().Count() != entries.Length)
        {
            throw new WorkerProtocolException("Selected-page promoted-region manifest contains duplicate native shape IDs.");
        }

        return new SelectedPagePromotedRegionManifest(
            manifest.Target,
            manifest.OwnershipNamespace,
            Array.AsReadOnly(entries));
    }

    private static void VerifyExactPromotedRegion(
        SelectedPagePromotedRegionManifest expectedManifest,
        IReadOnlyList<SelectedPageShapeCreationEntry> actualEntries)
    {
        var expectedByShapeId = expectedManifest.Entries.ToDictionary(entry => entry.ShapeId);
        if (expectedByShapeId.Count != expectedManifest.Entries.Count)
        {
            throw new WorkerProtocolException("Selected-page promoted-region manifest contains duplicate native shape IDs.");
        }

        var actualByShapeId = new Dictionary<int, SelectedPageShapeCreationEntry>();
        foreach (var entry in actualEntries)
        {
            if (!actualByShapeId.TryAdd(entry.ShapeId, entry))
            {
                throw new WorkerProtocolException("Selected-page exact readback found duplicate native shape IDs in the final ownership namespace.");
            }
        }

        if (actualByShapeId.Count != expectedByShapeId.Count)
        {
            throw new WorkerProtocolException("Selected-page exact readback did not reproduce the promoted-region shape set.");
        }

        foreach (var expected in expectedByShapeId)
        {
            if (!actualByShapeId.TryGetValue(expected.Key, out var actual)
                || actual.Role != expected.Value.Role
                || !actual.SemanticIds.SequenceEqual(expected.Value.SemanticIds, StringComparer.Ordinal))
            {
                throw new WorkerProtocolException("Selected-page exact readback did not reproduce the promoted-region shape mapping.");
            }
        }
    }

    private static string CanonicalManifestHash(
        SelectedPageTarget target,
        string ownershipNamespace,
        IEnumerable<SelectedPageShapeCreationEntry> entries)
    {
        var payload = new StringBuilder()
            .Append(target.DocumentId).Append('\n')
            .Append(target.PageId).Append('\n')
            .Append(target.DocumentFingerprint).Append('\n')
            .Append(target.PageFingerprint).Append('\n')
            .Append(target.ExpectedRevision.ToString(CultureInfo.InvariantCulture)).Append('\n')
            .Append(ownershipNamespace).Append('\n');
        foreach (var entry in entries.OrderBy(entry => entry.ShapeId))
        {
            payload
                .Append(entry.ShapeId.ToString(CultureInfo.InvariantCulture)).Append('|')
                .Append(entry.Role).Append('|')
                .AppendJoin(',', entry.SemanticIds)
                .Append('\n');
        }

        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload.ToString()))).ToLowerInvariant();
    }

    private static string NativeShapeId(object shape)
    {
        dynamic nativeShape = shape;
        return Convert.ToString(nativeShape.ID, CultureInfo.InvariantCulture)
            ?? throw new WorkerProtocolException("Selected-page owned shape has no native shape ID.");
    }

    private static IReadOnlyList<string> ReadSourceMappingSemanticIds(object shape)
    {
        var raw = VisioComEngine.ReadShapeDataOrNullStrict(shape, "synapse.sourceMappingSemanticIds");
        if (string.IsNullOrWhiteSpace(raw)) return [];

        var semanticIds = raw
            .Split(',', StringSplitOptions.None)
            .Select(value => value.Trim())
            .ToArray();
        if (semanticIds.Any(string.IsNullOrWhiteSpace))
        {
            throw new WorkerProtocolException("Selected-page source mapping semantic IDs contain a blank token.");
        }
        if (semanticIds.Distinct(StringComparer.Ordinal).Count() != semanticIds.Length)
        {
            throw new WorkerProtocolException("Selected-page source mapping semantic IDs contain a duplicate token.");
        }

        return semanticIds.Order(StringComparer.Ordinal).ToArray();
    }

    private static SelectedPageShapeRole ReadRendererRole(object shape)
    {
        var raw = VisioComEngine.ReadShapeDataOrNullStrict(shape, "synapse.rendererRole");
        if (string.IsNullOrWhiteSpace(raw)
            || !Enum.TryParse<SelectedPageShapeRole>(raw, ignoreCase: false, out var role)
            || !Enum.IsDefined(role)
            || !string.Equals(raw, role.ToString(), StringComparison.Ordinal))
        {
            throw new WorkerProtocolException("Selected-page owned shape is missing or has an invalid renderer role.");
        }

        return role;
    }

    private void ResetVerificationState()
    {
        _expectedPromotedManifest = null;
        _preSaveVerifiedHash = null;
        _savedManifestHash = null;
    }

    private void ReleaseAttachedReferences()
    {
        VisioComEngine.ReleaseCom(_page);
        VisioComEngine.ReleaseCom(_document);
        VisioComEngine.ReleaseCom(_window);
        _page = null;
        _document = null;
        _window = null;
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(_disposed, this);
}
