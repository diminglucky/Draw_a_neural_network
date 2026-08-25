namespace VisioWorker.Core;

/// <summary>
/// Owns a single selected-page session. Every state-changing operation re-attaches the active
/// Visio selection and rejects it if the document, page, fingerprints or revision have changed.
/// </summary>
public sealed class SelectedPageSessionManager
{
    private readonly ISelectedPageSessionBackend _backend;
    private SelectedPageTarget? _attachedTarget;
    private string? _attachedOwnershipNamespace;

    public SelectedPageSessionManager(ISelectedPageSessionBackend backend)
    {
        _backend = backend ?? throw new ArgumentNullException(nameof(backend));
    }

    public async Task<SelectedPageSessionResult> AttachAsync(SelectedPageTarget expectedTarget, string ownershipNamespace, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(expectedTarget);
        if (string.IsNullOrWhiteSpace(ownershipNamespace)) throw new ArgumentException("Ownership namespace is required.", nameof(ownershipNamespace));
        cancellationToken.ThrowIfCancellationRequested();
        await _backend.EnsureVisibleApplicationAsync(cancellationToken).ConfigureAwait(false);
        var actualTarget = await _backend.AttachActiveSelectionAsync(cancellationToken).ConfigureAwait(false);
        if (actualTarget is null)
        {
            _attachedTarget = null;
            _attachedOwnershipNamespace = null;
            return new SelectedPageSessionResult(SelectedPageSessionStatus.WaitingForSelection, null);
        }
        EnsureSameTarget(expectedTarget, actualTarget);
        _attachedTarget = actualTarget;
        _attachedOwnershipNamespace = ownershipNamespace;
        return new SelectedPageSessionResult(SelectedPageSessionStatus.Attached, actualTarget);
    }

    /// <summary>Reads the currently selected existing page, then releases all retained COM references without mutation.</summary>
    public async Task<SelectedPageSessionResult> CaptureActiveSelectionAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        await _backend.EnsureVisibleApplicationAsync(cancellationToken).ConfigureAwait(false);
        var target = await _backend.AttachActiveSelectionAsync(cancellationToken).ConfigureAwait(false);
        if (target is null) return new SelectedPageSessionResult(SelectedPageSessionStatus.WaitingForSelection, null);
        try
        {
            return new SelectedPageSessionResult(SelectedPageSessionStatus.Attached, target);
        }
        finally
        {
            await _backend.ReleaseSessionAsync(target, cancellationToken).ConfigureAwait(false);
        }
    }

    public async Task ApplyOwnedRegionAsync(string ownershipNamespace, DiagramDocument plan, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(ownershipNamespace)) throw new ArgumentException("Ownership namespace is required.", nameof(ownershipNamespace));
        ArgumentNullException.ThrowIfNull(plan);
        var target = await RevalidateAttachedTargetAsync(cancellationToken).ConfigureAwait(false);
        EnsureAttachedOwnershipNamespace(ownershipNamespace);
        await _backend.ApplyOwnedRegionAsync(target, ownershipNamespace, plan, cancellationToken).ConfigureAwait(false);
    }

    public async Task SaveSelectedDocumentAsync(CancellationToken cancellationToken = default)
    {
        var target = await RevalidateAttachedTargetAsync(cancellationToken).ConfigureAwait(false);
        await _backend.SaveSelectedDocumentAsync(target, cancellationToken).ConfigureAwait(false);
    }

    public async Task<SelectedPageReadback> ReadSelectedPageAsync(string ownershipNamespace, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(ownershipNamespace)) throw new ArgumentException("Ownership namespace is required.", nameof(ownershipNamespace));
        var target = await RevalidateAttachedTargetAsync(cancellationToken).ConfigureAwait(false);
        EnsureAttachedOwnershipNamespace(ownershipNamespace);
        var readback = await _backend.ReadSelectedPageAsync(target, ownershipNamespace, cancellationToken).ConfigureAwait(false);
        if (!readback.Valid || !readback.Matches(target) || !string.Equals(readback.OwnershipNamespace, ownershipNamespace, StringComparison.Ordinal) || readback.UnclassifiedShapeCount != 0)
        {
            throw new InvalidOperationException("Selected Visio readback does not match the attached target and ownership namespace.");
        }
        return readback;
    }

    public async Task CloseAsync(CancellationToken cancellationToken = default)
    {
        if (_attachedTarget is null) return;
        var target = _attachedTarget;
        _attachedTarget = null;
        _attachedOwnershipNamespace = null;
        await _backend.ReleaseSessionAsync(target, cancellationToken).ConfigureAwait(false);
    }

    private async Task<SelectedPageTarget> RevalidateAttachedTargetAsync(CancellationToken cancellationToken)
    {
        if (_attachedTarget is null) throw new InvalidOperationException("A selected Visio page must be attached before this operation.");
        cancellationToken.ThrowIfCancellationRequested();
        var actualTarget = await _backend.AttachActiveSelectionAsync(cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException("The selected Visio page is no longer active.");
        EnsureSameTarget(_attachedTarget, actualTarget);
        return actualTarget;
    }

    private static void EnsureSameTarget(SelectedPageTarget expected, SelectedPageTarget actual)
    {
        if (!EqualityComparer<SelectedPageTarget>.Default.Equals(expected, actual))
        {
            throw new InvalidOperationException("The selected Visio document or page changed before the operation could run.");
        }
    }

    private void EnsureAttachedOwnershipNamespace(string ownershipNamespace)
    {
        if (!string.Equals(_attachedOwnershipNamespace, ownershipNamespace, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("The selected Visio ownership namespace changed before the operation could run.");
        }
    }
}
