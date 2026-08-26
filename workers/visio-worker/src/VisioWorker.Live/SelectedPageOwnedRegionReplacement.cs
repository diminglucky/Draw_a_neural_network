using VisioWorker.Core;
using System.Collections.Frozen;

namespace VisioWorker.Live;

internal sealed class SelectedPageShapeCreationJournal
{
    private readonly HashSet<int> _shapeIds = [];

    internal IReadOnlySet<int> ShapeIds => _shapeIds.ToFrozenSet();

    internal void Record(int shapeId) => _shapeIds.Add(shapeId);
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
    void TagAndVerifyShapes(IReadOnlySet<int> shapeIds, string ownershipNamespace, DiagramDocument plan);
    void PromoteAndVerifyShapes(IReadOnlySet<int> shapeIds, string stagingNamespace, string finalNamespace);
    void RevalidateActiveTarget(SelectedPageTarget target);
    SelectedPageShapeDeletionOutcome DeleteShapes(IReadOnlySet<int> shapeIds);
}

internal static class SelectedPageOwnedRegionReplacement
{
    internal static void Execute(
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
            var newShapeIds = creationJournal.ShapeIds;
            if (newShapeIds.Count == 0)
            {
                throw new WorkerProtocolException("Selected-page replacement produced no shapes.");
            }

            mutation.TagAndVerifyShapes(newShapeIds, stagingNamespace, preparedRegion.Plan);
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
