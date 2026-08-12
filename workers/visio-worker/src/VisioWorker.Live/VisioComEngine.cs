using System.Runtime.InteropServices;
using VisioWorker.Core;

namespace VisioWorker.Live;

public sealed record VisioComEngineOptions(bool AttachToRunning = false, bool Visible = false, string OutputRoot = "");

public sealed class VisioComEngine : IVisioEngine, IAsyncDisposable
{
    private const double PageHeightInches = 15.0;
    private readonly VisioComEngineOptions _options;
    private readonly ComStaRunner _runner;

    public VisioComEngine(VisioComEngineOptions options)
    {
        _options = options;
        _runner = new ComStaRunner();
    }

    public async Task<ReadbackResult> RenderAsync(DiagramDocument document, string outputPath, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(document);
        var finalPath = PathPolicy.ValidateOutputPath(outputPath, _options.OutputRoot);
        Directory.CreateDirectory(Path.GetDirectoryName(finalPath)!);
        var temporaryPath = finalPath + $".{Guid.NewGuid():N}.partial.vsdx";
        try
        {
            var result = await _runner.InvokeAsync(() => RenderOnComThread(document, temporaryPath)).WaitAsync(cancellationToken).ConfigureAwait(false);
            if (!result.Valid || !File.Exists(temporaryPath)) throw new WorkerProtocolException("Visio readback did not validate the temporary output");
            File.Move(temporaryPath, finalPath, overwrite: true);
            return result with { DiagnosticPath = finalPath };
        }
        catch (COMException error)
        {
            throw new WorkerProtocolException($"Visio COM operation failed: {error.Message}", error);
        }
        finally
        {
            TryDelete(temporaryPath);
        }
    }

    public ValueTask DisposeAsync() => _runner.DisposeAsync();

    private ReadbackResult RenderOnComThread(DiagramDocument document, string temporaryPath)
    {
        dynamic? app = null;
        dynamic? docs = null;
        dynamic? doc = null;
        bool launched = false;
        try
        {
            app = ConnectVisio(out launched);
            TrySet(() => app.Visible = _options.Visible);
            TrySet(() => app.AlertResponse = 1);
            docs = app.Documents;
            doc = docs.Add("");
            dynamic page = doc.Pages.Item(1);
            TrySetPageSize(page);

            foreach (var node in document.Nodes) DrawNode(page, node);
            foreach (var connector in document.Connectors) DrawConnector(page, connector);
            foreach (var stage in document.StageLabels.Select((label, index) => (label, index)))
            {
                dynamic stageLabel = page.DrawRectangle(0.25, PageHeightInches - 0.55 - stage.index * 0.35, 2.2, PageHeightInches - 0.25 - stage.index * 0.35);
                stageLabel.Text = stage.label;
                TrySet(() => stageLabel.NameU = $"synapse.stage.{stage.index}");
            }

            doc.SaveAs(temporaryPath);
            doc.Close();
            doc = null;
            doc = docs.Open(temporaryPath);
            dynamic readbackPage = doc.Pages.Item(1);
            var shapeCount = Convert.ToInt32(readbackPage.Shapes.Count, System.Globalization.CultureInfo.InvariantCulture);
            var connectorCount = CountNamedShapes(readbackPage, "synapse.edge.");
            doc.Close();
            doc = null;
            if (shapeCount < document.Nodes.Count || connectorCount != document.Connectors.Count)
                throw new WorkerProtocolException($"Visio readback count mismatch: shapes={shapeCount}, connectors={connectorCount}");
            return new ReadbackResult(true, shapeCount, connectorCount);
        }
        catch (WorkerProtocolException)
        {
            throw;
        }
        catch (Exception error)
        {
            throw new WorkerProtocolException($"Visio COM render failed: {error.Message}", error);
        }
        finally
        {
            TryClose(doc);
            if (launched) TryQuit(app);
            ReleaseCom(doc);
            ReleaseCom(docs);
            ReleaseCom(app);
        }
    }

