using VisioWorker.Core;
using System.Collections.Frozen;

namespace VisioWorker.Live;

internal sealed class SelectedPageShapeCreationJournal
{
    private readonly HashSet<int> _shapeIds = [];

    internal IReadOnlySet<int> ShapeIds => _shapeIds.ToFrozenSet();

    internal void Record(int shapeId) => _shapeIds.Add(shapeId);
}

internal interface ISelectedPageShapeMutation
{
    IReadOnlySet<int> ReadOwnedShapeIds(string ownershipNamespace);
    void DeleteOwnedShapes(string ownershipNamespace);
    void DrawPrepared(PreparedSelectedPageRegion preparedRegion, SelectedPageShapeCreationJournal creationJournal);
    void TagAndVerifyShapes(IReadOnlySet<int> shapeIds, string ownershipNamespace, DiagramDocument plan);
    void PromoteAndVerifyShapes(IReadOnlySet<int> shapeIds, string stagingNamespace, string finalNamespace);
    void DeleteShapes(IReadOnlySet<int> shapeIds);
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
                if (createdShapeIds.Count > 0) mutation.DeleteShapes(createdShapeIds);
            }
            catch (Exception cleanupError)
            {
                throw new WorkerProtocolException(
                    "Selected-page staged replacement failed and cleanup of newly created shapes also failed.",
                    new AggregateException(primaryError, cleanupError));
            }
            throw;
        }

        mutation.DeleteShapes(oldOwnedShapeIds);
    }
}
