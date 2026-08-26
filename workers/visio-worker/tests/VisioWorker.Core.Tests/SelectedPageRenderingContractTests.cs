using System.Reflection;
using VisioWorker.Core;
using VisioWorker.Live;

namespace VisioWorker.Core.Tests;

public sealed class SelectedPageRenderingContractTests
{
    [Fact]
    public void Selected_page_rendering_rejects_a_legacy_document_without_a_figure_plan()
    {
        var legacy = new DiagramDocument("legacy", [], [], []);

        var method = typeof(VisioComEngine).GetMethod("PrepareSelectedPageRegion", BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(method);
        var invocation = Assert.Throws<TargetInvocationException>(() => method.Invoke(null, [new object(), legacy]));
        var error = Assert.IsType<WorkerProtocolException>(invocation.InnerException);

        Assert.Contains("figure plan", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Prepared_region_token_cannot_be_constructed_from_a_raw_plan_by_a_caller()
    {
        var publicConstructors = typeof(PreparedSelectedPageRegion).GetConstructors(BindingFlags.Public | BindingFlags.Instance);

        Assert.Empty(publicConstructors);
    }

    [Fact]
    public void Prepared_selected_page_draw_accepts_only_the_prepared_region_token()
    {
        var method = typeof(VisioComEngine).GetMethod("DrawPreparedSelectedPageRegion", BindingFlags.NonPublic | BindingFlags.Static);

        Assert.NotNull(method);
        Assert.Equal(typeof(PreparedSelectedPageRegion), method.GetParameters()[1].ParameterType);
    }

    [Fact]
    public void Selected_page_figure_plan_is_scaled_and_centered_inside_the_existing_page()
    {
        var source = new DiagramDocument(
            string.Empty,
            [],
            [],
            [],
            new VisioFigurePlan(
                11,
                7,
                [new VisioPrimitiveGroup("right", "pvp-module-frame", new VisioBounds(8.5, 3, 1.3, 0.7), 0.1, 0.06, 0.05, ["right"], new Dictionary<string, string>())],
                [new VisioConnector("edge", "left", "right", "flow", [new DiagramPoint(1.9, 3.35), new DiagramPoint(8.5, 3.35)])],
                [new VisioFigureLabel("right.label", "right", "Prediction", 8.5, 3.75, 1.3, 0.18, 9)]));
        var method = typeof(VisioComEngine).GetMethod("FitSelectedPageDocument", BindingFlags.NonPublic | BindingFlags.Static);

        Assert.NotNull(method);
        var fitted = Assert.IsType<DiagramDocument>(method.Invoke(null, [source, 4.25d, 6.5d]));
        var plan = Assert.IsType<VisioFigurePlan>(fitted.FigurePlan);
        var group = Assert.Single(plan.PrimitiveGroups);

        Assert.Equal(4.25, plan.PageWidthInches, 3);
        Assert.Equal(6.5, plan.PageHeightInches, 3);
        Assert.True(group.Bounds.WidthInches > 0.55, "content fitting must not scale unused source-page whitespace");
        Assert.InRange(group.Bounds.XInches, 0.29, 4.25 - group.Bounds.WidthInches - 0.29);
        Assert.InRange(group.Bounds.YInches, 0.29, 6.5 - group.Bounds.HeightInches - 0.29);
        Assert.All(Assert.Single(plan.Connectors).Points, point =>
        {
            Assert.InRange(point.X, 0.29, 3.96);
            Assert.InRange(point.Y, 0.29, 6.21);
        });
        Assert.Equal(11, source.FigurePlan!.PageWidthInches);
    }

    [Fact]
    public void Selected_page_fitting_rejects_a_page_that_cannot_preserve_readable_labels()
    {
        var source = new DiagramDocument(
            string.Empty,
            [],
            [],
            [],
            new VisioFigurePlan(
                11,
                7,
                [new VisioPrimitiveGroup("module", "pvp-module-frame", new VisioBounds(1, 1, 8, 4), 0.1, 0.06, 0.05, ["module"], new Dictionary<string, string>(), InlineLabel: "A readable module label")],
                [],
                []));
        var method = typeof(VisioComEngine).GetMethod("FitSelectedPageDocument", BindingFlags.NonPublic | BindingFlags.Static);

        Assert.NotNull(method);
        var invocation = Assert.Throws<TargetInvocationException>(() => method.Invoke(null, [source, 1d, 1d]));
        var error = Assert.IsType<WorkerProtocolException>(invocation.InnerException);
        Assert.Contains("readable", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Selected_page_preparation_fails_closed_when_actual_page_dimensions_are_unavailable()
    {
        var source = new DiagramDocument(
            string.Empty,
            [],
            [],
            [],
            new VisioFigurePlan(
                11,
                7,
                [new VisioPrimitiveGroup("module", "pvp-module-frame", new VisioBounds(1, 1, 8, 4), 0.1, 0.06, 0.05, ["module"], new Dictionary<string, string>(), InlineLabel: "Module")],
                [],
                []));
        var method = typeof(VisioComEngine).GetMethod("PrepareSelectedPageRegion", BindingFlags.NonPublic | BindingFlags.Static);

        Assert.NotNull(method);
        var invocation = Assert.Throws<TargetInvocationException>(() => method.Invoke(null, [new MissingMetricsPage(), source]));
        var error = Assert.IsType<WorkerProtocolException>(invocation.InnerException);
        Assert.Contains("dimensions", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void An_explicit_empty_label_plan_does_not_enable_legacy_identifier_labels()
    {
        var method = typeof(VisioComEngine).GetMethod("UsesLegacyFallbackLabels", BindingFlags.NonPublic | BindingFlags.Static);
        var group = new VisioPrimitiveGroup("primitive:node:input", "pvp-input-terminal", new VisioBounds(0, 0, 1, 0.5), 0, 0, 0, ["primitive:node:input"], new Dictionary<string, string>(), InlineLabel: "Input");

        Assert.NotNull(method);
        Assert.False(Assert.IsType<bool>(method.Invoke(null, [new VisioFigurePlan(2, 1, [group], [], [])])));
        Assert.True(Assert.IsType<bool>(method.Invoke(null, [new VisioFigurePlan(2, 1, [group with { InlineLabel = null }], [], null)])));
    }

    [Fact]
    public void Connector_polyline_coordinates_are_a_native_double_array_with_visio_y_coordinates()
    {
        var method = typeof(VisioComEngine).GetMethod("FlattenConnectorPoints", BindingFlags.NonPublic | BindingFlags.Static);
        var connector = new VisioConnector("skip", "source", "target", "skip", [new DiagramPoint(1, 2), new DiagramPoint(3, 4)]);

        Assert.NotNull(method);
        var points = Assert.IsType<double[]>(method.Invoke(null, [connector, 10d]));
        Assert.Equal([1d, 8d, 3d, 6d], points);
    }

    [Fact]
    public void Selected_page_metric_reads_the_com_cells_u_indexer_in_internal_units()
    {
        var method = typeof(VisioComEngine).GetMethod("ReadSelectedPageMetric", BindingFlags.NonPublic | BindingFlags.Static);

        Assert.NotNull(method);
        var width = Assert.IsType<double>(method.Invoke(null, [new FakePage(8.26771653543307), "PageWidth", 99d]));
        Assert.Equal(8.26771653543307, width, 10);
    }

    [Fact]
    public void Marker_glyphs_have_deterministic_publication_typography()
    {
        var method = typeof(VisioComEngine).GetMethod("ApplyMarkerGlyph", BindingFlags.NonPublic | BindingFlags.Static);
        var shape = new FakeTextShape();

        Assert.NotNull(method);
        method.Invoke(null, [shape, "+"]);

        Assert.Equal("+", shape.Text);
        Assert.Equal("FONT(\"Arial\")", shape.Cells["Char.Font"].FormulaU);
        Assert.Equal("9 pt", shape.Cells["Char.Size"].FormulaU);
        Assert.Equal("1", shape.Cells["Char.Style"].FormulaU);
        Assert.Equal("RGB(30,41,59)", shape.Cells["Char.Color"].FormulaU);
        Assert.Equal("1", shape.Cells["Para.HorzAlign"].FormulaU);
        Assert.Equal("1", shape.Cells["VerticalAlign"].FormulaU);
    }

    [Fact]
    public void Selected_page_connection_requires_an_existing_running_Visio_application()
    {
        var method = typeof(VisioComEngine).GetMethod("RequireRunningVisioApplication", BindingFlags.NonPublic | BindingFlags.Static);

        Assert.NotNull(method);
        var invocation = Assert.Throws<TargetInvocationException>(() => method.Invoke(null, [null]));
        var error = Assert.IsType<WorkerProtocolException>(invocation.InnerException);
        Assert.Contains("running Visio", error.Message, StringComparison.OrdinalIgnoreCase);

        var running = new object();
        Assert.Same(running, method.Invoke(null, [running]));
    }

    public sealed class FakePage(double value)
    {
        public FakePageSheet PageSheet { get; } = new(value);
    }

    public sealed class MissingMetricsPage
    {
        public MissingMetricsPageSheet PageSheet { get; } = new();
    }

    public sealed class MissingMetricsPageSheet
    {
        public MissingMetricsCellCollection CellsU { get; } = new();
    }

    public sealed class MissingMetricsCellCollection
    {
        public FakeCell this[string _] => throw new InvalidOperationException("Page metric unavailable");
    }

    public sealed class FakePageSheet(double value)
    {
        public FakeCellCollection CellsU { get; } = new(value);
    }

    public sealed class FakeCellCollection(double value)
    {
        public FakeCell this[string _] => new(value);
    }

    public sealed class FakeCell(double value)
    {
        public double ResultIU { get; } = value;
    }

    public sealed class FakeTextShape
    {
        public string Text { get; set; } = string.Empty;
        public Dictionary<string, FakeFormulaCell> Cells { get; } = [];

        public FakeFormulaCell CellsU(string name)
        {
            if (!Cells.TryGetValue(name, out var cell)) Cells[name] = cell = new FakeFormulaCell();
            return cell;
        }
    }

    public sealed class FakeFormulaCell
    {
        public string FormulaU { get; set; } = string.Empty;
    }
}
