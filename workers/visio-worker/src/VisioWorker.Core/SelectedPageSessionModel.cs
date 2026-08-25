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

/// <summary>
/// Public v3 readback evidence. Keep this flat: it is serialized directly to the TypeScript
/// selected-page protocol and must not expose the Worker-only <see cref="SelectedPageTarget"/>
/// aggregate or cross-namespace ownership data.
/// </summary>
public sealed record SelectedPageReadback(
    bool Valid,
    string DocumentId,
    string PageId,
    string DocumentFingerprint,
    string PageFingerprint,
    int ExpectedRevision,
    string OwnershipNamespace,
    int UserOwnedShapeCount,
    IReadOnlyList<SelectedPageReadbackShape> AgentOwnedShapes,
    int UnclassifiedShapeCount)
{
    public bool Matches(SelectedPageTarget target) =>
        string.Equals(DocumentId, target.DocumentId, StringComparison.Ordinal)
        && string.Equals(PageId, target.PageId, StringComparison.Ordinal)
        && string.Equals(DocumentFingerprint, target.DocumentFingerprint, StringComparison.Ordinal)
        && string.Equals(PageFingerprint, target.PageFingerprint, StringComparison.Ordinal)
        && ExpectedRevision == target.ExpectedRevision;
}

public sealed record SelectedPageReadbackShape(
    string NativeShapeId,
    string OwnershipNamespace,
    IReadOnlyList<string> SourceMappingSemanticIds);

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
    Task<SelectedPageReadback> ReadSelectedPageAsync(SelectedPageTarget target, string ownershipNamespace, CancellationToken cancellationToken = default);
    Task ReleaseSessionAsync(SelectedPageTarget target, CancellationToken cancellationToken = default);
}
