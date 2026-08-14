namespace VisioWorker.Core;

public static class ReadbackValidator
{
    public static ReadbackResult Validate(
        VisioFigurePlan plan,
        IReadOnlyList<ReadbackPrimitive> actualPrimitives,
        IReadOnlyList<string> actualConnectorIds,
        int? shapeCount = null)
    {
        ArgumentNullException.ThrowIfNull(plan);
        ArgumentNullException.ThrowIfNull(actualPrimitives);
        ArgumentNullException.ThrowIfNull(actualConnectorIds);

        var expectedPrimitives = plan.PrimitiveGroups
            .SelectMany(group => group.PrimitiveIds)
            .OrderBy(id => id, StringComparer.Ordinal)
            .ToArray();
        var expectedConnectors = plan.Connectors
            .Select(connector => connector.Id)
            .OrderBy(id => id, StringComparer.Ordinal)
            .ToArray();
        var actualPrimitiveMap = actualPrimitives
            .GroupBy(primitive => primitive.Id, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var actualPrimitiveIds = actualPrimitiveMap.Keys.OrderBy(id => id, StringComparer.Ordinal).ToArray();
        var actualConnectorSet = actualConnectorIds.ToHashSet(StringComparer.Ordinal);
        var actualConnectors = actualConnectorSet.OrderBy(id => id, StringComparer.Ordinal).ToArray();
        var missingPrimitiveIds = expectedPrimitives.Where(id => !actualPrimitiveMap.ContainsKey(id)).ToArray();
        var missingConnectorIds = expectedConnectors.Where(id => !actualConnectorSet.Contains(id)).ToArray();
        var shapeDataFailures = new List<string>();

        foreach (var group in plan.PrimitiveGroups)
        {
            foreach (var primitiveId in group.PrimitiveIds)
            {
                if (!actualPrimitiveMap.TryGetValue(primitiveId, out var actual)) continue;
                foreach (var expectedProperty in ExpectedShapeData(group, primitiveId))
                {
                    if (!actual.ShapeData.TryGetValue(expectedProperty.Key, out var actualValue)
                        || !string.Equals(actualValue, expectedProperty.Value, StringComparison.Ordinal))
                    {
                        var renderedActual = actualValue ?? "<missing>";
                        shapeDataFailures.Add($"{primitiveId}:{expectedProperty.Key} expected '{expectedProperty.Value}' actual '{renderedActual}'");
                    }
                }
            }
        }

        return new ReadbackResult(
            missingPrimitiveIds.Length == 0 && missingConnectorIds.Length == 0 && shapeDataFailures.Count == 0,
            shapeCount ?? actualPrimitives.Count,
            actualConnectorIds.Count,
            expectedPrimitives,
            actualPrimitiveIds,
            missingPrimitiveIds,
            expectedConnectors,
            actualConnectors,
            missingConnectorIds,
            shapeDataFailures);
    }

    public static ReadbackResult Legacy(int shapeCount, int connectorCount) => new(
        true,
        shapeCount,
        connectorCount,
        [],
        [],
        [],
        [],
        [],
        [],
        []);

    private static IEnumerable<KeyValuePair<string, string>> ExpectedShapeData(VisioPrimitiveGroup group, string primitiveId)
    {
        foreach (var property in group.ShapeData) yield return property;
        yield return new KeyValuePair<string, string>("synapse.primitiveId", primitiveId);
    }
}
