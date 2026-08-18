namespace VisioWorker.Core;

public sealed record VisioSessionKey
{
    public VisioSessionKey(string tenantId, string userId, string deviceId, string workflowId)
    {
        TenantId = ValidateIdentifier(tenantId, nameof(tenantId));
        UserId = ValidateIdentifier(userId, nameof(userId));
        DeviceId = ValidateIdentifier(deviceId, nameof(deviceId));
        WorkflowId = ValidateIdentifier(workflowId, nameof(workflowId));
    }

    public string TenantId { get; }
    public string UserId { get; }
    public string DeviceId { get; }
    public string WorkflowId { get; }

    internal static string ValidateIdentifier(string value, string parameterName)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 128 || !IsSafeIdentifier(value))
        {
            throw new ArgumentException("Session identifiers must be 1-128 characters from [A-Za-z0-9._-].", parameterName);
        }

        return value;
    }

    private static bool IsSafeIdentifier(string value) =>
        value.All(character => char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or '-');
}

public sealed record VisioSessionOperation
{
    public VisioSessionOperation(string operationId, string planHash)
    {
        OperationId = VisioSessionKey.ValidateIdentifier(operationId, nameof(operationId));
        if (string.IsNullOrWhiteSpace(planHash) || planHash.Length != 64 || !planHash.All(Uri.IsHexDigit))
        {
            throw new ArgumentException("Plan hash must be a 64-character hexadecimal SHA-256 value.", nameof(planHash));
        }

        PlanHash = planHash.ToLowerInvariant();
    }

    public string OperationId { get; }
    public string PlanHash { get; }
}

public enum VisioSessionState
{
    Created,
    Open,
    Dirty,
    Saving,
    Closed,
    Recovering,
}

public sealed record VisioSessionDocument
{
    public VisioSessionDocument(string documentHandle, string pageHandle)
    {
        DocumentHandle = RequireOpaqueHandle(documentHandle, nameof(documentHandle));
        PageHandle = RequireOpaqueHandle(pageHandle, nameof(pageHandle));
    }

    public string DocumentHandle { get; }
    public string PageHandle { get; }

    private static string RequireOpaqueHandle(string value, string parameterName)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 512)
        {
            throw new ArgumentException("Backend document and page handles must be non-empty bounded opaque values.", parameterName);
        }

        return value;
    }
}

public sealed record VisioSessionOperationJournalEntry(string OperationId, string PlanHash);

public sealed record VisioSessionCommandReplayEntry
{
    public VisioSessionCommandReplayEntry(string requestId, string fingerprint, string status, string outputPath)
    {
        RequestId = VisioSessionKey.ValidateIdentifier(requestId, nameof(requestId));
        if (string.IsNullOrWhiteSpace(fingerprint) || fingerprint.Length != 64 || !fingerprint.All(Uri.IsHexDigit))
        {
            throw new ArgumentException("Command replay fingerprint must be a 64-character hexadecimal SHA-256 value.", nameof(fingerprint));
        }

        if (!string.Equals(status, "succeeded", StringComparison.Ordinal))
        {
            throw new ArgumentException("Only successful terminal command responses may be persisted for replay.", nameof(status));
        }

        if (string.IsNullOrWhiteSpace(outputPath) || outputPath.Length > 4096 || outputPath.Any(char.IsControl))
        {
            throw new ArgumentException("Command replay output path must be a non-empty bounded path without control characters.", nameof(outputPath));
        }

        Fingerprint = fingerprint.ToLowerInvariant();
        Status = status;
        OutputPath = outputPath;
    }

    public string RequestId { get; }
    public string Fingerprint { get; }
    public string Status { get; }
    public string OutputPath { get; }
}

public static class VisioSessionOperationJournal
{
    // Keeps a persisted recovery record bounded while preserving every accepted operation identity
    // in the current session. A caller must roll over to a fresh, explicitly saved workflow instead
    // of silently dropping collision-detection history.
    public const int MaximumEntries = 1024;
}

