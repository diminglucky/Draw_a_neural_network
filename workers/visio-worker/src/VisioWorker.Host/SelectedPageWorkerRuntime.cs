using System.Text.Json;
using VisioWorker.Core;
using VisioWorker.Live;

namespace VisioWorker.Host;

public sealed record SelectedPageWorkerResponse(
    int ProtocolVersion,
    string RequestId,
    string Status,
    SelectedPageWorkerBinding? SelectedPage = null,
    SelectedPageReadback? Readback = null,
    SelectedPageTarget? CapturedTarget = null,
    string? Error = null);

/// <summary>Separate v3 lifecycle. It intentionally never delegates to the legacy export runtime.</summary>
public sealed class SelectedPageWorkerRuntime : IAsyncDisposable
{
    private readonly SelectedPageSessionManager _session;
    private readonly SelectedPageSealedIntentVerifier? _intentVerifier;

    public SelectedPageWorkerRuntime(ISelectedPageSessionBackend backend, SelectedPageSealedIntentVerifier? intentVerifier = null)
    {
        _session = new SelectedPageSessionManager(backend);
        _intentVerifier = intentVerifier;
    }

    public async Task<SelectedPageWorkerResponse> ProcessAsync(SelectedPageWorkerRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        switch (request.Command)
        {
            case SelectedPageWorkerCommand.CaptureSelectedPage:
                var captured = await _session.CaptureActiveSelectionAsync(cancellationToken).ConfigureAwait(false);
                return captured.Status == SelectedPageSessionStatus.Attached
                    ? new SelectedPageWorkerResponse(3, request.RequestId, "succeeded", CapturedTarget: captured.Target)
                    : new SelectedPageWorkerResponse(3, request.RequestId, "failed", Error: "waiting_for_selected_page");
            case SelectedPageWorkerCommand.AttachSelectedPage:
                var target = Target(request);
                var attached = await _session.AttachAsync(target, request.Binding!.OwnershipNamespace, cancellationToken).ConfigureAwait(false);
                return attached.Status == SelectedPageSessionStatus.Attached
                    ? new SelectedPageWorkerResponse(3, request.RequestId, "succeeded", request.Binding)
                    : new SelectedPageWorkerResponse(3, request.RequestId, "failed", Error: "waiting_for_selected_page");
            case SelectedPageWorkerCommand.SaveSelectedDocument:
                await _session.SaveSelectedDocumentAsync(cancellationToken).ConfigureAwait(false);
                return new SelectedPageWorkerResponse(3, request.RequestId, "succeeded", request.Binding);
            case SelectedPageWorkerCommand.ReadSelectedPage:
                var readback = await _session.ReadSelectedPageAsync(request.Binding!.OwnershipNamespace, cancellationToken).ConfigureAwait(false);
                return new SelectedPageWorkerResponse(3, request.RequestId, "succeeded", request.Binding, readback);
            case SelectedPageWorkerCommand.CloseSession:
                await _session.CloseAsync(cancellationToken).ConfigureAwait(false);
                return new SelectedPageWorkerResponse(3, request.RequestId, "succeeded", request.Binding);
            case SelectedPageWorkerCommand.ApplyOwnedRegion:
                if (_intentVerifier is null) throw new WorkerProtocolException("Selected-page HMAC verification is not configured.");
                var canonicalPlan = _intentVerifier.Verify(request);
                using (var document = JsonDocument.Parse(canonicalPlan))
                {
                    var plan = SelectedPageNativeIntentMapper.Map(document.RootElement, request);
                    await _session.ApplyOwnedRegionAsync(request.OwnershipNamespace!, plan, cancellationToken).ConfigureAwait(false);
                }
                return new SelectedPageWorkerResponse(3, request.RequestId, "succeeded", request.Binding);
            default:
                throw new WorkerProtocolException("Selected-page command is invalid.");
        }
    }

    private static SelectedPageTarget Target(SelectedPageWorkerRequest request)
    {
        var binding = request.Binding ?? throw new WorkerProtocolException("Selected-page command requires a page binding.");
        return new SelectedPageTarget(binding.DocumentId, binding.PageId, binding.DocumentFingerprint, binding.PageFingerprint, binding.ExpectedRevision);
    }

    public async ValueTask DisposeAsync() => await _session.CloseAsync().ConfigureAwait(false);
}
