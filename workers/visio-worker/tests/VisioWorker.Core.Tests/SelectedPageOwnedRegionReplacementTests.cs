using VisioWorker.Core;
using VisioWorker.Live;

namespace VisioWorker.Core.Tests;

public sealed class SelectedPageOwnedRegionReplacementTests
{
    private const string FinalNamespace = "agent.region.final";
    private const string StagingNamespace = "agent.region.staging";

    [Fact]
    public void Creation_journal_rejects_invalid_entries_and_exposes_canonical_semantics()
    {
        var journal = new SelectedPageShapeCreationJournal();
        journal.Record(21, ["semantic:b", "semantic:a"], SelectedPageShapeRole.Primary);

        var entry = Assert.Single(journal.Entries);
        Assert.Equal(21, entry.ShapeId);
        Assert.Equal(["semantic:a", "semantic:b"], entry.SemanticIds);
        Assert.Equal(SelectedPageShapeRole.Primary, entry.Role);
        Assert.Throws<WorkerProtocolException>(() =>
            journal.Record(21, ["semantic:c"], SelectedPageShapeRole.Label));
        Assert.Throws<WorkerProtocolException>(() =>
            new SelectedPageShapeCreationJournal().Record(22, [], SelectedPageShapeRole.Primary));
        Assert.Throws<WorkerProtocolException>(() =>
            new SelectedPageShapeCreationJournal().Record(23, ["semantic:a", " "], SelectedPageShapeRole.Primary));
        Assert.Throws<WorkerProtocolException>(() =>
            new SelectedPageShapeCreationJournal().Record(24, ["semantic:a", "semantic:a"], SelectedPageShapeRole.Primary));
    }

    [Fact]
    public void Successful_replacement_promotes_new_shapes_before_deleting_only_captured_old_shapes()
    {
        var mutation = new RecordingMutation();
        var prepared = Prepared();

        var manifest = SelectedPageOwnedRegionReplacement.Execute(mutation, prepared, FinalNamespace, StagingNamespace);

        Assert.Equal(
        [
            "delete-namespace:agent.region.staging",
            "read-owned:agent.region.final",
            "draw",
            "tag:agent.region.staging:30,31",
            "promote:agent.region.staging->agent.region.final:30,31",
            "revalidate:page-1",
            "delete-ids:10,11",
        ], mutation.Events);
        Assert.Equal([20, 30, 31, 40], mutation.ShapeIds.Order());
        Assert.Equal(FinalNamespace, mutation.OwnershipById[30]);
        Assert.Equal(FinalNamespace, mutation.OwnershipById[31]);
        Assert.DoesNotContain(40, mutation.OwnershipById.Keys);
        Assert.All(mutation.StagedShapeIdSets, shapeIds => Assert.DoesNotContain(40, shapeIds));
        Assert.All(mutation.PromotedShapeIdSets, shapeIds => Assert.DoesNotContain(40, shapeIds));
        Assert.All(mutation.DeletedShapeIdSets, shapeIds => Assert.DoesNotContain(40, shapeIds));
        Assert.Equal(prepared.Target, manifest.Target);
        Assert.Equal(FinalNamespace, manifest.OwnershipNamespace);
        Assert.Equal([30, 31], manifest.Entries.Select(entry => entry.ShapeId));
        Assert.Equal(["semantic:primary"], manifest.Entries[0].SemanticIds);
        Assert.Equal(SelectedPageShapeRole.Primary, manifest.Entries[0].Role);
        Assert.Equal(["semantic:label"], manifest.Entries[1].SemanticIds);
        Assert.Equal(SelectedPageShapeRole.Label, manifest.Entries[1].Role);
        Assert.DoesNotContain(manifest.Entries, entry => entry.ShapeId == 40);
    }