/// <summary>
/// The recovery capability for one persisted Visio session. A caller must present the exact manifest
/// emitted after a successful save; the Core layer additionally requires the same manifest for an
/// already-known session. Output-root containment remains a Live backend responsibility because Core
/// deliberately has no filesystem policy.
/// </summary>
public sealed record VisioSessionRecoveryManifest
{
    public VisioSessionRecoveryManifest(
        VisioSessionKey key,
        string outputPath,
        VisioSessionDocument document,
        string? lastPlanHash,
        IEnumerable<VisioSessionOperationJournalEntry> operationJournal,
        IEnumerable<VisioSessionCommandReplayEntry>? commandReplayJournal = null)
    {
        Key = key ?? throw new ArgumentNullException(nameof(key));
        if (string.IsNullOrWhiteSpace(outputPath) || outputPath.Length > 4096 || outputPath.Any(char.IsControl))
        {
            throw new ArgumentException("Recovery output path must be a non-empty bounded path without control characters.", nameof(outputPath));
        }

        OutputPath = outputPath;
        Document = document ?? throw new ArgumentNullException(nameof(document));
        LastPlanHash = lastPlanHash is null ? null : new VisioSessionOperation("manifest-plan", lastPlanHash).PlanHash;
        OperationJournal = NormalizeJournal(operationJournal, nameof(operationJournal));
        CommandReplayJournal = NormalizeCommandReplayJournal(commandReplayJournal ?? [], nameof(commandReplayJournal));
        if (LastPlanHash is not null && !OperationJournal.Any(entry => string.Equals(entry.PlanHash, LastPlanHash, StringComparison.Ordinal)))
        {
            throw new ArgumentException("Recovery manifest last plan hash must be present in its operation journal.", nameof(lastPlanHash));
        }
    }

    public VisioSessionKey Key { get; }
    public string OutputPath { get; }
    public VisioSessionDocument Document { get; }
    public string? LastPlanHash { get; }
    public IReadOnlyList<VisioSessionOperationJournalEntry> OperationJournal { get; }
    public IReadOnlyList<VisioSessionCommandReplayEntry> CommandReplayJournal { get; }

    internal static IReadOnlyList<VisioSessionOperationJournalEntry> NormalizeJournal(
        IEnumerable<VisioSessionOperationJournalEntry> operationJournal,
        string parameterName)
    {
        ArgumentNullException.ThrowIfNull(operationJournal);
        var normalized = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var entry in operationJournal)
        {
            ArgumentNullException.ThrowIfNull(entry);
            if (normalized.Count >= VisioSessionOperationJournal.MaximumEntries)
            {
                throw new ArgumentException("Recovery manifest operation journal exceeds the allowed entry limit.", parameterName);
            }
            var operation = new VisioSessionOperation(entry.OperationId, entry.PlanHash);
            if (!normalized.TryAdd(operation.OperationId, operation.PlanHash))
            {
                throw new ArgumentException("Recovery manifest operation journal cannot contain duplicate operation identifiers.", parameterName);
            }
        }

        return Array.AsReadOnly(normalized
            .OrderBy(entry => entry.Key, StringComparer.Ordinal)
            .Select(entry => new VisioSessionOperationJournalEntry(entry.Key, entry.Value))
            .ToArray());
    }

    internal static IReadOnlyList<VisioSessionCommandReplayEntry> NormalizeCommandReplayJournal(
        IEnumerable<VisioSessionCommandReplayEntry> commandReplayJournal,
        string parameterName)
    {
        ArgumentNullException.ThrowIfNull(commandReplayJournal);
        var normalized = new Dictionary<string, VisioSessionCommandReplayEntry>(StringComparer.Ordinal);
        foreach (var entry in commandReplayJournal)
        {
            ArgumentNullException.ThrowIfNull(entry);
            if (normalized.Count >= VisioSessionOperationJournal.MaximumEntries)
            {
                throw new ArgumentException("Recovery manifest command replay journal exceeds the allowed entry limit.", parameterName);
            }

            if (!normalized.TryAdd(entry.RequestId, entry))
            {
                throw new ArgumentException("Recovery manifest command replay journal cannot contain duplicate request identifiers.", parameterName);
            }
        }

        return Array.AsReadOnly(normalized.Values.OrderBy(entry => entry.RequestId, StringComparer.Ordinal).ToArray());
    }
}

public sealed record VisioSessionSnapshot(
    VisioSessionKey Key,
    VisioSessionState State,
    VisioSessionDocument? Document,
    string? LastPlanHash,
    string? LastSavedPath,
    IReadOnlyList<VisioSessionOperationJournalEntry> OperationJournal,
    VisioSessionRecoveryManifest? RecoveryManifest);

public sealed record VisioSessionApplyResult(VisioSessionSnapshot Snapshot, bool Replayed);

public interface IVisioSessionBackend
{
    string NormalizeOutputPath(string outputPath);
    Task<VisioSessionDocument> OpenOrCreateAsync(VisioSessionKey sessionKey, CancellationToken cancellationToken = default);
    Task ApplyPlanAsync(VisioSessionDocument document, DiagramDocument plan, CancellationToken cancellationToken = default);
    Task ApplyPlanDiffAsync(VisioSessionDocument document, DiagramDocument plan, CancellationToken cancellationToken = default);
    Task<VisioSessionDocument> SaveAsAsync(VisioSessionDocument document, string outputPath, CancellationToken cancellationToken = default);
    Task CloseAsync(VisioSessionDocument document, CancellationToken cancellationToken = default);
    Task<VisioSessionDocument> RecoverAsync(VisioSessionKey sessionKey, VisioSessionRecoveryManifest manifest, CancellationToken cancellationToken = default);
}
