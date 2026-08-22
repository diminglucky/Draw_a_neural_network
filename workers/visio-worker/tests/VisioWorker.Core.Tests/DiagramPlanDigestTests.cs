using VisioWorker.Core;

namespace VisioWorker.Core.Tests;

public sealed class DiagramPlanDigestTests
{
    [Fact]
    public void Shape_data_keys_and_values_are_structurally_distinct_in_the_canonical_digest()
    {
        var valueContainsDelimiter = DocumentWithShapeData(new Dictionary<string, string>
        {
            ["a"] = "b\u001fc",
        });
        var keyContainsDelimiter = DocumentWithShapeData(new Dictionary<string, string>
        {
            ["a\u001fb"] = "c",
        });

        Assert.NotEqual(
            DiagramPlanDigest.Compute(valueContainsDelimiter),
            DiagramPlanDigest.Compute(keyContainsDelimiter));
    }

    private static DiagramDocument DocumentWithShapeData(IReadOnlyDictionary<string, string> shapeData) =>
        new(
            "digest",
            [],
            [new VisioNode("node", "kind", "label", null, 0, 0, 0, 1, 1, "", "", "", 1, 0, false, null, shapeData)],
            []);
}
