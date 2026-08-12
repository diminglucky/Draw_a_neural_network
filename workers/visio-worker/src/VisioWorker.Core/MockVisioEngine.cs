using System.Text.Json;

namespace VisioWorker.Core;

public sealed class MockVisioEngine : IVisioEngine
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public async Task<ReadbackResult> RenderAsync(DiagramDocument document, string outputPath, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(document);
        if (!outputPath.EndsWith(".vsdx", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Mock output must end with .vsdx.");

        var directory = Path.GetDirectoryName(Path.GetFullPath(outputPath));
        if (string.IsNullOrWhiteSpace(directory)) throw new InvalidOperationException("Mock output directory is missing.");
        Directory.CreateDirectory(directory);

        var artifact = new
        {
            kind = "synapse-visio-mock",
            title = document.Title,
            stages = document.StageLabels,
            nodes = document.Nodes.Select(node => new { node.Id, node.Kind, node.Label, node.Stage, node.XInches, node.YInches, node.WidthInches, node.HeightInches, node.ShapeData }),
            connectors = document.Connectors.Select(edge => new { edge.Id, edge.Source, edge.Target, edge.Kind, edge.Points }),
        };
        await File.WriteAllTextAsync(outputPath, JsonSerializer.Serialize(artifact, JsonOptions), cancellationToken);
        return new ReadbackResult(true, document.Nodes.Count, document.Connectors.Count);
    }
}
