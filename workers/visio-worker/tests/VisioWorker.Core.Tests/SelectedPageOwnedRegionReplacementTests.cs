using VisioWorker.Core;
using VisioWorker.Live;

namespace VisioWorker.Core.Tests;

public sealed class SelectedPageOwnedRegionReplacementTests
{
    private const string FinalNamespace = "agent.region.final";
    private const string StagingNamespace = "agent.region.staging";

    [Fact]
    public void Successful_replacement_promotes_new_shapes_before_deleting_only_captured_old_shapes()
    {
        var mutation = new RecordingMutation();

        SelectedPageOwnedRegionReplacement.Execute(mutation, Prepared(), FinalNamespace, StagingNamespace);

        Assert.Equal(
        [
            "delete-namespace:agent.region.staging",
            "read-owned:agent.region.final",
            "draw",
            "tag:agent.region.staging:30,31",
            "promote:agent.region.staging->agent.region.final:30,31",
            "delete-ids:10,11",
        ], mutation.Events);
        Assert.Equal([20, 30, 31, 40], mutation.ShapeIds.Order());
        Assert.Equal(FinalNamespace, mutation.OwnershipById[30]);
        Assert.Equal(FinalNamespace, mutation.OwnershipById[31]);
        Assert.DoesNotContain(40, mutation.OwnershipById.Keys);
        Assert.DoesNotContain(mutation.Events, item => item.Contains(":40", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("draw")]
    [InlineData("tag")]
    [InlineData("promote")]
    public void Pre_promotion_failure_cleans_only_new_shapes_and_preserves_the_old_region(string failurePoint)
    {
        var mutation = new RecordingMutation { FailurePoint = failurePoint };

        Assert.Throws<WorkerProtocolException>(() =>
            SelectedPageOwnedRegionReplacement.Execute(mutation, Prepared(), FinalNamespace, StagingNamespace));

        Assert.Contains(10, mutation.ShapeIds);
        Assert.Contains(11, mutation.ShapeIds);
        Assert.Contains(20, mutation.ShapeIds);
        Assert.Contains(40, mutation.ShapeIds);
        Assert.DoesNotContain(30, mutation.ShapeIds);
        Assert.DoesNotContain(31, mutation.ShapeIds);
        Assert.DoesNotContain(40, mutation.OwnershipById.Keys);
        Assert.DoesNotContain(mutation.Events, item => item.Contains(":40", StringComparison.Ordinal));
        Assert.DoesNotContain("delete-ids:10,11", mutation.Events);
    }

    [Fact]
    public void Empty_draw_fails_before_old_shape_deletion()
    {
        var mutation = new RecordingMutation { DrawnIds = new HashSet<int>() };

        var error = Assert.Throws<WorkerProtocolException>(() =>
            SelectedPageOwnedRegionReplacement.Execute(mutation, Prepared(), FinalNamespace, StagingNamespace));

        Assert.Contains("no shapes", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal([10, 11, 20, 40], mutation.ShapeIds.Order());
        Assert.DoesNotContain("delete-ids:10,11", mutation.Events);
    }

    [Fact]
    public void Old_shape_cleanup_failure_retains_the_promoted_replacement()
    {
        var mutation = new RecordingMutation { FailurePoint = "delete-old" };

        Assert.Throws<WorkerProtocolException>(() =>
            SelectedPageOwnedRegionReplacement.Execute(mutation, Prepared(), FinalNamespace, StagingNamespace));

        Assert.Contains(10, mutation.ShapeIds);
        Assert.Contains(11, mutation.ShapeIds);
        Assert.Contains(30, mutation.ShapeIds);
        Assert.Contains(31, mutation.ShapeIds);
        Assert.Equal(FinalNamespace, mutation.OwnershipById[30]);
        Assert.Equal(FinalNamespace, mutation.OwnershipById[31]);
        Assert.Equal(1, mutation.DeleteOldAttempts);
    }

    private static PreparedSelectedPageRegion Prepared() => new(
        new SelectedPageTarget("document-1", "page-1", new string('a', 64), new string('b', 64), 7),
        new DiagramDocument("replacement", [], [], []));

    private sealed class RecordingMutation : ISelectedPageShapeMutation
    {
        public HashSet<int> ShapeIds { get; } = [10, 11, 20];
        public Dictionary<int, string> OwnershipById { get; } = new()
        {
            [10] = FinalNamespace,
            [11] = FinalNamespace,
        };
        public IReadOnlySet<int> DrawnIds { get; init; } = new HashSet<int> { 30, 31 };
        public string? FailurePoint { get; init; }
        public List<string> Events { get; } = [];
        public int DeleteOldAttempts { get; private set; }

        public IReadOnlySet<int> ReadOwnedShapeIds(string ownershipNamespace)
        {
            Events.Add($"read-owned:{ownershipNamespace}");
            return OwnershipById.Where(item => string.Equals(item.Value, ownershipNamespace, StringComparison.Ordinal)).Select(item => item.Key).ToHashSet();
        }

        public void DeleteOwnedShapes(string ownershipNamespace)
        {
            Events.Add($"delete-namespace:{ownershipNamespace}");
            DeleteShapesCore(OwnershipById.Where(item => string.Equals(item.Value, ownershipNamespace, StringComparison.Ordinal)).Select(item => item.Key).ToArray());
        }

        public void DrawPrepared(PreparedSelectedPageRegion preparedRegion, SelectedPageShapeCreationJournal creationJournal)
        {
            Events.Add("draw");
            foreach (var id in FailurePoint == "draw" ? DrawnIds.Take(1) : DrawnIds)
            {
                ShapeIds.Add(id);
                creationJournal.Record(id);
            }
            ShapeIds.Add(40);
            if (FailurePoint == "draw") throw new WorkerProtocolException("draw failed");
        }

        public void TagAndVerifyShapes(IReadOnlySet<int> shapeIds, string ownershipNamespace, DiagramDocument plan)
        {
            Events.Add($"tag:{ownershipNamespace}:{Ids(shapeIds)}");
            foreach (var id in shapeIds) OwnershipById[id] = ownershipNamespace;
            if (FailurePoint == "tag") throw new WorkerProtocolException("tag failed");
        }

        public void PromoteAndVerifyShapes(IReadOnlySet<int> shapeIds, string stagingNamespace, string finalNamespace)
        {
            Events.Add($"promote:{stagingNamespace}->{finalNamespace}:{Ids(shapeIds)}");
            foreach (var id in shapeIds.Take(FailurePoint == "promote" ? 1 : shapeIds.Count)) OwnershipById[id] = finalNamespace;
            if (FailurePoint == "promote") throw new WorkerProtocolException("promote failed");
        }

        public void DeleteShapes(IReadOnlySet<int> shapeIds)
        {
            Events.Add($"delete-ids:{Ids(shapeIds)}");
            if (shapeIds.Contains(10) || shapeIds.Contains(11))
            {
                DeleteOldAttempts++;
                if (FailurePoint == "delete-old") throw new WorkerProtocolException("old cleanup failed");
            }
            DeleteShapesCore(shapeIds);
        }

        private void DeleteShapesCore(IEnumerable<int> shapeIds)
        {
            foreach (var id in shapeIds)
            {
                ShapeIds.Remove(id);
                OwnershipById.Remove(id);
            }
        }

        private static string Ids(IEnumerable<int> ids) => string.Join(',', ids.Order());
    }
}
