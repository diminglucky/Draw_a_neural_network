using VisioWorker.Core;
using System.Collections.Frozen;

namespace VisioWorker.Live;

internal enum SelectedPageShapeRole
{
    Primary,
    Auxiliary,
    Label,
    Annotation,
    Connector,
    Title,
}

internal sealed record SelectedPageShapeCreationEntry(
    int ShapeId,
    IReadOnlyList<string> SemanticIds,
    SelectedPageShapeRole Role);

internal sealed record SelectedPagePromotedRegionManifest(
    SelectedPageTarget Target,
    string OwnershipNamespace,
    IReadOnlyList<SelectedPageShapeCreationEntry> Entries);

internal sealed class SelectedPageShapeCreationJournal
{
    private readonly Dictionary<int, SelectedPageShapeCreationEntry> _entries = [];

    internal IReadOnlyList<SelectedPageShapeCreationEntry> Entries =>
        Array.AsReadOnly(_entries.Values.OrderBy(entry => entry.ShapeId).ToArray());

    internal IReadOnlySet<int> ShapeIds => _entries.Keys.ToFrozenSet();

    internal void Record(int shapeId, IEnumerable<string> semanticIds, SelectedPageShapeRole role)
    {
        ArgumentNullException.ThrowIfNull(semanticIds);
        var canonical = semanticIds
            .Select(value => value?.Trim() ?? string.Empty)
            .Order(StringComparer.Ordinal)
            .ToArray();
        if (shapeId <= 0
            || canonical.Length == 0
            || canonical.Any(string.IsNullOrWhiteSpace)
            || canonical.Distinct(StringComparer.Ordinal).Count() != canonical.Length
            || !_entries.TryAdd(
                shapeId,
                new SelectedPageShapeCreationEntry(shapeId, Array.AsReadOnly(canonical), role)))
        {
            throw new WorkerProtocolException("Selected-page renderer reported an invalid shape creation manifest entry.");
        }
    }
}

internal sealed class SelectedPageShapeDeletionOutcome
{
    internal SelectedPageShapeDeletionOutcome(
        IEnumerable<int> requestedShapeIds,
        IEnumerable<int> deletedShapeIds,
        IEnumerable<int> missingShapeIds,
        IEnumerable<int> failedShapeIds)
    {
        RequestedShapeIds = requestedShapeIds.ToFrozenSet();
        DeletedShapeIds = deletedShapeIds.ToFrozenSet();
        MissingShapeIds = missingShapeIds.ToFrozenSet();
        FailedShapeIds = failedShapeIds.ToFrozenSet();

        var classified = DeletedShapeIds.Concat(MissingShapeIds).Concat(FailedShapeIds).ToHashSet();
        if (!classified.SetEquals(RequestedShapeIds)
            || DeletedShapeIds.Overlaps(MissingShapeIds)
            || DeletedShapeIds.Overlaps(FailedShapeIds)
            || MissingShapeIds.Overlaps(FailedShapeIds))
        {
            throw new ArgumentException("Every requested shape ID must have exactly one deletion outcome.");
        }
    }

    internal IReadOnlySet<int> RequestedShapeIds { get; }
    internal IReadOnlySet<int> DeletedShapeIds { get; }
    internal IReadOnlySet<int> MissingShapeIds { get; }
    internal IReadOnlySet<int> FailedShapeIds { get; }
}

internal sealed class SelectedPageShapeDeletionFailure : Exception
{
    internal SelectedPageShapeDeletionFailure(
        string message,
        SelectedPageShapeDeletionOutcome outcome,
        bool replacementPromoted,
        Exception? primaryError = null,
        Exception? deletionError = null)
        : base(message, deletionError ?? primaryError)
    {
        Outcome = outcome;
        ReplacementPromoted = replacementPromoted;
        PrimaryError = primaryError;
        DeletionError = deletionError;
    }

    internal SelectedPageShapeDeletionOutcome Outcome { get; }
    internal bool ReplacementPromoted { get; }
    internal Exception? PrimaryError { get; }
    internal Exception? DeletionError { get; }
}

internal interface ISelectedPageShapeMutation
{
    IReadOnlySet<int> ReadOwnedShapeIds(string ownershipNamespace);
    void DeleteOwnedShapes(string ownershipNamespace);
    void DrawPrepared(PreparedSelectedPageRegion preparedRegion, SelectedPageShapeCreationJournal creationJournal);
    void TagAndVerifyShapes(IReadOnlyList<SelectedPageShapeCreationEntry> entries, string ownershipNamespace);
    void PromoteAndVerifyShapes(IReadOnlySet<int> shapeIds, string stagingNamespace, string finalNamespace);
    void RevalidateActiveTarget(SelectedPageTarget target);
    SelectedPageShapeDeletionOutcome DeleteShapes(IReadOnlySet<int> shapeIds);
}