    private dynamic ConnectVisio(out bool launched)
    {
        var visioType = Type.GetTypeFromProgID("Visio.Application", throwOnError: false)
            ?? throw new WorkerProtocolException("Visio.Application is not registered");

        if (_options.AttachToRunning && TryGetActiveObject(visioType.GUID, out var active))
        {
            launched = false;
            return active!;
        }

        var created = Activator.CreateInstance(visioType)
            ?? throw new WorkerProtocolException("Visio.Application could not be created");
        launched = true;
        return created;
    }

    private static void DrawNode(dynamic page, VisioNode node)
    {
        var x1 = node.XInches;
        var y1 = PageHeightInches - node.YInches - node.HeightInches;
        var x2 = x1 + node.WidthInches;
        var y2 = y1 + node.HeightInches;
        dynamic shape = page.DrawRectangle(x1, y1, x2, y2);
        shape.Text = string.IsNullOrWhiteSpace(node.Subtitle) ? node.Label : $"{node.Label}\n{node.Subtitle}";
        TrySet(() => shape.NameU = $"synapse.node.{SanitizeName(node.Id)}");
        foreach (var property in node.ShapeData) TrySetShapeData(shape, property.Key, property.Value);
    }

    private static void DrawConnector(dynamic page, VisioConnector connector)
    {
        var points = connector.Points.SelectMany(point => new[] { point.X, PageHeightInches - point.Y }).Cast<object>().ToArray();
        dynamic shape;
        try
        {
            shape = page.DrawPolyline(points, 0);
        }
        catch
        {
            var first = connector.Points[0];
            var last = connector.Points[^1];
            shape = page.DrawLine(first.X, PageHeightInches - first.Y, last.X, PageHeightInches - last.Y);
        }
        TrySet(() => shape.NameU = $"synapse.edge.{SanitizeName(connector.Id)}");
    }

    private static int CountNamedShapes(dynamic page, string prefix)
    {
        var count = 0;
        foreach (dynamic shape in page.Shapes)
        {
            string name = Convert.ToString(shape.NameU, System.Globalization.CultureInfo.InvariantCulture) ?? "";
            if (name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) count++;
        }
        return count;
    }

    private static void TrySetPageSize(dynamic page)
    {
        TrySet(() => page.PageSheet.CellsU("PageWidth").FormulaU = "26 in");
        TrySet(() => page.PageSheet.CellsU("PageHeight").FormulaU = "15 in");
        TrySet(() => page.PageSheet.CellsU("PageScale").FormulaU = "1 in");
        TrySet(() => page.PageSheet.CellsU("DrawingScale").FormulaU = "1 in");
    }

    private static void TrySetShapeData(dynamic shape, string key, string value)
    {
        try
        {
            shape.AddNamedRow(243, key, 0);
            shape.CellsU($"Prop.{key}.Label").FormulaU = $"\"{key}\"";
            shape.CellsU($"Prop.{key}").FormulaU = $"\"{value.Replace("\"", "\"\"")}\"";
        }
        catch { }
    }

    private static void TrySet(Action action)
    {
        try { action(); }
        catch { }
    }

    private static void TryClose(dynamic? doc)
    {
        if (doc is null) return;
        TrySet(() => doc.Close());
    }

    private static void TryQuit(dynamic? app)
    {
        if (app is null) return;
        TrySet(() => app.Quit());
    }

    private static void ReleaseCom(object? value)
    {
        if (value is not null && Marshal.IsComObject(value))
        {
            try { Marshal.FinalReleaseComObject(value); }
            catch { }
        }
    }

    private static bool TryGetActiveObject(Guid clsid, out object? value)
    {
        try
        {
            GetActiveObject(ref clsid, IntPtr.Zero, out value);
            return value is not null;
        }
        catch
        {
            value = null;
            return false;
        }
    }

    private static string SanitizeName(string value) => new(value.Select(character => char.IsLetterOrDigit(character) ? character : '_').ToArray());

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch { }
    }

    [DllImport("oleaut32.dll", PreserveSig = false)]
    private static extern void GetActiveObject(ref Guid clsid, IntPtr reserved, [MarshalAs(UnmanagedType.Interface)] out object value);
}
