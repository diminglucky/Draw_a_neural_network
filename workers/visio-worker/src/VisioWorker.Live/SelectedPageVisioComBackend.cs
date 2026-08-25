using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using VisioWorker.Core;

namespace VisioWorker.Live;

/// <summary>
/// Fixed native operation set for a user-selected existing Visio page. It has no document/page
/// creation, opening-by-path, output-path, or SaveAs operation.
/// </summary>
public interface ISelectedPageVisioComOperations
{
    void EnsureVisibleApplication();
    SelectedPageTarget? AttachActiveSelection();
    void ApplyOwnedRegion(SelectedPageTarget target, string ownershipNamespace, DiagramDocument plan);
    void SaveSelectedDocument(SelectedPageTarget target);
    SelectedPageReadback ReadSelectedPage(SelectedPageTarget target);
    void ReleaseSession(SelectedPageTarget target);
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

    public SelectedPageVisioComBackend(ISelectedPageVisioComOperations operations)
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

    public async Task ApplyOwnedRegionAsync(SelectedPageTarget target, string ownershipNamespace, DiagramDocument plan, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(target);
        ArgumentException.ThrowIfNullOrWhiteSpace(ownershipNamespace);
        ArgumentNullException.ThrowIfNull(plan);
        await InvokeAsync(() =>
        {
            EnsureSameTarget(target, RequireActiveTarget());
            _operations.ApplyOwnedRegion(target, ownershipNamespace, plan);
        }, cancellationToken).ConfigureAwait(false);
    }

    public async Task SaveSelectedDocumentAsync(SelectedPageTarget target, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(target);
        await InvokeAsync(() =>
        {
            EnsureSameTarget(target, RequireActiveTarget());
            _operations.SaveSelectedDocument(target);
        }, cancellationToken).ConfigureAwait(false);
    }

