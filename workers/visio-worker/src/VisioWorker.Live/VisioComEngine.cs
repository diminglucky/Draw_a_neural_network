using System.Runtime.InteropServices;
using VisioWorker.Core;

namespace VisioWorker.Live;

public sealed record VisioComEngineOptions(bool AttachToRunning = false, bool Visible = false, string OutputRoot = "");

public static class PublicationRenderPalette
{
    public static (int R, int G, int B) FeatureMapFrontFill => (247, 251, 255);
    public static (int R, int G, int B) FeatureMapMidFill => (225, 238, 248);
    public static (int R, int G, int B) FeatureMapRearFill => (197, 219, 237);
    public static (int R, int G, int B) FeatureMapOutline => (55, 96, 132);
    public static (int R, int G, int B) TransitionFill => (247, 249, 251);
    public static (int R, int G, int B) DenseFill => (232, 244, 241);
    public static (int R, int G, int B) DenseAccent => (72, 139, 130);
    public static (int R, int G, int B) ScoreFill => (253, 246, 227);
    public static (int R, int G, int B) ScoreAccent => (189, 145, 65);

    public static (int R, int G, int B) FeatureMapPlaneFill((int R, int G, int B) baseColor, int backOffset)
    {
        if (backOffset <= 0) return baseColor;
        var factor = Math.Min(0.72, 0.36 * backOffset);
        return (
            (int)(baseColor.R * factor + 255 * (1 - factor)),
            (int)(baseColor.G * factor + 255 * (1 - factor)),
            (int)(baseColor.B * factor + 255 * (1 - factor)));
    }

    public static (int R, int G, int B) FeatureMapStackFill(int backOffset) => backOffset switch
    {
        <= 0 => FeatureMapFrontFill,
        1 => FeatureMapMidFill,
        _ => FeatureMapRearFill,
    };
}

public static class PublicationTensorGeometry
{
    public static double FeatureMapFaceDepthInches(double extrusionDepthInches) => Math.Clamp(extrusionDepthInches * 0.14, 0.04, 0.07);
    public static double StackPlaneOffsetInches(double extrusionDepthInches) => Math.Clamp(extrusionDepthInches * 0.35, 0.11, 0.17);
    public static double TransitionFaceDepthInches => 0.045;

    public static PublicationTensorSlab CreateTensorSlab(double x1, double y1, double x2, double y2, double faceDepth)
    {
        if (x2 <= x1 || y2 <= y1 || faceDepth <= 0) throw new ArgumentOutOfRangeException(nameof(faceDepth));
        var frontShearY = faceDepth * 0.36;
        var depthY = faceDepth * 0.72;
        var frontBottomLeft = new PublicationPoint(x1, y1);
        var frontBottomRight = new PublicationPoint(x2, y1 + frontShearY);
        var frontTopRight = new PublicationPoint(x2, y2 + frontShearY);
        var frontTopLeft = new PublicationPoint(x1, y2);
        var depth = new PublicationPoint(faceDepth, depthY);
        return new PublicationTensorSlab(
            [frontBottomLeft, frontBottomRight, frontTopRight, frontTopLeft, frontBottomLeft],
            [frontTopLeft, frontTopRight, Translate(frontTopRight, depth), Translate(frontTopLeft, depth), frontTopLeft],
            [frontBottomRight, frontTopRight, Translate(frontTopRight, depth), Translate(frontBottomRight, depth), frontBottomRight]);
    }

    private static PublicationPoint Translate(PublicationPoint point, PublicationPoint vector) => new(point.X + vector.X, point.Y + vector.Y);
}

public readonly record struct PublicationPoint(double X, double Y);

public sealed record PublicationTensorSlab(
    IReadOnlyList<PublicationPoint> Front,
    IReadOnlyList<PublicationPoint> Top,
    IReadOnlyList<PublicationPoint> Side);

public sealed class VisioComEngine : IVisioEngine, IAsyncDisposable
{
    private const double PageHeightInches = 9.5;
    private static readonly TimeSpan OwnedApplicationExitTimeout = TimeSpan.FromSeconds(5);
    private readonly VisioComEngineOptions _options;
    private readonly ComStaRunner _runner;
    private readonly IVisioProcessWindowAdapter _processWindowAdapter;
    private readonly IVisioProcessExitAdapter _processExitAdapter;
    private readonly IVisioApplicationExitAdapter _applicationExitAdapter;
    private readonly object _sessionBackendGate = new();
    private VisioComSessionBackend? _sessionBackend;

    public VisioComEngine(VisioComEngineOptions options)
    {
        var processAdapter = new WindowsVisioProcessWindowAdapter();
        _options = options;
        _processWindowAdapter = processAdapter;
        _processExitAdapter = processAdapter;
        _applicationExitAdapter = new ComVisioApplicationExitAdapter();
        _runner = new ComStaRunner();
    }

    internal VisioComEngine(VisioComEngineOptions options, IVisioProcessWindowAdapter processWindowAdapter)
        : this(
            options,
            processWindowAdapter,
            processWindowAdapter as IVisioProcessExitAdapter
                ?? throw new ArgumentException("The process identity adapter must also support bounded exit checks.", nameof(processWindowAdapter)),
            new ComVisioApplicationExitAdapter())
    {
    }

