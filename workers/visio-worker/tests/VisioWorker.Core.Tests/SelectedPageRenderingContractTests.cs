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
    public void Prepared_selected_page_draw_requires_the_prepared_region_token_and_creation_callback()
    {
        var method = typeof(VisioComEngine).GetMethod("DrawPreparedSelectedPageRegion", BindingFlags.NonPublic | BindingFlags.Static);

        Assert.NotNull(method);
        Assert.Equal(
            [typeof(object), typeof(PreparedSelectedPageRegion), typeof(Action<int, IReadOnlyList<string>, SelectedPageShapeRole>)],
            method.GetParameters().Select(parameter => parameter.ParameterType));

        var drawingMethods = typeof(ShapeTrackingPage)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance)
            .Where(method => method.Name.StartsWith("Draw", StringComparison.Ordinal))
            .ToArray();
        Assert.NotEmpty(drawingMethods);
        Assert.All(drawingMethods, method =>
            Assert.Equal(
                [typeof(IReadOnlyList<string>), typeof(SelectedPageShapeRole)],
                method.GetParameters().Take(2).Select(parameter => parameter.ParameterType)));
    }

    [Fact]
    public void Prepared_selected_page_draw_reports_every_created_shape_before_later_shape_work()
    {
        var page = new RecordingDrawingPage();
        var created = new List<SelectedPageShapeCreationEntry>();
        var plan = new VisioFigurePlan(
            11,
            7,
            [
                Group("input", "pvp-input-terminal", ["input"]),
                Group("output", "pvp-output-terminal", ["output"]),
            ],
            [new VisioConnector("edge", "input", "output", "flow", [new DiagramPoint(1, 1), new DiagramPoint(2, 1)])],
            [new VisioFigureLabel("annotation", "input", "Annotation", 3, 1, 1.2, 0.3, 9)]);
        var prepared = new PreparedSelectedPageRegion(
            new SelectedPageTarget("document-1", "page-1", new string('a', 64), new string('b', 64), 1),
            new DiagramDocument("Figure", [], [], [], plan));
        var method = typeof(VisioComEngine).GetMethod("DrawPreparedSelectedPageRegion", BindingFlags.NonPublic | BindingFlags.Static);

        Assert.NotNull(method);
        method.Invoke(null, [page, prepared, (Action<int, IReadOnlyList<string>, SelectedPageShapeRole>)((shapeId, semanticIds, role) =>
        {
            created.Add(new SelectedPageShapeCreationEntry(shapeId, semanticIds, role));
            page.Events.Add($"reported:{shapeId}");
        })]);

        Assert.NotEmpty(page.CreatedShapeIds);
        Assert.Equal(page.CreatedShapeIds, created.Select(entry => entry.ShapeId));
        Assert.Contains(page.CreationKinds, kind => kind == "rectangle");
        Assert.Contains(page.CreationKinds, kind => kind == "polyline");
        Assert.All(created, entry => Assert.NotEmpty(entry.SemanticIds));
        Assert.Contains(created, entry => entry.Role == SelectedPageShapeRole.Primary && entry.SemanticIds.SequenceEqual(["input"]));
        Assert.Contains(created, entry => entry.Role == SelectedPageShapeRole.Label && entry.SemanticIds.SequenceEqual(["input"]));
        Assert.Contains(created, entry => entry.Role == SelectedPageShapeRole.Connector && entry.SemanticIds.SequenceEqual(["input", "output"]));
        Assert.Contains(created, entry => entry.Role == SelectedPageShapeRole.Title && entry.SemanticIds.SequenceEqual(["plan-1"]));
        foreach (var shapeId in page.CreatedShapeIds)
        {
            var createdIndex = page.Events.IndexOf($"created:{shapeId}");
            var reportedIndex = page.Events.IndexOf($"reported:{shapeId}");
            var firstShapeWorkIndex = page.Events.FindIndex(item => item.StartsWith($"shape-work:{shapeId}:", StringComparison.Ordinal));
            Assert.True(createdIndex >= 0 && reportedIndex == createdIndex + 1, $"Shape {shapeId} was not reported immediately after creation.");
            Assert.True(firstShapeWorkIndex < 0 || reportedIndex < firstShapeWorkIndex, $"Shape {shapeId} was styled before it was reported.");
        }
    }

    [Fact]
    public void Formal_auxiliary_oval_is_invoked_and_recorded_with_exact_context_before_shape_work()
    {
        var page = new OvalDrawingPage();
        var created = new List<SelectedPageShapeCreationEntry>();
        var group = Group(
            "component:dense",
            "dense-vector-layer",
            ["component:dense.frame", "component:dense.unit-1"]);
        var prepared = Prepared(new VisioFigurePlan(11, 7, [group], [], []));

        VisioComEngine.DrawPreparedSelectedPageRegion(page, prepared, (shapeId, semanticIds, role) =>
        {
            created.Add(new SelectedPageShapeCreationEntry(shapeId, semanticIds, role));
            page.Events.Add($"reported:{shapeId}");
        });

        Assert.Equal(1, page.DrawOvalCalls);
        var oval = Assert.Single(page.Created, item => item.Kind == "oval");
        Assert.True(oval.ShapeId > 0);
        var entry = Assert.Single(created, item => item.ShapeId == oval.ShapeId);
        Assert.Equal(["component:dense"], entry.SemanticIds);
        Assert.Equal(SelectedPageShapeRole.Auxiliary, entry.Role);
        AssertRecordedBeforeShapeWork(page.Events, oval.ShapeId);
    }

    [Fact]
    public void Two_point_connector_falls_back_once_and_records_exact_context_before_shape_work()
    {
        var page = new ConnectorFallbackDrawingPage();
        var created = new List<SelectedPageShapeCreationEntry>();
        var source = Group("component:source", "pvp-input-terminal", ["component:source"]);
        var target = Group("component:target", "pvp-output-terminal", ["component:target"]);
        var connector = new VisioConnector(
            "connector-1",
            source.Id,
            target.Id,
            "flow",
            [new DiagramPoint(1, 1), new DiagramPoint(2, 1)]);
        var prepared = Prepared(new VisioFigurePlan(11, 7, [source, target], [connector], []));

        VisioComEngine.DrawPreparedSelectedPageRegion(page, prepared, (shapeId, semanticIds, role) =>
        {
            created.Add(new SelectedPageShapeCreationEntry(shapeId, semanticIds, role));
            page.Events.Add($"reported:{shapeId}");
        });

        Assert.Equal(1, page.DrawPolylineCalls);
        Assert.Equal(1, page.DrawLineCalls);
        var line = Assert.Single(page.Created, item => item.Kind == "line");
        Assert.True(line.ShapeId > 0);
        var entry = Assert.Single(created, item => item.ShapeId == line.ShapeId);
        Assert.Equal(["component:source", "component:target"], entry.SemanticIds);
        Assert.Equal(SelectedPageShapeRole.Connector, entry.Role);
        AssertRecordedBeforeShapeWork(page.Events, line.ShapeId);
    }

    [Fact]
    public void Every_shape_producing_helper_requires_the_tracking_page()
    {
        var bypasses = typeof(VisioComEngine)
            .GetMethods(BindingFlags.NonPublic | BindingFlags.Static)
            .Where(method => method.Name.StartsWith("Draw", StringComparison.Ordinal))
            .Where(method => method.Name != "DrawPreparedSelectedPageRegion")
            .Where(method => method.GetParameters().FirstOrDefault()?.Name == "page")
            .Where(method => method.GetParameters()[0].ParameterType != typeof(ShapeTrackingPage))
            .Select(method => method.Name)
            .Order()
            .ToArray();

        Assert.Empty(bypasses);
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

    [Fact]
    public void Required_shape_data_updates_an_existing_row_without_adding_it_again()
    {
        var method = typeof(VisioComEngine).GetMethod("SetRequiredShapeData", BindingFlags.NonPublic | BindingFlags.Static);
        var shape = new ExistingRowRejectingShape();

        Assert.NotNull(method);
        method.Invoke(null, [shape, "synapse.sessionOwner", "staging-owner"]);
        method.Invoke(null, [shape, "synapse.sessionOwner", "final-owner"]);

        Assert.Equal(1, shape.AddNamedRowCalls);
        Assert.Equal("\"final-owner\"", shape.Cells["Prop.synapse_sessionOwner"].FormulaU);
    }

    [Fact]
    public void Publication_operator_and_module_frames_use_distinct_semantic_containers()
    {
        var page = new PublicationDrawingPage();
        var operatorGroup = Group("operator", "pvp-operator-frame", ["operator"]);
        var moduleGroup = Group("module", "pvp-module-frame", ["module"]);
        var prepared = Prepared(new VisioFigurePlan(11, 7, [operatorGroup, moduleGroup], [], []));

        VisioComEngine.DrawPreparedSelectedPageRegion(page, prepared, (_, _, _) => { });

        Assert.Contains(page.Created, shape => shape.Kind == "polyline");
        var module = Assert.Single(page.Created, shape => shape.NameU == "synapse.primitive.module");
        Assert.Equal("rectangle", module.Kind);
        Assert.Equal("0.08 in", module.Cells["Rounding"].FormulaU);
    }

    [Fact]
    public void Publication_secondary_connectors_are_visually_deemphasized_without_changing_topology()
    {
        var page = new PublicationDrawingPage();
        var source = Group("source", "pvp-module-frame", ["source"]);
        var target = Group("target", "pvp-module-frame", ["target"]);
        var connector = new VisioConnector(
            "skip-edge",
            source.Id,
            target.Id,
            "skip",
            [new DiagramPoint(1, 1), new DiagramPoint(2, 1)],
            new VisioLineStyle("#64748B", 1.0));
        var prepared = Prepared(new VisioFigurePlan(11, 7, [source, target], [connector], []));

        VisioComEngine.DrawPreparedSelectedPageRegion(page, prepared, (_, _, _) => { });

        var edge = Assert.Single(page.Created, shape => shape.NameU == "synapse.edge.skip_edge");
        Assert.Equal("2", edge.Cells["LinePattern"].FormulaU);
        Assert.Equal("4", edge.Cells["EndArrow"].FormulaU);
    }

    [Fact]
    public void Publication_connectors_are_created_before_containers_so_data_flow_sits_behind_nodes()
    {
        var page = new PublicationDrawingPage();
        var source = Group("source", "pvp-module-frame", ["source"]);
        var target = Group("target", "pvp-operator-frame", ["target"]);
        var connector = new VisioConnector(
            "flow-edge",
            source.Id,
            target.Id,
            "flow",
            [new DiagramPoint(2, 1), new DiagramPoint(3, 1)]);
        var prepared = Prepared(new VisioFigurePlan(11, 7, [source, target], [connector], []));

        VisioComEngine.DrawPreparedSelectedPageRegion(page, prepared, (_, _, _) => { });

        var connectorIndex = page.Created.FindIndex(shape => shape.NameU == "synapse.edge.flow_edge");
        var firstContainerIndex = page.Created.FindIndex(shape => shape.NameU == "synapse.primitive.source");
        Assert.True(connectorIndex >= 0);
        Assert.True(firstContainerIndex >= 0);
        Assert.True(connectorIndex < firstContainerIndex, "connectors must be layered behind semantic containers");
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

    public sealed class ExistingRowRejectingShape
    {
        private readonly HashSet<string> _rows = new(StringComparer.Ordinal);

        public int AddNamedRowCalls { get; private set; }
        public Dictionary<string, FakeFormulaCell> Cells { get; } = new(StringComparer.Ordinal);

        public int CellExistsU(string name, int flags) => _rows.Contains(BaseCellName(name)) ? 1 : 0;

        public void AddNamedRow(int section, string rowName, int rowTag)
        {
            AddNamedRowCalls++;
            if (!_rows.Add($"Prop.{rowName}")) throw new InvalidOperationException("duplicate Shape Data row");
        }

        public FakeFormulaCell CellsU(string name)
        {
            if (!_rows.Contains(BaseCellName(name))) throw new InvalidOperationException("Shape Data row is absent");
            if (!Cells.TryGetValue(name, out var cell)) Cells[name] = cell = new FakeFormulaCell();
            return cell;
        }

        private static string BaseCellName(string name)
        {
            var labelSuffix = ".Label";
            return name.EndsWith(labelSuffix, StringComparison.Ordinal) ? name[..^labelSuffix.Length] : name;
        }
    }

    public sealed class PublicationDrawingPage
    {
        private int _nextShapeId = 400;

        public List<PublicationDrawingShape> Created { get; } = [];

        public PublicationDrawingShape DrawRectangle(double x1, double y1, double x2, double y2) => Create("rectangle");
        public PublicationDrawingShape DrawOval(double x1, double y1, double x2, double y2) => Create("oval");
        public PublicationDrawingShape DrawLine(double x1, double y1, double x2, double y2) => Create("line");
        public PublicationDrawingShape DrawPolyline(double[] points, int flags) => Create("polyline");

        private PublicationDrawingShape Create(string kind)
        {
            var shape = new PublicationDrawingShape(_nextShapeId++, kind);
            Created.Add(shape);
            return shape;
        }
    }

    public sealed class PublicationDrawingShape(int id, string kind)
    {
        private readonly Dictionary<string, FakeFormulaCell> _cells = new(StringComparer.Ordinal);
        private readonly HashSet<string> _rows = new(StringComparer.Ordinal);

        public int ID { get; } = id;
        public string Kind { get; } = kind;
        public string NameU { get; set; } = string.Empty;
        public string Text { get; set; } = string.Empty;
        public IReadOnlyDictionary<string, FakeFormulaCell> Cells => _cells;

        public FakeFormulaCell CellsU(string name)
        {
            if (!_cells.TryGetValue(name, out var cell)) _cells[name] = cell = new FakeFormulaCell();
            return cell;
        }

        public int CellExistsU(string name, int flags) => _rows.Contains(name) ? 1 : 0;

        public void AddNamedRow(int section, string rowName, int rowTag) => _rows.Add($"Prop.{rowName}");
    }

    private static VisioPrimitiveGroup Group(string id, string kind, IReadOnlyList<string> primitiveIds) =>
        new(
            id,
            kind,
            new VisioBounds(1, 1, 1, 0.7),
            0.08,
            0.05,
            0.04,
            primitiveIds,
            new Dictionary<string, string>
            {
                ["pvp.componentId"] = id,
                ["pvp.planId"] = "plan-1",
            },
            InlineLabel: id);

    private static PreparedSelectedPageRegion Prepared(VisioFigurePlan plan) =>
        new(
            new SelectedPageTarget("document-1", "page-1", new string('a', 64), new string('b', 64), 1),
            new DiagramDocument(string.Empty, [], [], [], plan));

    private static void AssertRecordedBeforeShapeWork(List<string> events, int shapeId)
    {
        var createdIndex = events.IndexOf($"created:{shapeId}");
        var reportedIndex = events.IndexOf($"reported:{shapeId}");
        var firstShapeWorkIndex = events.FindIndex(item => item.StartsWith($"shape-work:{shapeId}:", StringComparison.Ordinal));
        Assert.True(createdIndex >= 0 && reportedIndex == createdIndex + 1, $"Shape {shapeId} was not reported immediately after creation.");
        Assert.True(firstShapeWorkIndex < 0 || reportedIndex < firstShapeWorkIndex, $"Shape {shapeId} was styled before it was reported.");
    }

    public sealed class OvalDrawingPage
    {
        private int _nextShapeId = 200;

        public int DrawOvalCalls { get; private set; }
        public List<(int ShapeId, string Kind)> Created { get; } = [];
        public List<string> Events { get; } = [];

        public RecordingDrawingShape DrawRectangle(double x1, double y1, double x2, double y2) => Create("rectangle");
        public RecordingDrawingShape DrawOval(double x1, double y1, double x2, double y2)
        {
            DrawOvalCalls++;
            return Create("oval");
        }

        private RecordingDrawingShape Create(string kind)
        {
            var shapeId = _nextShapeId++;
            Created.Add((shapeId, kind));
            Events.Add($"created:{shapeId}");
            return new RecordingDrawingShape(shapeId, Events);
        }
    }

    public sealed class ConnectorFallbackDrawingPage
    {
        private int _nextShapeId = 300;

        public int DrawPolylineCalls { get; private set; }
        public int DrawLineCalls { get; private set; }
        public List<(int ShapeId, string Kind)> Created { get; } = [];
        public List<string> Events { get; } = [];

        public RecordingDrawingShape DrawRectangle(double x1, double y1, double x2, double y2) => Create("rectangle");

        public RecordingDrawingShape DrawPolyline(double[] points, int flags)
        {
            DrawPolylineCalls++;
            throw new InvalidOperationException("fake COM DrawPolyline failure");
        }

        public RecordingDrawingShape DrawLine(double x1, double y1, double x2, double y2)
        {
            DrawLineCalls++;
            return Create("line");
        }

        private RecordingDrawingShape Create(string kind)
        {
            var shapeId = _nextShapeId++;
            Created.Add((shapeId, kind));
            Events.Add($"created:{shapeId}");
            return new RecordingDrawingShape(shapeId, Events);
        }
    }

    public sealed class RecordingDrawingPage
    {
        private int _nextShapeId = 100;

        public List<int> CreatedShapeIds { get; } = [];
        public List<string> CreationKinds { get; } = [];
        public List<string> Events { get; } = [];

        public RecordingDrawingShape DrawRectangle(double x1, double y1, double x2, double y2) => Create("rectangle");
        public RecordingDrawingShape DrawOval(double x1, double y1, double x2, double y2) => Create("oval");
        public RecordingDrawingShape DrawLine(double x1, double y1, double x2, double y2) => Create("line");
        public RecordingDrawingShape DrawPolyline(double[] points, int flags) => Create("polyline");

        private RecordingDrawingShape Create(string kind)
        {
            var shapeId = _nextShapeId++;
            CreatedShapeIds.Add(shapeId);
            CreationKinds.Add(kind);
            Events.Add($"created:{shapeId}");
            return new RecordingDrawingShape(shapeId, Events);
        }
    }

    public sealed class RecordingDrawingShape(int id, List<string> events)
    {
        private string _name = string.Empty;
        private string _text = string.Empty;

        public int ID { get; } = id;

        public string NameU
        {
            get => _name;
            set
            {
                events.Add($"shape-work:{ID}:name");
                _name = value;
            }
        }

        public string Text
        {
            get => _text;
            set
            {
                events.Add($"shape-work:{ID}:text");
                _text = value;
            }
        }

        public FakeFormulaCell CellsU(string name)
        {
            events.Add($"shape-work:{ID}:cell:{name}");
            return new FakeFormulaCell();
        }
    }
}
