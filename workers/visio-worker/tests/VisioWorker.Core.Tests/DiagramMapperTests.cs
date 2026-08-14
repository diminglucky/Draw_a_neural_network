using VisioWorker.Core;

namespace VisioWorker.Core.Tests;

public sealed class DiagramMapperTests
{
    [Fact]
    public void Maps_canvas_nodes_to_stable_page_coordinates_and_shape_data()
    {
        var document = DiagramMapper.Map(Fixtures.CnnDiagram());

        var node = Assert.Single(document.Nodes, item => item.Id == "input");
        Assert.Equal("input", node.ShapeData["synapse.nodeId"]);
        Assert.Equal("tensor", node.ShapeData["synapse.kind"]);
        Assert.Equal(1.0, node.XInches);
        Assert.Equal(1.0, node.YInches);
    }

    [Fact]
    public void Preserves_skip_route_points_and_stage_labels()
    {
        var document = DiagramMapper.Map(Fixtures.CnnDiagram());

        Assert.Equal(new[] { "Input", "Output" }, document.StageLabels);
        var connector = Assert.Single(document.Connectors, item => item.Kind == "skip");
        Assert.Equal(4, connector.Points.Count);
    }

    [Fact]
    public void Maps_publication_visual_metadata_into_shape_data()
    {
        var diagram = new DiagramEnvelope
        {
            Nodes =
            [
                new DiagramNode
                {
                    Id = "block-1", Kind = "conv", Label = "Conv + ReLU", Stage = 0,
                    X = 100, Y = 100, Width = 180, Height = 120,
                    TensorShape = "224 x 224 x 64", VisualRole = "feature-map-stack",
                    LayerRole = "convolution-relu", RepeatCount = 2, Depth = 6,
                    Perspective = true, Color = "#4f86c6",
                },
            ],
        };

        var node = Assert.Single(DiagramMapper.Map(diagram).Nodes);
        Assert.Equal("feature-map-stack", node.ShapeData["synapse.visualRole"]);
        Assert.Equal("convolution-relu", node.ShapeData["synapse.layerRole"]);
        Assert.Equal("2", node.ShapeData["synapse.repeatCount"]);
        Assert.Equal("6", node.ShapeData["synapse.depth"]);
        Assert.Equal("true", node.ShapeData["synapse.perspective"]);
        Assert.Equal("224 x 224 x 64", node.ShapeData["synapse.tensorShape"]);
        Assert.Equal("#4f86c6", node.ShapeData["synapse.color"]);
    }

    [Fact]
    public void Maps_a_figure_plan_using_top_left_figure_units()
    {
        var figurePlanProperty = typeof(DiagramEnvelope).GetProperty("FigurePlan");
        Assert.NotNull(figurePlanProperty);

        var mappedPlanProperty = typeof(DiagramDocument).GetProperty("FigurePlan");
        Assert.NotNull(mappedPlanProperty);
    }