    internal VisioComEngine(
        VisioComEngineOptions options,
        IVisioProcessWindowAdapter processWindowAdapter,
        IVisioProcessExitAdapter processExitAdapter,
        IVisioApplicationExitAdapter applicationExitAdapter)
    {
        _options = options;
        _processWindowAdapter = processWindowAdapter ?? throw new ArgumentNullException(nameof(processWindowAdapter));
        _processExitAdapter = processExitAdapter ?? throw new ArgumentNullException(nameof(processExitAdapter));
        _applicationExitAdapter = applicationExitAdapter ?? throw new ArgumentNullException(nameof(applicationExitAdapter));
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
            var result = await _runner.InvokeAsync(() => RenderOnComThread(document, temporaryPath, finalPath)).WaitAsync(cancellationToken).ConfigureAwait(false);
            if (!result.Valid || !File.Exists(finalPath)) throw new WorkerProtocolException("Visio readback did not validate the final output");
            return result with { DiagnosticPath = finalPath };
        }
        catch (COMException error)
        {
            TryDelete(finalPath);
            throw new WorkerProtocolException($"Visio COM operation failed: {error.Message}", error);
        }
        catch
        {
            TryDelete(finalPath);
            throw;
        }
        finally
        {
            TryDelete(temporaryPath);
        }
    }

    /// <summary>
    /// Creates the reusable session adapter on this engine's existing STA runner. The caller owns
    /// this engine's lifetime; disposing the returned adapter does not dispose the shared runner.
    /// </summary>
    public VisioComSessionBackend CreateSessionBackend()
    {
        lock (_sessionBackendGate)
        {
            return _sessionBackend ??= new VisioComSessionBackend(
                _options,
                new VisioComSessionOperations(new VisioComSessionNative(
                    _options,
                    _processWindowAdapter,
                    _processExitAdapter,
                    _applicationExitAdapter)),
                _runner,
                ownsRunner: false);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_sessionBackend is not null) await _sessionBackend.DisposeAsync().ConfigureAwait(false);
        await _runner.DisposeAsync().ConfigureAwait(false);
    }

    private ReadbackResult RenderOnComThread(DiagramDocument document, string temporaryPath, string finalPath)
    {
        dynamic? app = null;
        dynamic? docs = null;
        dynamic? doc = null;
        bool workerCreatedApplication = false;
        bool keepVisibleDocumentOpen = false;
        OwnedVisioApplicationExit? ownedApplicationExit = null;
        try
        {
            app = ConnectVisio(
                _options,
                _processWindowAdapter,
                _processExitAdapter,
                _applicationExitAdapter,
                out workerCreatedApplication,
                out ownedApplicationExit);
            TrySet(() => app.Visible = _options.Visible);
            TrySet(() => app.AlertResponse = 1);
            docs = app.Documents;
            doc = docs.Add("");
            dynamic page = doc.Pages.Item(1);
            var figurePlan = document.FigurePlan;
            ConfigureAndDrawDocument(page, document);

            doc.SaveAs(temporaryPath);
            doc.Close();
            doc = null;
            File.Move(temporaryPath, finalPath, overwrite: true);
            doc = docs.Open(finalPath);
            dynamic readbackPage = doc.Pages.Item(1);
            var shapeCount = Convert.ToInt32(readbackPage.Shapes.Count, System.Globalization.CultureInfo.InvariantCulture);
            var readback = figurePlan is null
                ? ReadbackValidator.Legacy(shapeCount, CountNamedShapes(readbackPage, "synapse.edge."))
                : ReadFigurePlanReadback(readbackPage, figurePlan, shapeCount);
            if (!readback.Valid)
            {
                throw new WorkerProtocolException(
                    $"Visio semantic readback mismatch: missing primitives=[{string.Join(",", readback.MissingPrimitiveIds)}], "
                    + $"missing connectors=[{string.Join(",", readback.MissingConnectorIds)}], "
                    + $"shape data failures=[{string.Join(";", readback.ShapeDataFailures)}]");
            }
            if (VisioDocumentLifecycle.ShouldCloseDocumentAfterReadback(_options.Visible))
            {
                doc.Close();
                doc = null;
            }
            else
            {
                TrySet(() => app.Visible = true);
                if (VisioDocumentLifecycle.ShouldFitVisibleDocument(_options.Visible)) TryFitDocumentWindow(doc);
                keepVisibleDocumentOpen = true;
            }
            return readback;
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
            try
            {
                if (!keepVisibleDocumentOpen) TryClose(doc);
                if (!keepVisibleDocumentOpen) ExitApplication(app, workerCreatedApplication, ownedApplicationExit);
            }
            finally
            {
                ReleaseCom(doc);
                ReleaseCom(docs);
                ReleaseCom(app);
            }
        }
    }

    internal static dynamic ConnectVisio(VisioComEngineOptions options, out bool workerCreatedApplication)
    {
        var visioType = Type.GetTypeFromProgID("Visio.Application", throwOnError: false)
            ?? throw new WorkerProtocolException("Visio.Application is not registered");

        if (options.AttachToRunning && TryGetActiveObject(visioType.GUID, out var active))
        {
            workerCreatedApplication = false;
            return active!;
        }

        var created = Activator.CreateInstance(visioType)
            ?? throw new WorkerProtocolException("Visio.Application could not be created");
        workerCreatedApplication = true;
        return created;
    }

    internal static dynamic ConnectRunningVisio()
    {
        var visioType = Type.GetTypeFromProgID("Visio.Application", throwOnError: false)
            ?? throw new WorkerProtocolException("Visio.Application is not registered");
        return RequireRunningVisioApplication(TryGetActiveObject(visioType.GUID, out var active) ? active : null);
    }

    internal static object RequireRunningVisioApplication(object? activeApplication) =>
        activeApplication ?? throw new WorkerProtocolException("No running Visio application is available. Open the target document and select its page before drawing.");

    internal static dynamic ConnectVisio(
        VisioComEngineOptions options,
        IVisioProcessWindowAdapter processWindowAdapter,
        IVisioProcessExitAdapter processExitAdapter,
        IVisioApplicationExitAdapter applicationExitAdapter,
        out bool workerCreatedApplication,
        out OwnedVisioApplicationExit? ownedApplicationExit)
    {
        ArgumentNullException.ThrowIfNull(processWindowAdapter);
        ArgumentNullException.ThrowIfNull(processExitAdapter);
        ArgumentNullException.ThrowIfNull(applicationExitAdapter);
        var application = ConnectVisio(options, out workerCreatedApplication);
        var ownedApplicationLease = OwnedVisioApplicationLease.TryCreate(application, workerCreatedApplication, processWindowAdapter);
        ownedApplicationExit = ownedApplicationLease is null
            ? null
            : new OwnedVisioApplicationExit(
                ownedApplicationLease,
                processWindowAdapter,
                processExitAdapter,
                applicationExitAdapter,
                OwnedApplicationExitTimeout);
        return application;
    }

    internal static void ConfigureAndDrawDocument(dynamic page, DiagramDocument document)
    {
        ConfigureAndDraw(page, document, resizePage: true);
    }

    /// <summary>
    /// Draws only the Agent-owned region on a user-selected existing page. Unlike export rendering,
    /// this deliberately leaves the user's page dimensions and scale untouched.
    /// </summary>
    internal static void DrawSelectedPageRegion(dynamic page, DiagramDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);
        if (document.FigurePlan is null)
            throw new WorkerProtocolException("Selected-page rendering requires a complete figure plan and cannot use the legacy fallback.");
        var pageWidth = ReadSelectedPageMetric((object)page, "PageWidth", document.FigurePlan.PageWidthInches);
        var pageHeight = ReadSelectedPageMetric((object)page, "PageHeight", document.FigurePlan.PageHeightInches);
        ConfigureAndDraw(page, FitSelectedPageDocument(document, pageWidth, pageHeight), resizePage: false);
    }

    internal static DiagramDocument FitSelectedPageDocument(DiagramDocument document, double pageWidthInches, double pageHeightInches)
    {
        ArgumentNullException.ThrowIfNull(document);
        var plan = document.FigurePlan ?? throw new WorkerProtocolException("Selected-page fitting requires a complete figure plan.");
        if (!double.IsFinite(pageWidthInches) || !double.IsFinite(pageHeightInches) || pageWidthInches <= 0 || pageHeightInches <= 0
            || !double.IsFinite(plan.PageWidthInches) || !double.IsFinite(plan.PageHeightInches) || plan.PageWidthInches <= 0 || plan.PageHeightInches <= 0)
            throw new WorkerProtocolException("Selected-page dimensions are invalid.");

        var contentBounds = ContentBounds(plan);
        var margin = Math.Min(0.3, Math.Min(pageWidthInches, pageHeightInches) * 0.08);
        var availableWidth = pageWidthInches - margin * 2;
        var availableHeight = pageHeightInches - margin * 2;
        if (availableWidth <= 0 || availableHeight <= 0) throw new WorkerProtocolException("Selected page is too small for a bounded drawing region.");
        var scale = Math.Min(availableWidth / contentBounds.WidthInches, availableHeight / contentBounds.HeightInches);
        var hasReadableText = plan.Labels is { Count: > 0 }
            || plan.PrimitiveGroups.Any(group => !string.IsNullOrWhiteSpace(group.InlineLabel));
        if (hasReadableText && scale < 0.45)
            throw new WorkerProtocolException("Selected page cannot preserve readable publication labels without a reviewed page-aware reflow.");
        var offsetX = (pageWidthInches - contentBounds.WidthInches * scale) / 2 - contentBounds.XInches * scale;
        var offsetY = (pageHeightInches - contentBounds.HeightInches * scale) / 2 - contentBounds.YInches * scale;
        VisioBounds FitBounds(VisioBounds value) => new(
            offsetX + value.XInches * scale,
            offsetY + value.YInches * scale,
            value.WidthInches * scale,
            value.HeightInches * scale);
        DiagramPoint FitPoint(DiagramPoint value) => new(offsetX + value.X * scale, offsetY + value.Y * scale);

        var fittedPlan = new VisioFigurePlan(
            pageWidthInches,
            pageHeightInches,
            plan.PrimitiveGroups.Select(group => group with
            {
                Bounds = FitBounds(group.Bounds),
                ExtrusionDepthInches = group.ExtrusionDepthInches * scale,
                SkewXInches = group.SkewXInches * scale,
                SkewYInches = group.SkewYInches * scale,
            }).ToArray(),
            plan.Connectors.Select(connector => connector with { Points = connector.Points.Select(FitPoint).ToArray() }).ToArray(),
            plan.Labels?.Select(label => label with
            {
                XInches = offsetX + label.XInches * scale,
                YInches = offsetY + label.YInches * scale,
                WidthInches = label.WidthInches * scale,
                HeightInches = Math.Max(0.12, label.HeightInches * scale),
                FontSizePt = Math.Clamp(label.FontSizePt * Math.Sqrt(scale), 8, 11),
            }).ToArray());
        return document with { FigurePlan = fittedPlan };
    }

    private static VisioBounds ContentBounds(VisioFigurePlan plan)
    {
        var left = double.PositiveInfinity;
        var top = double.PositiveInfinity;
        var right = double.NegativeInfinity;
        var bottom = double.NegativeInfinity;
        void Include(double x1, double y1, double x2, double y2)
        {
            left = Math.Min(left, Math.Min(x1, x2));
            top = Math.Min(top, Math.Min(y1, y2));
            right = Math.Max(right, Math.Max(x1, x2));
            bottom = Math.Max(bottom, Math.Max(y1, y2));
        }

        foreach (var group in plan.PrimitiveGroups)
        {
            var extraX = Math.Max(Math.Abs(group.ExtrusionDepthInches), Math.Abs(group.SkewXInches));
            var extraY = Math.Abs(group.SkewYInches);
            Include(group.Bounds.XInches, group.Bounds.YInches, group.Bounds.XInches + group.Bounds.WidthInches + extraX, group.Bounds.YInches + group.Bounds.HeightInches + extraY);
        }
        foreach (var connector in plan.Connectors)
        {
            foreach (var point in connector.Points) Include(point.X, point.Y, point.X, point.Y);
        }
        if (plan.Labels is not null)
        {
            foreach (var label in plan.Labels) Include(label.XInches, label.YInches, label.XInches + label.WidthInches, label.YInches + label.HeightInches);
        }
        if (!double.IsFinite(left) || !double.IsFinite(top) || !double.IsFinite(right) || !double.IsFinite(bottom) || right <= left || bottom <= top)
            throw new WorkerProtocolException("Selected-page figure content bounds are invalid.");
        return new VisioBounds(left, top, right - left, bottom - top);
    }

    internal static double ReadSelectedPageMetric(object pageObject, string cellName, double fallback)
    {
        dynamic page = pageObject;
        dynamic? cell = null;
        try
        {
            cell = page.PageSheet.CellsU[cellName];
            var value = Convert.ToDouble(cell.ResultIU, System.Globalization.CultureInfo.InvariantCulture);
            return double.IsFinite(value) && value > 0 ? value : fallback;
        }
        catch
        {
            return fallback;
        }
        finally
        {
            ReleaseCom(cell);
        }
    }

    private static void ConfigureAndDraw(dynamic page, DiagramDocument document, bool resizePage)
    {
        ArgumentNullException.ThrowIfNull(document);
        var figurePlan = document.FigurePlan;
        var pageHeight = figurePlan?.PageHeightInches ?? PageHeightInches;
        if (resizePage) TrySetPageSize(page, figurePlan?.PageWidthInches ?? 26, pageHeight);

        if (figurePlan is null)
        {
            foreach (var node in document.Nodes) DrawNode(page, node);
            foreach (var connector in document.Connectors) DrawConnector(page, connector, pageHeight);
            DrawTitle(page, document.Title, pageHeight, 26);
            DrawStageLabels(page, document);
            DrawLegend(page);
            return;
        }

        foreach (var group in figurePlan.PrimitiveGroups) DrawPrimitiveGroup(page, group, pageHeight);
        foreach (var connector in figurePlan.Connectors) DrawConnector(page, connector, pageHeight);
        if (figurePlan.Labels is not null)
        {
            foreach (var label in figurePlan.Labels) DrawFigurePlanLabel(page, label, pageHeight);
        }
        else if (UsesLegacyFallbackLabels(figurePlan))
        {
            foreach (var group in figurePlan.PrimitiveGroups) DrawPrimitiveLabel(page, group, group.Bounds.XInches, pageHeight - group.Bounds.YInches + 0.05, group.Bounds.XInches + group.Bounds.WidthInches, pageHeight - group.Bounds.YInches + 0.34);
        }
        if (!string.IsNullOrWhiteSpace(document.Title)) DrawTitle(page, document.Title, pageHeight, figurePlan.PageWidthInches);
    }

    private static bool UsesLegacyFallbackLabels(VisioFigurePlan plan) => plan.Labels is null;

    private static void DrawNode(dynamic page, VisioNode node)
    {
        var x1 = node.XInches;
        var y1 = PageHeightInches - node.YInches - node.HeightInches;
        var x2 = x1 + node.WidthInches;
        var y2 = y1 + node.HeightInches;
        var visualRole = node.VisualRole?.Trim().ToLowerInvariant() ?? "standard";
        dynamic shape = visualRole switch
        {
            "feature-map-stack" => DrawFeatureMapStack(page, node, x1, y1, x2, y2),
            "pooling-block" => DrawPoolingBlock(page, node, x1, y1, x2, y2),
            "fully-connected" => DrawFullyConnectedBlock(page, node, x1, y1, x2, y2),
            "softmax-block" => DrawSoftmaxBlock(page, node, x1, y1, x2, y2),
            _ => DrawStandardBlock(page, node, x1, y1, x2, y2),
        };
        TrySet(() => shape.NameU = $"synapse.node.{SanitizeName(node.Id)}");
        foreach (var property in node.ShapeData) TrySetShapeData(shape, property.Key, property.Value);
        DrawTextLabel(page, node, x1, y2 + 0.06, x2, y2 + 0.42);
    }

    private static dynamic DrawStandardBlock(dynamic page, VisioNode node, double x1, double y1, double x2, double y2)
    {
        dynamic shape = page.DrawRectangle(x1, y1, x2, y2);
        ApplyFill(shape, ParseColor(node.Color, 79, 134, 198), 1.4);
        return shape;
    }

    private static dynamic DrawFeatureMapStack(dynamic page, VisioNode node, double x1, double y1, double x2, double y2)
    {
        var depth = Math.Clamp(node.Depth, 2, 12);
        var offset = Math.Min(0.12, Math.Min(node.WidthInches, node.HeightInches) / Math.Max(12, depth * 2.0));
        dynamic? front = null;
        var fill = ParseColor(node.Color, 79, 134, 198);
        for (var index = depth - 1; index >= 0; index--)
        {
            var planeX1 = x1 + offset * index;
            var planeY1 = y1 + (node.Perspective ? offset * index : 0);
            var planeX2 = x2 + offset * index;
            var planeY2 = y2 + (node.Perspective ? offset * index : 0);
            dynamic plane = page.DrawRectangle(planeX1, planeY1, planeX2, planeY2);
            ApplyFill(plane, index == 0 ? fill : Blend(fill, 0.58), 1.1);
            TrySet(() => plane.NameU = $"synapse.node.{SanitizeName(node.Id)}.plane.{index}");
            if (index == 0) front = plane;
        }
        return front!;
    }

    private static dynamic DrawPoolingBlock(dynamic page, VisioNode node, double x1, double y1, double x2, double y2)
    {
        var width = Math.Max(0.18, (x2 - x1) * 0.62);
        var height = Math.Max(0.28, (y2 - y1) * 0.72);
        var center = (x1 + x2) / 2;
        dynamic shape = page.DrawRectangle(center - width / 2, y1 + (y2 - y1 - height) / 2, center + width / 2, y1 + (y2 - y1 + height) / 2);
        ApplyFill(shape, ParseColor(node.Color, 198, 91, 91), 1.6);
        return shape;
    }

    private static dynamic DrawFullyConnectedBlock(dynamic page, VisioNode node, double x1, double y1, double x2, double y2)
    {
        var depth = Math.Clamp(node.Depth, 2, 5);
        var offset = Math.Min(0.1, (x2 - x1) / Math.Max(12, depth * 2.0));
        dynamic? front = null;
        var fill = ParseColor(node.Color, 88, 166, 166);
        for (var index = depth - 1; index >= 0; index--)
        {
            dynamic plane = page.DrawRectangle(x1 + offset * index, y1 + offset * index, x2 + offset * index, y2 + offset * index);
            ApplyFill(plane, index == 0 ? fill : Blend(fill, 0.62), 1.2);
            TrySet(() => plane.NameU = $"synapse.node.{SanitizeName(node.Id)}.plane.{index}");
            if (index == 0) front = plane;
        }
        return front!;
    }

    private static dynamic DrawSoftmaxBlock(dynamic page, VisioNode node, double x1, double y1, double x2, double y2)
    {
        var width = Math.Max(0.2, (x2 - x1) * 0.74);
        var center = (x1 + x2) / 2;
        dynamic shape = page.DrawRectangle(center - width / 2, y1, center + width / 2, y2);
        ApplyFill(shape, ParseColor(node.Color, 201, 163, 78), 1.8);
        return shape;
    }

    private static void DrawPrimitiveGroup(dynamic page, VisioPrimitiveGroup group, double pageHeight)
    {
        var x1 = group.Bounds.XInches;
        var y1 = pageHeight - group.Bounds.YInches - group.Bounds.HeightInches;
        var x2 = x1 + group.Bounds.WidthInches;
        var y2 = y1 + group.Bounds.HeightInches;
        var (fallbackFill, fallbackLineWeight) = group.Kind switch
        {
            "feature-map-stack" => (PublicationRenderPalette.FeatureMapFrontFill, 1.15),
            "downsample-transition" => (PublicationRenderPalette.TransitionFill, 1.0),
            "pooling-wedge" => (PublicationRenderPalette.TransitionFill, 1.0),
            "pooling-prism" => (PublicationRenderPalette.TransitionFill, 1.0),
            "dense-vector-layer" => (PublicationRenderPalette.DenseFill, 1.0),
            "score-vector-layer" => (PublicationRenderPalette.ScoreFill, 1.0),
            _ => (PublicationRenderPalette.FeatureMapFrontFill, 1.0),
        };
        var fill = group.Style is null
            ? fallbackFill
            : ParseColor(group.Style.FillColor, fallbackFill.R, fallbackFill.G, fallbackFill.B);
        var stroke = group.Style is null
            ? ((int R, int G, int B)?)null
            : ParseColor(group.Style.StrokeColor, 30, 41, 59);
        var lineWeight = group.Style?.StrokeWidthPoints ?? fallbackLineWeight;

        if (string.Equals(group.Kind, "pvp-input-terminal", StringComparison.Ordinal)
            || string.Equals(group.Kind, "pvp-output-terminal", StringComparison.Ordinal))
        {
            dynamic shape = page.DrawRectangle(x1, y1, x2, y2);
            ApplyFill(shape, fill, lineWeight, stroke);
            TrySet(() => shape.CellsU("Rounding").FormulaU = "0.08 in");
            ApplyInlineLabel(shape, group);
            NameAndAnnotatePrimitive(shape, group, group.PrimitiveIds.Single());
        }
        else if (string.Equals(group.Kind, "pvp-tensor-stage", StringComparison.Ordinal))
        {
            var inset = Math.Min((y2 - y1) * 0.22, Math.Max(0.02, (x2 - x1) * 0.08));
            dynamic shape = DrawClosedPolygon(page, new double[] { x1, y1, x2, y1 + inset, x2, y2 - inset, x1, y2, x1, y1 });
            ApplyFill(shape, fill, lineWeight, stroke);
            ApplyInlineLabel(shape, group);
            NameAndAnnotatePrimitive(shape, group, group.PrimitiveIds.Single());
        }
        else if (string.Equals(group.Kind, "pvp-attention-token-strip", StringComparison.Ordinal))
        {
            DrawTokenStrip(page, group, x1, y1, x2, y2, fill, lineWeight, stroke);
        }
        else if (string.Equals(group.Kind, "pvp-split-marker", StringComparison.Ordinal)
            || string.Equals(group.Kind, "pvp-add-marker", StringComparison.Ordinal)
            || string.Equals(group.Kind, "pvp-concat-marker", StringComparison.Ordinal)
            || string.Equals(group.Kind, "pvp-attention-relation", StringComparison.Ordinal))
        {
            dynamic shape = page.DrawOval(x1, y1, x2, y2);
            ApplyFill(shape, fill, lineWeight, stroke);
            if (string.Equals(group.Kind, "pvp-add-marker", StringComparison.Ordinal)) ApplyMarkerGlyph(shape, "+");
            if (string.Equals(group.Kind, "pvp-concat-marker", StringComparison.Ordinal)) ApplyMarkerGlyph(shape, "C");
            NameAndAnnotatePrimitive(shape, group, group.PrimitiveIds.Single());
        }
        else if (string.Equals(group.Kind, "input-rgb-tile", StringComparison.Ordinal))
        {
            DrawInputRgbTile(page, group, x1, y1, x2, y2);
        }
        else if (string.Equals(group.Kind, "feature-map-stack", StringComparison.Ordinal))
        {
            DrawFeatureMapPlaneStack(page, group, x1, y1, x2, y2, fill, lineWeight);
        }
        else if (string.Equals(group.Kind, "downsample-transition", StringComparison.Ordinal))
        {
            DrawDownsampleTransition(page, group, x1, y1, x2, y2, fill, lineWeight);
        }
        else if (string.Equals(group.Kind, "pooling-wedge", StringComparison.Ordinal))
        {
            DrawPoolingWedge(page, group, x1, y1, x2, y2, fill, lineWeight);
        }
        else if (string.Equals(group.Kind, "flatten-ribbon", StringComparison.Ordinal))
        {
            DrawFlattenRibbon(page, group, x1, y1, x2, y2);
        }
        else if (string.Equals(group.Kind, "dense-vector-layer", StringComparison.Ordinal))
        {
            DrawDenseVectorLayer(page, group, x1, y1, x2, y2);
        }
        else if (string.Equals(group.Kind, "score-vector-layer", StringComparison.Ordinal))
        {
            DrawScoreVectorLayer(page, group, x1, y1, x2, y2);
        }
        else if (HasPrismFaces(group))
        {
            DrawPrismFaces(page, group, x1, y1, x2, y2, fill, lineWeight, group.Id);
        }
        else
        {
            dynamic shape = page.DrawRectangle(x1, y1, x2, y2);
            ApplyFill(shape, fill, lineWeight, stroke);
            if (string.Equals(group.Kind, "pvp-repeat-badge", StringComparison.Ordinal)) TrySet(() => shape.CellsU("Rounding").FormulaU = "0.05 in");
            ApplyInlineLabel(shape, group);
            NameAndAnnotatePrimitive(shape, group, group.PrimitiveIds.Single());
        }

    }

    private static void DrawTokenStrip(dynamic page, VisioPrimitiveGroup group, double x1, double y1, double x2, double y2, (int R, int G, int B) fill, double lineWeight, (int R, int G, int B)? stroke)
    {
        var width = (x2 - x1) / group.PrimitiveIds.Count;
        for (var index = 0; index < group.PrimitiveIds.Count; index++)
        {
            dynamic cell = page.DrawRectangle(x1 + width * index, y1, x1 + width * (index + 1), y2);
            ApplyFill(cell, index % 2 == 0 ? fill : Shade(fill, 0.92), lineWeight, stroke);
            NameAndAnnotatePrimitive(cell, group, group.PrimitiveIds[index]);
        }
    }

    private static void ApplyInlineLabel(dynamic shape, VisioPrimitiveGroup group)
    {
        if (string.IsNullOrWhiteSpace(group.InlineLabel)) return;
        shape.Text = group.InlineLabel;
        var fontSize = string.Equals(group.Kind, "pvp-repeat-badge", StringComparison.Ordinal) ? 8 : 9;
        TrySet(() => shape.CellsU("Char.Font").FormulaU = "FONT(\"Arial\")");
        TrySet(() => shape.CellsU("Char.Size").FormulaU = $"{fontSize} pt");
        TrySet(() => shape.CellsU("Para.HorzAlign").FormulaU = "1");
        TrySet(() => shape.CellsU("VerticalAlign").FormulaU = "1");
        TrySet(() => shape.CellsU("LeftMargin").FormulaU = "0.04 in");
        TrySet(() => shape.CellsU("RightMargin").FormulaU = "0.04 in");
        TrySet(() => shape.CellsU("TopMargin").FormulaU = "0.02 in");
        TrySet(() => shape.CellsU("BottomMargin").FormulaU = "0.02 in");
    }

    private static void ApplyMarkerGlyph(dynamic shape, string glyph)
    {
        shape.Text = glyph;
        TrySet(() => shape.CellsU("Char.Font").FormulaU = "FONT(\"Arial\")");
        TrySet(() => shape.CellsU("Char.Size").FormulaU = "9 pt");
        TrySet(() => shape.CellsU("Char.Style").FormulaU = "1");
        TrySet(() => shape.CellsU("Char.Color").FormulaU = "RGB(30,41,59)");
        TrySet(() => shape.CellsU("Para.HorzAlign").FormulaU = "1");
        TrySet(() => shape.CellsU("VerticalAlign").FormulaU = "1");
        TrySet(() => shape.CellsU("LeftMargin").FormulaU = "0 in");
        TrySet(() => shape.CellsU("RightMargin").FormulaU = "0 in");
        TrySet(() => shape.CellsU("TopMargin").FormulaU = "0 in");
        TrySet(() => shape.CellsU("BottomMargin").FormulaU = "0 in");
    }

    private static dynamic DrawClosedPolygon(dynamic page, double[] points)
    {
        return page.DrawPolyline(points, 0);
    }

    private static dynamic DrawClosedPolygon(dynamic page, IReadOnlyList<PublicationPoint> points)
    {
        return DrawClosedPolygon(page, points.SelectMany(point => new[] { point.X, point.Y }).ToArray());
    }

    private static void DrawFeatureMapPlaneStack(dynamic page, VisioPrimitiveGroup group, double x1, double y1, double x2, double y2, (int R, int G, int B) fill, double lineWeight)
    {
        var planeCount = group.PrimitiveIds.Count(id => id.EndsWith(".front", StringComparison.Ordinal));
        if (planeCount < 1) throw new WorkerProtocolException($"Feature-map stack {group.Id} has no planned front plane.");
        var xOffset = PublicationTensorGeometry.StackPlaneOffsetInches(group.ExtrusionDepthInches);
        var yOffset = xOffset * 0.66;
        var faceDepth = PublicationTensorGeometry.FeatureMapFaceDepthInches(group.ExtrusionDepthInches);
        for (var plane = 1; plane <= planeCount; plane++)
        {
            var backOffset = planeCount - plane;
            var planeFill = PublicationRenderPalette.FeatureMapStackFill(backOffset);
            DrawFeatureMapFaces(
                page,
                group,
                x1 + xOffset * backOffset,
                y1 + yOffset * backOffset,
                x2 + xOffset * backOffset,
                y2 + yOffset * backOffset,
                planeFill,
                lineWeight,
                group.Id + $".plane-{plane}",
                faceDepth);
        }
    }

    private static void DrawFeatureMapFaces(dynamic page, VisioPrimitiveGroup group, double x1, double y1, double x2, double y2, (int R, int G, int B) fill, double lineWeight, string primitivePrefix, double faceDepth)
    {
        var slab = PublicationTensorGeometry.CreateTensorSlab(x1, y1, x2, y2, faceDepth);
        dynamic front = DrawClosedPolygon(page, slab.Front);
        ApplyFill(front, fill, lineWeight);
        TrySet(() => front.CellsU("LineColor").FormulaU = $"RGB({PublicationRenderPalette.FeatureMapOutline.R},{PublicationRenderPalette.FeatureMapOutline.G},{PublicationRenderPalette.FeatureMapOutline.B})");
        NameAndAnnotatePrimitive(front, group, RequiredFaceId(group, primitivePrefix, "front"));
        dynamic top = DrawClosedPolygon(page, slab.Top);
        ApplyFill(top, Shade(fill, 0.96), lineWeight);
        TrySet(() => top.CellsU("LineColor").FormulaU = $"RGB({PublicationRenderPalette.FeatureMapOutline.R},{PublicationRenderPalette.FeatureMapOutline.G},{PublicationRenderPalette.FeatureMapOutline.B})");
        NameAndAnnotatePrimitive(top, group, RequiredFaceId(group, primitivePrefix, "top"));
        dynamic side = DrawClosedPolygon(page, slab.Side);
        ApplyFill(side, Shade(fill, 0.88), lineWeight);
        TrySet(() => side.CellsU("LineColor").FormulaU = $"RGB({PublicationRenderPalette.FeatureMapOutline.R},{PublicationRenderPalette.FeatureMapOutline.G},{PublicationRenderPalette.FeatureMapOutline.B})");
        NameAndAnnotatePrimitive(side, group, RequiredFaceId(group, primitivePrefix, "side"));
    }

    private static void DrawInputRgbTile(dynamic page, VisioPrimitiveGroup group, double x1, double y1, double x2, double y2)
    {
        const double tileOffset = 0.12;
        var colors = new[]
        {
            ("red", (250, 242, 242), (193, 107, 107)),
            ("green", (241, 248, 244), (91, 148, 115)),
            ("blue", (240, 247, 253), (73, 125, 174)),
        };
        for (var index = 0; index < colors.Length; index++)
        {
            var offset = (colors.Length - 1 - index) * tileOffset;
            dynamic tile = page.DrawRectangle(x1 + offset, y1 + offset, x2 + offset, y2 + offset);
            ApplyFill(tile, colors[index].Item2, 1.15);
            TrySet(() => tile.CellsU("LineColor").FormulaU = $"RGB({colors[index].Item3.Item1},{colors[index].Item3.Item2},{colors[index].Item3.Item3})");
            NameAndAnnotatePrimitive(tile, group, group.Id + "." + colors[index].Item1);
            if (index == colors.Length - 1) DrawInputTileGrid(page, x1 + offset, y1 + offset, x2 + offset, y2 + offset);
        }
    }

    private static void DrawInputTileGrid(dynamic page, double x1, double y1, double x2, double y2)
    {
        for (var division = 1; division < 4; division++)
        {
            var x = x1 + (x2 - x1) * division / 4.0;
            var y = y1 + (y2 - y1) * division / 4.0;
            dynamic vertical = page.DrawLine(x, y1, x, y2);
            dynamic horizontal = page.DrawLine(x1, y, x2, y);
            TrySet(() => vertical.CellsU("LineColor").FormulaU = "RGB(198,216,230)");
            TrySet(() => horizontal.CellsU("LineColor").FormulaU = "RGB(198,216,230)");
            TrySet(() => vertical.CellsU("LineWeight").FormulaU = "0.35 pt");
            TrySet(() => horizontal.CellsU("LineWeight").FormulaU = "0.35 pt");
        }
    }

    private static void DrawDownsampleTransition(dynamic page, VisioPrimitiveGroup group, double x1, double y1, double x2, double y2, (int R, int G, int B) fill, double lineWeight)
    {
        var inputSpatial = ReadPositiveInteger(group, "synapse.inputSpatialSize", fallback: 2);
        var outputSpatial = ReadPositiveInteger(group, "synapse.outputSpatialSize", fallback: 1);
        var scale = Math.Clamp(Math.Pow((double)outputSpatial / inputSpatial, 0.4), 0.48, 0.9);
        var rightHeight = Math.Max(0.2, (y2 - y1) * scale);
        var centerY = (y1 + y2) / 2;
        var rightY1 = centerY - rightHeight / 2;
        var rightY2 = centerY + rightHeight / 2;
        var skewX = PublicationTensorGeometry.TransitionFaceDepthInches;
        var skewY = PublicationTensorGeometry.TransitionFaceDepthInches * 0.72;

        dynamic front = DrawClosedPolygon(page, new double[] { x1, y1, x2, rightY1, x2, rightY2, x1, y2, x1, y1 });
        ApplyFill(front, fill, 0.75);
        TrySet(() => front.CellsU("LineColor").FormulaU = "RGB(164,181,194)");
        NameAndAnnotatePrimitive(front, group, RequiredFaceId(group, "front"));
        dynamic top = DrawClosedPolygon(page, new double[] { x1, y2, x2, rightY2, x2 + skewX, rightY2 + skewY, x1 + skewX, y2 + skewY, x1, y2 });
        ApplyFill(top, Shade(fill, 0.98), 0.7);
        TrySet(() => top.CellsU("LineColor").FormulaU = "RGB(164,181,194)");
        NameAndAnnotatePrimitive(top, group, RequiredFaceId(group, "top"));
        dynamic side = DrawClosedPolygon(page, new double[] { x2, rightY1, x2, rightY2, x2 + skewX, rightY2 + skewY, x2 + skewX, rightY1 + skewY, x2, rightY1 });
        ApplyFill(side, Shade(fill, 0.94), 0.7);
        TrySet(() => side.CellsU("LineColor").FormulaU = "RGB(164,181,194)");
        NameAndAnnotatePrimitive(side, group, RequiredFaceId(group, "side"));
    }

    private static void DrawFlattenRibbon(dynamic page, VisioPrimitiveGroup group, double x1, double y1, double x2, double y2)
    {
        var rightHeight = Math.Max(0.16, Math.Min(0.32, (y2 - y1) * 0.28));
        var centerY = (y1 + y2) / 2;
        dynamic ribbon = DrawClosedPolygon(page, new double[] { x1, y1, x2, centerY - rightHeight / 2, x2, centerY + rightHeight / 2, x1, y2, x1, y1 });
        ApplyFill(ribbon, PublicationRenderPalette.TransitionFill, 0.95);
        TrySet(() => ribbon.CellsU("LineColor").FormulaU = "RGB(100,124,144)");
        NameAndAnnotatePrimitive(ribbon, group, group.Id + ".ribbon");
    }

    private static void DrawDenseVectorLayer(dynamic page, VisioPrimitiveGroup group, double x1, double y1, double x2, double y2)
    {
        dynamic frame = page.DrawRectangle(x1, y1, x2, y2);
        ApplyFill(frame, PublicationRenderPalette.DenseFill, 0.9);
        TrySet(() => frame.CellsU("LineColor").FormulaU = "RGB(72,139,130)");
        NameAndAnnotatePrimitive(frame, group, group.Id + ".frame");
        DrawVectorUnits(page, group, x1, y1, x2, y2, "unit", PublicationRenderPalette.DenseAccent);
    }

    private static void DrawScoreVectorLayer(dynamic page, VisioPrimitiveGroup group, double x1, double y1, double x2, double y2)
    {
        dynamic frame = page.DrawRectangle(x1, y1, x2, y2);
        ApplyFill(frame, PublicationRenderPalette.ScoreFill, 0.9);
        TrySet(() => frame.CellsU("LineColor").FormulaU = "RGB(189,145,65)");
        NameAndAnnotatePrimitive(frame, group, group.Id + ".frame");
        var scores = group.PrimitiveIds.Where(id => id.StartsWith(group.Id + ".score-", StringComparison.Ordinal)).ToArray();
        var slot = (y2 - y1) / (scores.Length + 1);
        for (var index = 0; index < scores.Length; index++)
        {
            var y = y2 - (index + 1) * slot;
            var width = (x2 - x1) * (0.32 + 0.58 * ((index % 4) + 1) / 4.0);
            dynamic score = page.DrawRectangle(x1 + 0.07, y - 0.025, x1 + 0.07 + width, y + 0.025);
            ApplyFill(score, PublicationRenderPalette.ScoreAccent, 0.5);
            NameAndAnnotatePrimitive(score, group, scores[index]);
        }
    }

    private static void DrawVectorUnits(dynamic page, VisioPrimitiveGroup group, double x1, double y1, double x2, double y2, string prefix, (int R, int G, int B) accent)
    {
        var ids = group.PrimitiveIds.Where(id => id.StartsWith(group.Id + "." + prefix + "-", StringComparison.Ordinal)).ToArray();
        var slot = (y2 - y1) / (ids.Length + 1);
        var diameter = Math.Min(0.11, Math.Max(0.06, (x2 - x1) * 0.42));
        var centerX = (x1 + x2) / 2;
        for (var index = 0; index < ids.Length; index++)
        {
            var centerY = y2 - (index + 1) * slot;
            dynamic unit = page.DrawOval(centerX - diameter / 2, centerY - diameter / 2, centerX + diameter / 2, centerY + diameter / 2);
            ApplyFill(unit, accent, 0.5);
            NameAndAnnotatePrimitive(unit, group, ids[index]);
        }
    }

    private static void DrawPoolingWedge(dynamic page, VisioPrimitiveGroup group, double x1, double y1, double x2, double y2, (int R, int G, int B) fill, double lineWeight)
    {
        var inset = Math.Min((y2 - y1) * 0.22, 0.24);
        var skewX = Math.Max(0.06, Math.Abs(group.SkewXInches));
        var skewY = Math.Max(0.05, Math.Abs(group.SkewYInches));
        dynamic front = DrawClosedPolygon(page, new double[] { x1, y1, x2, y1 + inset, x2, y2 - inset, x1, y2, x1, y1 });
        ApplyFill(front, fill, lineWeight);
        NameAndAnnotatePrimitive(front, group, RequiredFaceId(group, "front"));
        dynamic top = DrawClosedPolygon(page, new double[] { x1, y2, x2, y2 - inset, x2 + skewX, y2 - inset + skewY, x1 + skewX, y2 + skewY, x1, y2 });
        ApplyFill(top, Shade(fill, 0.94), lineWeight);
        NameAndAnnotatePrimitive(top, group, RequiredFaceId(group, "top"));
        dynamic side = DrawClosedPolygon(page, new double[] { x2, y1 + inset, x2, y2 - inset, x2 + skewX, y2 - inset + skewY, x2 + skewX, y1 + inset + skewY, x2, y1 + inset });
        ApplyFill(side, Shade(fill, 0.82), lineWeight);
        NameAndAnnotatePrimitive(side, group, RequiredFaceId(group, "side"));
    }

    private static void DrawPrismFaces(dynamic page, VisioPrimitiveGroup group, double x1, double y1, double x2, double y2, (int R, int G, int B) fill, double lineWeight, string primitivePrefix)
    {
        var skewX = Math.Max(0.06, Math.Abs(group.SkewXInches));
        var skewY = Math.Max(0.05, Math.Abs(group.SkewYInches));
        dynamic front = page.DrawRectangle(x1, y1, x2, y2);
        ApplyFill(front, fill, lineWeight);
        NameAndAnnotatePrimitive(front, group, RequiredFaceId(group, primitivePrefix, "front"));
        dynamic top = DrawClosedPolygon(page, new double[] { x1, y2, x2, y2, x2 + skewX, y2 + skewY, x1 + skewX, y2 + skewY, x1, y2 });
        ApplyFill(top, Shade(fill, 0.94), lineWeight);
        NameAndAnnotatePrimitive(top, group, RequiredFaceId(group, primitivePrefix, "top"));
        dynamic side = DrawClosedPolygon(page, new double[] { x2, y1, x2, y2, x2 + skewX, y2 + skewY, x2 + skewX, y1 + skewY, x2, y1 });
        ApplyFill(side, Shade(fill, 0.82), lineWeight);
        NameAndAnnotatePrimitive(side, group, RequiredFaceId(group, primitivePrefix, "side"));
    }

    private static bool HasPrismFaces(VisioPrimitiveGroup group) =>
        group.PrimitiveIds.Contains(group.Id + ".front", StringComparer.Ordinal)
        && group.PrimitiveIds.Contains(group.Id + ".top", StringComparer.Ordinal)
        && group.PrimitiveIds.Contains(group.Id + ".side", StringComparer.Ordinal);

    private static string RequiredFaceId(VisioPrimitiveGroup group, string face) =>
        group.PrimitiveIds.Single(id => string.Equals(id, group.Id + "." + face, StringComparison.Ordinal));

    private static string RequiredFaceId(VisioPrimitiveGroup group, string primitivePrefix, string face) =>
        group.PrimitiveIds.Single(id => string.Equals(id, primitivePrefix + "." + face, StringComparison.Ordinal));

    private static void NameAndAnnotatePrimitive(dynamic shape, VisioPrimitiveGroup group, string primitiveId)
    {
        TrySet(() => shape.NameU = $"synapse.primitive.{SanitizeName(primitiveId)}");
        foreach (var property in group.ShapeData) TrySetShapeData(shape, property.Key, property.Value);
        TrySetShapeData(shape, "synapse.primitiveId", primitiveId);
    }

    private static void DrawPrimitiveLabel(dynamic page, VisioPrimitiveGroup group, double x1, double y1, double x2, double y2)
    {
        dynamic label = page.DrawRectangle(x1, y1, x2, y2);
        var repeat = group.ShapeData.TryGetValue("synapse.repeatCount", out var repeatCount) && repeatCount != "1" ? " x" + repeatCount : "";
        var tensor = group.ShapeData.TryGetValue("synapse.tensorShape", out var tensorShape) ? tensorShape : "";
        label.Text = string.IsNullOrWhiteSpace(tensor) ? group.Id + repeat : group.Id + repeat + "\n" + tensor;
        TrySet(() => label.NameU = $"synapse.label.{SanitizeName(group.Id)}");
        TrySet(() => label.CellsU("FillPattern").FormulaU = "0");
        TrySet(() => label.CellsU("LinePattern").FormulaU = "0");
        TrySet(() => label.CellsU("Char.Size").FormulaU = "8 pt");
        TrySet(() => label.CellsU("Para.HorzAlign").FormulaU = "1");
    }

    private static void DrawFigurePlanLabel(dynamic page, VisioFigureLabel label, double pageHeight)
    {
        var x1 = label.XInches;
        var y1 = pageHeight - label.YInches - label.HeightInches;
        var x2 = x1 + label.WidthInches;
        var y2 = y1 + label.HeightInches;
        dynamic shape = page.DrawRectangle(x1, y1, x2, y2);
        shape.Text = label.Text;
        TrySet(() => shape.NameU = $"synapse.label.{SanitizeName(label.Id)}");
        TrySet(() => shape.CellsU("FillPattern").FormulaU = "0");
        TrySet(() => shape.CellsU("LinePattern").FormulaU = "0");
        TrySet(() => shape.CellsU("Char.Font").FormulaU = "FONT(\"Arial\")");
        TrySet(() => shape.CellsU("Char.Size").FormulaU = $"{label.FontSizePt.ToString(System.Globalization.CultureInfo.InvariantCulture)} pt");
        if (label.Id.EndsWith(".heading", StringComparison.Ordinal)) TrySet(() => shape.CellsU("Char.Style").FormulaU = "1");
        TrySet(() => shape.CellsU("Para.HorzAlign").FormulaU = "1");
    }

    private static void DrawTextLabel(dynamic page, VisioNode node, double x1, double y1, double x2, double y2)
    {
        dynamic label = page.DrawRectangle(x1, y1, x2, y2);
        var repeatLabel = node.RepeatCount > 1 ? $" x{node.RepeatCount}" : "";
        label.Text = string.IsNullOrWhiteSpace(node.TensorShape) ? $"{node.Label}{repeatLabel}" : $"{node.Label}{repeatLabel}\n{node.TensorShape}";
        TrySet(() => label.NameU = $"synapse.label.{SanitizeName(node.Id)}");
        TrySet(() => label.CellsU("FillPattern").FormulaU = "0");
        TrySet(() => label.CellsU("LinePattern").FormulaU = "0");
        TrySet(() => label.CellsU("Char.Size").FormulaU = "9 pt");
        TrySet(() => label.CellsU("Para.HorzAlign").FormulaU = "1");
    }

    private static void DrawTitle(dynamic page, string title, double pageHeight, double pageWidth)
    {
        dynamic label = page.DrawRectangle(0.45, pageHeight - 0.65, Math.Max(0.9, pageWidth - 0.45), pageHeight - 0.2);
        label.Text = title;
        TrySet(() => label.NameU = "synapse.title");
        TrySet(() => label.CellsU("FillPattern").FormulaU = "0");
        TrySet(() => label.CellsU("LinePattern").FormulaU = "0");
        TrySet(() => label.CellsU("Char.Font").FormulaU = "FONT(\"Arial\")");
        TrySet(() => label.CellsU("Char.Size").FormulaU = "12 pt");
        TrySet(() => label.CellsU("Char.Style").FormulaU = "1");
        TrySet(() => label.CellsU("Para.HorzAlign").FormulaU = "1");
    }

    private static void DrawStageLabels(dynamic page, DiagramDocument document)
    {
        if (document.StageLabels.Count > 8) return;
        foreach (var stage in document.StageLabels.Select((label, index) => (label, index)))
        {
            var nodes = document.Nodes.Where(node => node.Stage == stage.index).ToArray();
            if (nodes.Length == 0) continue;
            var x = nodes.Average(node => node.XInches + node.WidthInches / 2);
            dynamic label = page.DrawRectangle(x - 0.55, 0.34, x + 0.55, 0.62);
            label.Text = stage.label;
            TrySet(() => label.NameU = $"synapse.stage.{stage.index}");
            TrySet(() => label.CellsU("FillPattern").FormulaU = "0");
            TrySet(() => label.CellsU("LinePattern").FormulaU = "0");
            TrySet(() => label.CellsU("Char.Size").FormulaU = "6 pt");
            TrySet(() => label.CellsU("Para.HorzAlign").FormulaU = "1");
        }
    }

    private static void DrawLegend(dynamic page)
    {
        var items = new[] { ("Convolution + ReLU", 79, 134, 198), ("Max Pooling", 198, 91, 91), ("Fully Connected + ReLU", 88, 166, 166), ("Softmax", 201, 163, 78) };
        var x = 0.55;
        foreach (var item in items)
        {
            dynamic swatch = page.DrawRectangle(x, 0.72, x + 0.22, 0.94);
            ApplyFill(swatch, (item.Item2, item.Item3, item.Item4), 1.0);
            TrySet(() => swatch.NameU = $"synapse.legend.{SanitizeName(item.Item1)}");
            dynamic label = page.DrawRectangle(x + 0.28, 0.68, x + 2.15, 0.98);
            label.Text = item.Item1;
            TrySet(() => label.CellsU("FillPattern").FormulaU = "0");
            TrySet(() => label.CellsU("LinePattern").FormulaU = "0");
            TrySet(() => label.CellsU("Char.Size").FormulaU = "6 pt");
            x += 6.05;
        }
    }

    private static void ApplyFill(dynamic shape, (int R, int G, int B) color, double lineWeight, (int R, int G, int B)? stroke = null)
    {
        var line = stroke ?? (Math.Max(0, color.R - 35), Math.Max(0, color.G - 35), Math.Max(0, color.B - 35));
        TrySet(() => shape.CellsU("FillPattern").FormulaU = "1");
        TrySet(() => shape.CellsU("FillForegnd").FormulaU = $"RGB({color.R},{color.G},{color.B})");
        TrySet(() => shape.CellsU("LineColor").FormulaU = $"RGB({line.R},{line.G},{line.B})");
        TrySet(() => shape.CellsU("LineWeight").FormulaU = $"{lineWeight.ToString(System.Globalization.CultureInfo.InvariantCulture)} pt");
    }

    private static (int R, int G, int B) ParseColor(string? value, int fallbackR, int fallbackG, int fallbackB)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length != 7 || value[0] != '#') return (fallbackR, fallbackG, fallbackB);
        return (Convert.ToInt32(value[1..3], 16), Convert.ToInt32(value[3..5], 16), Convert.ToInt32(value[5..7], 16));
    }

    private static (int R, int G, int B) Blend((int R, int G, int B) color, double factor) =>
        ((int)(color.R * factor + 255 * (1 - factor)), (int)(color.G * factor + 255 * (1 - factor)), (int)(color.B * factor + 255 * (1 - factor)));

    private static (int R, int G, int B) Shade((int R, int G, int B) color, double factor) =>
        ((int)(color.R * factor), (int)(color.G * factor), (int)(color.B * factor));

    private static int ReadPositiveInteger(VisioPrimitiveGroup group, string key, int fallback)
    {
        return group.ShapeData.TryGetValue(key, out var raw)
            && int.TryParse(raw, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var value)
            && value > 0
            ? value
            : fallback;
    }

    private static void DrawConnector(dynamic page, VisioConnector connector, double pageHeight)
    {
        var points = FlattenConnectorPoints(connector, pageHeight);
        dynamic shape;
        try
        {
            shape = page.DrawPolyline(points, 0);
        }
        catch (Exception error) when (connector.Points.Count > 2)
        {
            throw new WorkerProtocolException($"Visio could not preserve the planned orthogonal route for connector {connector.Id}.", error);
        }
        catch
        {
            var first = connector.Points[0];
            var last = connector.Points[^1];
            shape = page.DrawLine(first.X, pageHeight - first.Y, last.X, pageHeight - last.Y);
        }
        TrySet(() => shape.NameU = $"synapse.edge.{SanitizeName(connector.Id)}");
        TrySet(() => shape.CellsU("EndArrow").FormulaU = "4");
        var stroke = connector.Style is null ? (75, 91, 120) : ParseColor(connector.Style.StrokeColor, 75, 91, 120);
        var lineWeight = connector.Style?.StrokeWidthPoints ?? 1.2;
        TrySet(() => shape.CellsU("LineColor").FormulaU = $"RGB({stroke.Item1},{stroke.Item2},{stroke.Item3})");
        TrySet(() => shape.CellsU("LineWeight").FormulaU = $"{lineWeight.ToString(System.Globalization.CultureInfo.InvariantCulture)} pt");
    }

    private static double[] FlattenConnectorPoints(VisioConnector connector, double pageHeight) =>
        connector.Points.SelectMany(point => new[] { point.X, pageHeight - point.Y }).ToArray();

    internal static int CountNamedShapes(dynamic page, string prefix)
    {
        var count = 0;
        foreach (dynamic shape in page.Shapes)
        {
            string name = Convert.ToString(shape.NameU, System.Globalization.CultureInfo.InvariantCulture) ?? "";
            if (name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) count++;
        }
        return count;
    }

    internal static ReadbackResult ReadFigurePlanReadback(dynamic page, VisioFigurePlan plan, int shapeCount)
    {
        var primitiveByShapeName = plan.PrimitiveGroups
            .SelectMany(group => group.PrimitiveIds.Select(primitiveId => new { ShapeName = PrimitiveShapeName(primitiveId), PrimitiveId = primitiveId, Group = group }))
            .ToDictionary(item => item.ShapeName, StringComparer.OrdinalIgnoreCase);
        var connectorByShapeName = plan.Connectors
            .ToDictionary(connector => ConnectorShapeName(connector.Id), connector => connector.Id, StringComparer.OrdinalIgnoreCase);
        var primitives = new List<ReadbackPrimitive>();
        var connectors = new List<string>();

        foreach (dynamic shape in page.Shapes)
        {
            string name = Convert.ToString(shape.NameU, System.Globalization.CultureInfo.InvariantCulture) ?? "";
            if (primitiveByShapeName.TryGetValue(name, out var primitive))
            {
                var data = new Dictionary<string, string>(StringComparer.Ordinal);
                foreach (var key in primitive.Group.ShapeData.Keys.Append("synapse.primitiveId"))
                {
                    var value = TryReadShapeData(shape, key);
                    if (value is not null) data[key] = value;
                }
                primitives.Add(new ReadbackPrimitive(primitive.PrimitiveId, data));
            }
            if (connectorByShapeName.TryGetValue(name, out var connectorId)) connectors.Add(connectorId);
        }

        return ReadbackValidator.Validate(plan, primitives, connectors, shapeCount);
    }

    internal static string? TryReadShapeData(dynamic shape, string key)
    {
        try
        {
            var rowName = new string(key.Select(character => char.IsLetterOrDigit(character) ? character : '_').ToArray());
            dynamic cell = shape.CellsU($"Prop.{rowName}");
            try
            {
                return Convert.ToString(cell.ResultStr[0], System.Globalization.CultureInfo.InvariantCulture);
            }
            catch
            {
                var formula = Convert.ToString(cell.FormulaU, System.Globalization.CultureInfo.InvariantCulture);
                if (string.IsNullOrWhiteSpace(formula)) return null;
                return formula.Length >= 2 && formula[0] == '"' && formula[^1] == '"'
                    ? formula[1..^1].Replace("\"\"", "\"")
                    : formula;
            }
        }
        catch
        {
            return null;
        }
    }

    internal static string? ReadShapeDataOrNullStrict(dynamic shape, string key)
    {
        dynamic? cell = null;
        try
        {
            var rowName = new string(key.Select(character => char.IsLetterOrDigit(character) ? character : '_').ToArray());
            var exists = Convert.ToInt32(shape.CellExistsU($"Prop.{rowName}", 0), System.Globalization.CultureInfo.InvariantCulture) != 0;
            if (!exists) return null;

            cell = shape.CellsU($"Prop.{rowName}");
            try
            {
                return Convert.ToString(cell.ResultStr[0], System.Globalization.CultureInfo.InvariantCulture);
            }
            catch
            {
                var formula = Convert.ToString(cell.FormulaU, System.Globalization.CultureInfo.InvariantCulture);
                if (string.IsNullOrWhiteSpace(formula)) return string.Empty;
                return formula.Length >= 2 && formula[0] == '"' && formula[^1] == '"'
                    ? formula[1..^1].Replace("\"\"", "\"")
                    : formula;
            }
        }
        catch (WorkerProtocolException)
        {
            throw;
        }
        catch (Exception error)
        {
            throw new WorkerProtocolException($"Visio session ownership data could not be read: {error.Message}", error);
        }
        finally
        {
            ReleaseCom(cell);
        }
    }

    private static string PrimitiveShapeName(string primitiveId) => $"synapse.primitive.{SanitizeName(primitiveId)}";

    private static string ConnectorShapeName(string connectorId) => $"synapse.edge.{SanitizeName(connectorId)}";

    internal static void TrySetPageSize(dynamic page, double pageWidth, double pageHeight)
    {
        TrySet(() => page.PageSheet.CellsU("PageWidth").FormulaU = $"{pageWidth.ToString(System.Globalization.CultureInfo.InvariantCulture)} in");
        TrySet(() => page.PageSheet.CellsU("PageHeight").FormulaU = $"{pageHeight.ToString(System.Globalization.CultureInfo.InvariantCulture)} in");
        TrySet(() => page.PageSheet.CellsU("PageScale").FormulaU = "1 in");
        TrySet(() => page.PageSheet.CellsU("DrawingScale").FormulaU = "1 in");
    }

    internal static void TrySetShapeData(dynamic shape, string key, string value)
    {
        try
        {
            var rowName = new string(key.Select(character => char.IsLetterOrDigit(character) ? character : '_').ToArray());
            shape.AddNamedRow(243, rowName, 0);
            shape.CellsU($"Prop.{rowName}.Label").FormulaU = $"\"{key}\"";
            shape.CellsU($"Prop.{rowName}").FormulaU = $"\"{value.Replace("\"", "\"\"")}\"";
        }
        catch { }
    }

    internal static void SetRequiredShapeData(dynamic shape, string key, string value)
    {
        var rowName = new string(key.Select(character => char.IsLetterOrDigit(character) ? character : '_').ToArray());
        var escapedValue = value.Replace("\"", "\"\"");
        shape.AddNamedRow(243, rowName, 0);
        shape.CellsU($"Prop.{rowName}.Label").FormulaU = $"\"{key}\"";
        shape.CellsU($"Prop.{rowName}").FormulaU = "\"" + escapedValue + "\"";
    }

    internal static void TrySet(Action action)
    {
        try { action(); }
        catch { }
    }

    internal static void TryClose(dynamic? doc)
    {
        if (doc is null) return;
        TrySet(() => doc.Close());
    }

    private static void TryFitDocumentWindow(dynamic? doc)
    {
        if (doc is null) return;
        dynamic? window = null;
        try
        {
            window = doc.Windows.Item(1);
            window.ViewFit();
        }
        catch { }
        finally
        {
            ReleaseCom(window);
        }
    }

    internal static void ExitApplication(
        object? application,
        bool workerCreatedApplication,
        OwnedVisioApplicationExit? ownedApplicationExit)
    {
        if (application is null) return;
        var exit = OwnedVisioApplicationExit.RequireForShutdown(workerCreatedApplication, ownedApplicationExit);
        if (exit is null) return;
        exit.RequestQuit(application);
        exit.WaitForExitOrTerminate();
    }

    internal static void ReleaseCom(object? value)
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

    internal static string SanitizeName(string value) => new(value.Select(character => char.IsLetterOrDigit(character) ? character : '_').ToArray());

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch { }
    }

    [DllImport("oleaut32.dll", PreserveSig = false)]
    private static extern void GetActiveObject(ref Guid clsid, IntPtr reserved, [MarshalAs(UnmanagedType.Interface)] out object value);
}