    public async Task<SelectedPageReadback> ReadSelectedPageAsync(SelectedPageTarget target, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(target);
        return await InvokeAsync(() =>
        {
            EnsureSameTarget(target, RequireActiveTarget());
            var readback = _operations.ReadSelectedPage(target);
            EnsureSameTarget(target, readback.Target);
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

    private SelectedPageTarget RequireActiveTarget() =>
        _operations.AttachActiveSelection() ?? throw new InvalidOperationException("The selected Visio page is no longer active.");

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

    private static void EnsureSameTarget(SelectedPageTarget expected, SelectedPageTarget actual)
    {
        if (!EqualityComparer<SelectedPageTarget>.Default.Equals(expected, actual))
        {
            throw new InvalidOperationException("The selected Visio document or page changed before the operation could run.");
        }
    }
}

/// <summary>
/// Holds only COM references acquired from the user's active Visio window. Releasing this object
/// releases references; it never closes the user's document or quits their application.
/// </summary>
internal sealed class SelectedPageVisioComNative : ISelectedPageVisioComOperations, IDisposable
{
    private readonly VisioComEngineOptions _options;
    private dynamic? _application;
    private dynamic? _window;
    private dynamic? _document;
    private dynamic? _page;
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
            // Starting Visio is allowed solely to let the user open and select an existing page.
            // No Documents.Add or Pages.Add call exists anywhere in this selected-page adapter.
            _application = VisioComEngine.ConnectVisio(_options with { AttachToRunning = true, Visible = true }, out _);
        }
        VisioComEngine.TrySet(() => _application.Visible = true);
    }

    public SelectedPageTarget? AttachActiveSelection()
    {
        ThrowIfDisposed();
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

    public void ApplyOwnedRegion(SelectedPageTarget target, string ownershipNamespace, DiagramDocument plan)
    {
        ThrowIfDisposed();
        RequireTarget(target);
        ArgumentException.ThrowIfNullOrWhiteSpace(ownershipNamespace);
        ArgumentNullException.ThrowIfNull(plan);
        DeleteOwnedShapes(_page!, ownershipNamespace);
        var existingShapeIds = ReadShapeIds(_page!);
        VisioComEngine.DrawSelectedPageRegion(_page!, plan);
        TagNewShapes(_page!, existingShapeIds, ownershipNamespace);
    }

    public void SaveSelectedDocument(SelectedPageTarget target)
    {
        ThrowIfDisposed();
        RequireTarget(target);
        try
        {
            _document!.Save();
        }
        catch (Exception error)
        {
            throw new WorkerProtocolException($"Saving the selected Visio document failed: {error.Message}", error);
        }
    }

    public SelectedPageReadback ReadSelectedPage(SelectedPageTarget target)
    {
        ThrowIfDisposed();
        RequireTarget(target);
        var ownedPrimitiveIds = new List<string>();
        var userShapeCount = 0;
        var ownedShapeCount = 0;
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
                    ownedShapeCount++;
                    var primitiveId = VisioComEngine.TryReadShapeData(shape, "synapse.primitiveId");
                    if (!string.IsNullOrWhiteSpace(primitiveId)) ownedPrimitiveIds.Add(primitiveId);
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

        return new SelectedPageReadback(target, userShapeCount, ownedShapeCount, ownedPrimitiveIds);
    }

    public void ReleaseSession(SelectedPageTarget target)
    {
        ThrowIfDisposed();
        RequireTarget(target);
        ReleaseAttachedReferences();
    }

    public void Dispose()
    {
        if (_disposed) return;
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
            throw new InvalidOperationException("The selected Visio document or page changed before the operation could run.");
        }
    }

    private static SelectedPageTarget ReadTarget(dynamic document, dynamic page)
    {
        var documentId = StableIdentifier("document", RequiredComValue(document, "ID"));
        var pageId = StableIdentifier("page", RequiredComValue(page, "ID"));
        var documentName = OptionalComValue(document, "Name");
        var pageName = OptionalComValue(page, "Name");
        var pageWidth = TryPageMetric(page, "PageWidth");
        var pageHeight = TryPageMetric(page, "PageHeight");
        var pageCount = OptionalComValue(document.Pages, "Count");
        var documentFingerprint = Hash(documentId, documentName, pageCount);
        var pageFingerprint = Hash(documentId, pageId, pageName, pageWidth, pageHeight);
        var expectedRevision = PositiveRevision(OptionalComValue(page, "ID"));
        return new SelectedPageTarget(documentId, pageId, documentFingerprint, pageFingerprint, expectedRevision);
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
        dynamic? cell = null;
        try
        {
            cell = page.PageSheet.CellsU(cellName);
            return Convert.ToString(cell.ResultIU, CultureInfo.InvariantCulture) ?? string.Empty;
        }
        catch
        {
            return string.Empty;
        }
        finally
        {
            VisioComEngine.ReleaseCom(cell);
        }
    }

    private static int PositiveRevision(string raw)
    {
        return int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) && value > 0 ? value : 1;
    }

    private static string StableIdentifier(string prefix, string value) => prefix + "-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant()[..32];

    private static string Hash(params string[] values) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join("\0", values)))).ToLowerInvariant();

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

    private static HashSet<int> ReadShapeIds(dynamic page)
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
                    result.Add(Convert.ToInt32(shape.ID, CultureInfo.InvariantCulture));
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

    private static void TagNewShapes(dynamic page, IReadOnlySet<int> existingShapeIds, string ownershipNamespace)
    {
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
                    if (existingShapeIds.Contains(id)) continue;
                    VisioComEngine.SetRequiredShapeData(shape, OwnershipMarker.ShapeDataKey, ownershipNamespace);
                    if (!string.Equals(VisioComEngine.ReadShapeDataOrNullStrict(shape, OwnershipMarker.ShapeDataKey), ownershipNamespace, StringComparison.Ordinal))
                    {
                        throw new WorkerProtocolException("Selected-page ownership marker was not persisted on a created shape.");
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