    [Fact]
    public async Task Mock_readback_counts_native_prism_faces_from_a_figure_plan()
    {
        var directory = Path.Combine(Path.GetTempPath(), "synapse-figure-plan-test-" + Guid.NewGuid().ToString("N"));
        var outputPath = Path.Combine(directory, "figure.vsdx");
        try
        {
            var document = new DiagramDocument(
                "VGG16",
                [],
                [],
                [],
                new VisioFigurePlan(
                    12,
                    8,
                    [
                        new VisioPrimitiveGroup(
                            "block-1",
                            "feature-map-prism",
                            new VisioBounds(0.35, 2.5, 0.7, 3),
                            0.24,
                            0.18,
                            -0.14,
                            ["block-1.front", "block-1.top", "block-1.side"],
                            new Dictionary<string, string>()),
                    ],
                    []));

            var result = await new MockVisioEngine().RenderAsync(document, outputPath);

            Assert.True(result.Valid);
            Assert.Equal(3, result.ShapeCount);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public void Readback_requires_all_prism_faces_and_their_shape_data()
    {
        var plan = new VisioFigurePlan(
            12,
            8,
            [
                new VisioPrimitiveGroup(
                    "block-1",
                    "feature-map-prism",
                    new VisioBounds(0.35, 2.5, 0.7, 3),
                    0.24,
                    0.18,
                    -0.14,
                    ["block-1.front", "block-1.top", "block-1.side"],
                    new Dictionary<string, string>
                    {
                        ["synapse.planId"] = "block-1",
                        ["synapse.sourceNodeId"] = "block-1",
                        ["synapse.visualRole"] = "feature-map-stack",
                    }),
            ],
            [new VisioConnector("edge-block-1-pool-1", "block-1", "pool-1", "forward", [])]);

        var result = ReadbackValidator.Validate(
            plan,
            [
                new ReadbackPrimitive("block-1.front", new Dictionary<string, string>
                {
                    ["synapse.planId"] = "block-1",
                    ["synapse.sourceNodeId"] = "block-1",
                    ["synapse.visualRole"] = "feature-map-stack",
                    ["synapse.primitiveId"] = "block-1.front",
                }),
                new ReadbackPrimitive("block-1.top", new Dictionary<string, string>
                {
                    ["synapse.planId"] = "block-1",
                    ["synapse.sourceNodeId"] = "block-1",
                    ["synapse.visualRole"] = "feature-map-stack",
                    ["synapse.primitiveId"] = "block-1.top",
                }),
            ],
            ["edge-block-1-pool-1"]);

        Assert.False(result.Valid);
        Assert.Contains("block-1.side", result.MissingPrimitiveIds);
        Assert.Empty(result.MissingConnectorIds);
        Assert.Empty(result.ShapeDataFailures);
    }

    [Fact]
    public void Maps_figure_plan_labels_as_independent_readable_shapes()
    {
        var diagram = new DiagramEnvelope
        {
            FigurePlan = new DiagramFigurePlan
            {
                CoordinateSpace = new DiagramCoordinateSpace
                {
                    Unit = "figure-unit", FigureUnitInches = 0.01, Origin = "top-left", Width = 1200, Height = 800,
                },
                PrimitiveGroups =
                [
                    new DiagramPrimitiveGroup
                    {
                        Id = "pool-1", Kind = "pooling-prism", PrimitiveIds = ["pool-1.front", "pool-1.top", "pool-1.side"],
                        Bounds = new DiagramBounds { X = 220, Y = 350, Width = 36, Height = 135 },
                        Semantic = new DiagramPrimitiveSemantic { SourceNodeId = "pool-1", VisualRole = "pooling-block", LayerRole = "max-pooling" },
                    },
                ],
                Labels =
                [
                    new DiagramFigureLabel { Id = "pool-1.label", GroupId = "pool-1", Text = "MaxPool 2×2\n112×112×64", X = 193, Y = 576, Width = 90, Height = 42, FontSizePt = 8 },
                ],
            },
        };

        var label = Assert.Single(DiagramMapper.Map(diagram).FigurePlan!.Labels!);

        Assert.Equal("MaxPool 2×2\n112×112×64", label.Text);
        Assert.Equal(0.9, label.WidthInches, 2);
        Assert.Equal(8, label.FontSizePt);
    }

    [Fact]
    public void Visible_live_render_keeps_the_reopened_final_document_open()
    {
        Assert.False(VisioWorker.Live.VisioDocumentLifecycle.ShouldCloseDocumentAfterReadback(visible: true));
        Assert.True(VisioWorker.Live.VisioDocumentLifecycle.ShouldCloseDocumentAfterReadback(visible: false));
    }

    [Fact]
    public void Visible_live_render_requests_page_fit_without_changing_hidden_worker_lifecycle()
    {
        Assert.True(VisioWorker.Live.VisioDocumentLifecycle.ShouldFitVisibleDocument(visible: true));
        Assert.False(VisioWorker.Live.VisioDocumentLifecycle.ShouldFitVisibleDocument(visible: false));
    }

    [Fact]
    public void Maps_multi_plane_feature_stack_without_requiring_legacy_root_faces()
    {
        var diagram = new DiagramEnvelope
        {
            FigurePlan = new DiagramFigurePlan
            {
                CoordinateSpace = new DiagramCoordinateSpace
                {
                    Unit = "figure-unit", FigureUnitInches = 0.01, Origin = "top-left", Width = 1600, Height = 900,
                },
                PrimitiveGroups =
                [
                    new DiagramPrimitiveGroup
                    {
                        Id = "block-1", Kind = "feature-map-stack",
                        PrimitiveIds =
                        [
                            "block-1.plane-1.front", "block-1.plane-1.top", "block-1.plane-1.side",
                            "block-1.plane-2.front", "block-1.plane-2.top", "block-1.plane-2.side",
                            "block-1.plane-3.front", "block-1.plane-3.top", "block-1.plane-3.side",
                        ],
                        Bounds = new DiagramBounds { X = 200, Y = 200, Width = 145, Height = 310 },
                        Semantic = new DiagramPrimitiveSemantic { SourceNodeId = "block-1", VisualRole = "feature-map-stack", LayerRole = "convolution-relu", RepeatCount = 2, ChannelCount = 64 },
                    },
                ],
            },
        };

        var block = Assert.Single(DiagramMapper.Map(diagram).FigurePlan!.PrimitiveGroups);

        Assert.Equal(9, block.PrimitiveIds.Count);
        Assert.Contains("block-1.plane-3.side", block.PrimitiveIds);
    }

    [Fact]
    public void Keeps_the_front_feature_map_plane_at_the_base_publication_color()
    {
        var fill = VisioWorker.Live.PublicationRenderPalette.FeatureMapPlaneFill((72, 137, 196), backOffset: 0);

        Assert.Equal((72, 137, 196), fill);
    }

    [Fact]
    public void Maps_downsample_metadata_and_uses_a_print_safe_feature_map_front_fill()
    {
        var diagram = new DiagramEnvelope
        {
            FigurePlan = new DiagramFigurePlan
            {
                CoordinateSpace = new DiagramCoordinateSpace
                {
                    Unit = "figure-unit", FigureUnitInches = 0.01, Origin = "top-left", Width = 1600, Height = 640,
                },
                PrimitiveGroups =
                [
                    new DiagramPrimitiveGroup
                    {
                        Id = "pool-1", Kind = "downsample-transition", PrimitiveIds = ["pool-1.front", "pool-1.top", "pool-1.side"],
                        Bounds = new DiagramBounds { X = 400, Y = 180, Width = 62, Height = 260 },
                        Semantic = new DiagramPrimitiveSemantic
                        {
                            SourceNodeId = "pool-1", VisualRole = "pooling-block", LayerRole = "max-pooling",
                            InputSpatialSize = 224, OutputSpatialSize = 112,
                        },
                    },
                ],
            },
        };

        var pool = Assert.Single(DiagramMapper.Map(diagram).FigurePlan!.PrimitiveGroups);

        Assert.Equal("224", pool.ShapeData["synapse.inputSpatialSize"]);
        Assert.Equal("112", pool.ShapeData["synapse.outputSpatialSize"]);
        Assert.Equal((247, 251, 255), VisioWorker.Live.PublicationRenderPalette.FeatureMapFrontFill);
    }

    [Fact]
    public void Uses_thin_tensor_face_depths_so_stack_planes_do_not_read_as_generic_box_columns()
    {
        Assert.InRange(VisioWorker.Live.PublicationTensorGeometry.FeatureMapFaceDepthInches(0.42), 0.04, 0.07);
        Assert.InRange(VisioWorker.Live.PublicationTensorGeometry.StackPlaneOffsetInches(0.42), 0.11, 0.17);
        Assert.InRange(VisioWorker.Live.PublicationTensorGeometry.TransitionFaceDepthInches, 0.03, 0.06);
    }

    [Fact]
    public void Keeps_downsample_transitions_visually_subordinate_to_feature_map_stacks()
    {
        var fill = VisioWorker.Live.PublicationRenderPalette.TransitionFill;

        Assert.True(fill.R >= 245 && fill.G >= 245 && fill.B >= 245);
    }
}

internal static class Fixtures
{
    public static DiagramEnvelope CnnDiagram() => new()
    {
        Figure = new DiagramFigure { Title = "CNN", StageLabels = ["Input", "Output"] },
        Nodes =
        [
            new DiagramNode { Id = "input", Kind = "tensor", Label = "Input", Stage = 0, X = 100, Y = 100, Width = 100, Height = 100 },
            new DiagramNode { Id = "conv", Kind = "conv", Label = "Conv", Stage = 0, X = 100, Y = 300, Width = 100, Height = 100 },
            new DiagramNode { Id = "output", Kind = "output", Label = "Output", Stage = 1, X = 700, Y = 200, Width = 100, Height = 100 },
        ],
        Edges =
        [
            new DiagramEdge { Id = "edge-signal", Source = "conv", Target = "output", Kind = "signal", Points = [new DiagramPoint(200, 350), new DiagramPoint(700, 250)] },
            new DiagramEdge { Id = "edge-skip", Source = "input", Target = "output", Kind = "skip", Points = [new DiagramPoint(200, 150), new DiagramPoint(300, 50), new DiagramPoint(600, 50), new DiagramPoint(700, 250)] },
        ],
    };
}