internal static class SelectedPageOwnedRegionReplacement
{
    internal static SelectedPagePromotedRegionManifest Execute(
        ISelectedPageShapeMutation mutation,
        PreparedSelectedPageRegion preparedRegion,
        string finalNamespace,
        string stagingNamespace)
    {
        ArgumentNullException.ThrowIfNull(mutation);
        ArgumentNullException.ThrowIfNull(preparedRegion);
        ArgumentException.ThrowIfNullOrWhiteSpace(finalNamespace);
        ArgumentException.ThrowIfNullOrWhiteSpace(stagingNamespace);
        if (string.Equals(finalNamespace, stagingNamespace, StringComparison.Ordinal))
        {
            throw new ArgumentException("The staging ownership namespace must differ from the final namespace.", nameof(stagingNamespace));
        }

        mutation.DeleteOwnedShapes(stagingNamespace);
        var oldOwnedShapeIds = mutation.ReadOwnedShapeIds(finalNamespace).ToHashSet();
        var creationJournal = new SelectedPageShapeCreationJournal();

        try
        {
            mutation.DrawPrepared(preparedRegion, creationJournal);
            var newEntries = creationJournal.Entries;
            var newShapeIds = creationJournal.ShapeIds;
            if (newShapeIds.Count == 0)
            {
                throw new WorkerProtocolException("Selected-page replacement produced no shapes.");
            }

            mutation.TagAndVerifyShapes(newEntries, stagingNamespace);
            mutation.PromoteAndVerifyShapes(newShapeIds, stagingNamespace, finalNamespace);
        }
        catch (Exception primaryError)
        {
            try
            {
                var createdShapeIds = creationJournal.ShapeIds;
                if (createdShapeIds.Count > 0)
                {
                    var cleanupOutcome = mutation.DeleteShapes(createdShapeIds);
                    if (cleanupOutcome.FailedShapeIds.Count > 0)
                    {
                        throw DeletionFailure(
                            "Selected-page staged replacement failed and cleanup of newly created shapes was incomplete.",
                            cleanupOutcome,
                            replacementPromoted: false,
                            primaryError);
                    }
                }
            }
            catch (WorkerProtocolException cleanupError) when (cleanupError.InnerException is SelectedPageShapeDeletionFailure)
            {
                throw;
            }
            catch (Exception cleanupError)
            {
                var requestedShapeIds = creationJournal.ShapeIds;
                var unknownOutcome = new SelectedPageShapeDeletionOutcome(
                    requestedShapeIds,
                    [],
                    [],
                    requestedShapeIds);
                throw DeletionFailure(
                    "Selected-page staged replacement failed and cleanup of newly created shapes could not report a complete outcome.",
                    unknownOutcome,
                    replacementPromoted: false,
                    primaryError,
                    cleanupError);
            }
            throw;
        }

        mutation.RevalidateActiveTarget(preparedRegion.Target);
        SelectedPageShapeDeletionOutcome oldCleanupOutcome;
        try
        {
            oldCleanupOutcome = mutation.DeleteShapes(oldOwnedShapeIds);
        }
        catch (Exception cleanupError)
        {
            var unknownOutcome = new SelectedPageShapeDeletionOutcome(
                oldOwnedShapeIds,
                [],
                [],
                oldOwnedShapeIds);
            throw DeletionFailure(
                "Selected-page replacement was promoted, but old-shape cleanup could not report a complete outcome.",
                unknownOutcome,
                replacementPromoted: true,
                deletionError: cleanupError);
        }
        if (oldCleanupOutcome.FailedShapeIds.Count > 0)
        {
            throw DeletionFailure(
                "Selected-page replacement was promoted, but old-shape cleanup was incomplete.",
                oldCleanupOutcome,
                replacementPromoted: true);
        }

        return new SelectedPagePromotedRegionManifest(
            preparedRegion.Target,
            finalNamespace,
            Array.AsReadOnly(creationJournal.Entries.ToArray()));
    }

    private static WorkerProtocolException DeletionFailure(
        string message,
        SelectedPageShapeDeletionOutcome outcome,
        bool replacementPromoted,
        Exception? primaryError = null,
        Exception? deletionError = null)
    {
        return new WorkerProtocolException(
            message,
            new SelectedPageShapeDeletionFailure(
                message,
                outcome,
                replacementPromoted,
                primaryError,
                deletionError));
    }
}
