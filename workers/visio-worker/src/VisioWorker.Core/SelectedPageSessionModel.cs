namespace VisioWorker.Core;

/// <summary>
/// The immutable identity of one user-selected existing Visio page. It deliberately contains no
/// path and cannot express document or page creation.
/// </summary>
public sealed record SelectedPageTarget(
    string DocumentId,
    string PageId,
    string DocumentFingerprint,
    string PageFingerprint,
    int ExpectedRevision);

public enum SelectedPageSessionStatus
{
    WaitingForSelection,
    Attached,
    Closed,
}

public sealed record SelectedPageSessionResult(SelectedPageSessionStatus Status, SelectedPageTarget? Target);

public sealed record SelectedPageReadback(
    SelectedPageTarget Target,
    int UserShapeCount,
    int AgentOwnedShapeCount,
    IReadOnlyList<string> AgentOwnedPrimitiveIds);

/// <summary>
/// Native capability surface for current-page work. Creation, opening by path and SaveAs are
/// intentionally absent so a selected-page request cannot silently become an export request.
/// </summary>
public interface ISelectedPageSessionBackend
{
    Task EnsureVisibleApplicationAsync(CancellationToken cancellationToken = default);
    Task<SelectedPageTarget?> AttachActiveSelectionAsync(CancellationToken cancellationToken = default);
    Task ApplyOwnedRegionAsync(SelectedPageTarget target, string ownershipNamespace, DiagramDocument plan, CancellationToken cancellationToken = default);
    Task SaveSelectedDocumentAsync(SelectedPageTarget target, CancellationToken cancellationToken = default);
    Task<SelectedPageReadback> ReadSelectedPageAsync(SelectedPageTarget target, CancellationToken cancellationToken = default);
    Task ReleaseSessionAsync(SelectedPageTarget target, CancellationToken cancellationToken = default);
}