    [Fact]
    public void Successful_replacement_cleans_stale_agent_namespaces_but_keeps_unowned_shapes()
    {
        var mutation = new RecordingMutation
        {
            AgentOwnedShapeIds = new HashSet<int> { 12, 13 },
        };
        mutation.ShapeIds.UnionWith(mutation.AgentOwnedShapeIds);
        mutation.OwnershipById[12] = "agent:old-figure";
        mutation.OwnershipById[13] = "agent:another-old-figure";

        SelectedPageOwnedRegionReplacement.Execute(mutation, Prepared(), FinalNamespace, StagingNamespace);

        Assert.Equal("delete-ids:10,11,12,13", mutation.Events.Single(item => item.StartsWith("delete-ids:", StringComparison.Ordinal)));
        Assert.Contains(20, mutation.ShapeIds);
        Assert.DoesNotContain(12, mutation.ShapeIds);
        Assert.DoesNotContain(13, mutation.ShapeIds);
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
        Assert.All(mutation.StagedShapeIdSets, shapeIds => Assert.DoesNotContain(40, shapeIds));
        Assert.All(mutation.PromotedShapeIdSets, shapeIds => Assert.DoesNotContain(40, shapeIds));
        Assert.All(mutation.DeletedShapeIdSets, shapeIds => Assert.DoesNotContain(40, shapeIds));
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
    public void Active_target_change_after_promotion_retains_both_regions_and_skips_old_shape_deletion()
    {
        var mutation = new RecordingMutation { FailurePoint = "revalidate" };

        var error = Assert.Throws<WorkerProtocolException>(() =>
            SelectedPageOwnedRegionReplacement.Execute(mutation, Prepared(), FinalNamespace, StagingNamespace));

        Assert.Contains("changed", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(10, mutation.ShapeIds);
        Assert.Contains(11, mutation.ShapeIds);
        Assert.Contains(30, mutation.ShapeIds);
        Assert.Contains(31, mutation.ShapeIds);
        Assert.Equal(FinalNamespace, mutation.OwnershipById[30]);
        Assert.Equal(FinalNamespace, mutation.OwnershipById[31]);
        Assert.Contains("revalidate:page-1", mutation.Events);
        Assert.DoesNotContain("delete-ids:10,11", mutation.Events);
    }

    [Fact]
    public void Partial_old_shape_cleanup_reports_complete_outcome_and_retains_promoted_replacement()
    {
        var mutation = new RecordingMutation { FailedDeletionIds = new HashSet<int> { 11 } };

        var error = Assert.Throws<WorkerProtocolException>(() =>
            SelectedPageOwnedRegionReplacement.Execute(mutation, Prepared(), FinalNamespace, StagingNamespace));

        var failure = Assert.IsType<SelectedPageShapeDeletionFailure>(error.InnerException);
        Assert.True(failure.ReplacementPromoted);
        Assert.Null(failure.PrimaryError);
        Assert.Equal([10, 11], failure.Outcome.RequestedShapeIds.Order());
        Assert.Equal([10], failure.Outcome.DeletedShapeIds.Order());
        Assert.Empty(failure.Outcome.MissingShapeIds);
        Assert.Equal([11], failure.Outcome.FailedShapeIds.Order());
        Assert.DoesNotContain(10, mutation.ShapeIds);
        Assert.Contains(11, mutation.ShapeIds);
        Assert.Contains(30, mutation.ShapeIds);
        Assert.Contains(31, mutation.ShapeIds);
        Assert.Equal(FinalNamespace, mutation.OwnershipById[30]);
        Assert.Equal(FinalNamespace, mutation.OwnershipById[31]);
    }

    [Fact]
    public void Failed_pre_promotion_cleanup_preserves_primary_failure_and_exposes_cleanup_outcome()
    {
        var mutation = new RecordingMutation
        {
            FailurePoint = "tag",
            FailedDeletionIds = new HashSet<int> { 31 },
        };

        var error = Assert.Throws<WorkerProtocolException>(() =>
            SelectedPageOwnedRegionReplacement.Execute(mutation, Prepared(), FinalNamespace, StagingNamespace));

        var failure = Assert.IsType<SelectedPageShapeDeletionFailure>(error.InnerException);
        Assert.False(failure.ReplacementPromoted);
        Assert.IsType<WorkerProtocolException>(failure.PrimaryError);
        Assert.Equal([30, 31], failure.Outcome.RequestedShapeIds.Order());
        Assert.Equal([30], failure.Outcome.DeletedShapeIds.Order());
        Assert.Empty(failure.Outcome.MissingShapeIds);
        Assert.Equal([31], failure.Outcome.FailedShapeIds.Order());
        Assert.Contains(10, mutation.ShapeIds);
        Assert.Contains(11, mutation.ShapeIds);
        Assert.DoesNotContain(30, mutation.ShapeIds);
        Assert.Contains(31, mutation.ShapeIds);
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
        public IReadOnlySet<int> AgentOwnedShapeIds { get; init; } = new HashSet<int>();
        public string? FailurePoint { get; init; }
        public IReadOnlySet<int> FailedDeletionIds { get; init; } = new HashSet<int>();
        public List<string> Events { get; } = [];
        public List<IReadOnlySet<int>> StagedShapeIdSets { get; } = [];
        public List<IReadOnlySet<int>> PromotedShapeIdSets { get; } = [];
        public List<IReadOnlySet<int>> DeletedShapeIdSets { get; } = [];

        public IReadOnlySet<int> ReadOwnedShapeIds(string ownershipNamespace)
        {
            Events.Add($"read-owned:{ownershipNamespace}");
            return OwnershipById.Where(item => string.Equals(item.Value, ownershipNamespace, StringComparison.Ordinal)).Select(item => item.Key).ToHashSet();
        }

        public IReadOnlySet<int> ReadAgentOwnedShapeIds() => AgentOwnedShapeIds;

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
                creationJournal.Record(
                    id,
                    [id == 30 ? "semantic:primary" : "semantic:label"],
                    id == 30 ? SelectedPageShapeRole.Primary : SelectedPageShapeRole.Label);
            }
            ShapeIds.Add(40);
            if (FailurePoint == "draw") throw new WorkerProtocolException("draw failed");
        }

        public void TagAndVerifyShapes(IReadOnlyList<SelectedPageShapeCreationEntry> entries, string ownershipNamespace)
        {
            var shapeIds = entries.Select(entry => entry.ShapeId).ToHashSet();
            StagedShapeIdSets.Add(shapeIds.ToHashSet());
            Events.Add($"tag:{ownershipNamespace}:{Ids(shapeIds)}");
            foreach (var id in shapeIds) OwnershipById[id] = ownershipNamespace;
            if (FailurePoint == "tag") throw new WorkerProtocolException("tag failed");
        }

        public void PromoteAndVerifyShapes(IReadOnlySet<int> shapeIds, string stagingNamespace, string finalNamespace)
        {
            PromotedShapeIdSets.Add(shapeIds.ToHashSet());
            Events.Add($"promote:{stagingNamespace}->{finalNamespace}:{Ids(shapeIds)}");
            foreach (var id in shapeIds.Take(FailurePoint == "promote" ? 1 : shapeIds.Count)) OwnershipById[id] = finalNamespace;
            if (FailurePoint == "promote") throw new WorkerProtocolException("promote failed");
        }

        public void RevalidateActiveTarget(SelectedPageTarget target)
        {
            Events.Add($"revalidate:{target.PageId}");
            if (FailurePoint == "revalidate") throw new WorkerProtocolException("Selected Visio target changed before old-shape cleanup.");
        }

        public SelectedPageShapeDeletionOutcome DeleteShapes(IReadOnlySet<int> shapeIds)
        {
            DeletedShapeIdSets.Add(shapeIds.ToHashSet());
            Events.Add($"delete-ids:{Ids(shapeIds)}");
            var deleted = new HashSet<int>();
            var missing = new HashSet<int>();
            var failed = new HashSet<int>();
            foreach (var id in shapeIds.Order())
            {
                if (!ShapeIds.Contains(id))
                {
                    missing.Add(id);
                    continue;
                }
                if (FailedDeletionIds.Contains(id))
                {
                    failed.Add(id);
                    continue;
                }
                DeleteShapesCore([id]);
                deleted.Add(id);
            }
            return new SelectedPageShapeDeletionOutcome(shapeIds, deleted, missing, failed);
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
