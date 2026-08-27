using System.Text.Json;
using System.Text.Json.Nodes;
using VisioWorker.Core;
using VisioWorker.Host;
using VisioWorker.Live;

namespace VisioWorker.Core.Tests;

public sealed class SelectedPageNativeIntentMapperTests
{
    [Fact]
    public void Maps_an_allowlisted_native_intent_to_a_bounded_diagram_document()
    {
        using var json = JsonDocument.Parse("""{"protocolVersion":"pvp-native-intent-1","planId":"plan-1","planHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","updateIdentity":{"ownerId":"user-1","deviceId":"device-1","workflowId":"workflow-1","documentId":"document-1","pageId":"page-1","expectedRevision":7},"coordinateSpace":{"id":"pvp-du-1","unit":"du","duPerInch":1000,"page":{"x":0,"y":0,"width":1000,"height":600}},"primitives":[{"primitiveId":"input-1","componentId":"input-1","nativeKind":"terminal","label":"Input","bounds":{"x":10,"y":20,"width":100,"height":80},"styleTokenIds":[],"shapeData":{"pvp.planId":"plan-1","pvp.planHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","pvp.primitiveId":"input-1","pvp.componentId":"input-1","pvp.ownership":"agent"}},{"primitiveId":"module-1","componentId":"module-1","nativeKind":"module","label":"Conv","bounds":{"x":240,"y":20,"width":100,"height":80},"styleTokenIds":[],"shapeData":{"pvp.planId":"plan-1","pvp.planHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","pvp.primitiveId":"module-1","pvp.componentId":"module-1","pvp.ownership":"agent"}}],"connectors":[{"connectorId":"flow-1","nativeKind":"flow","sourcePrimitiveId":"input-1","sourcePortId":"input-1.out","targetPrimitiveId":"module-1","targetPortId":"module-1.in","route":[{"x":110,"y":60},{"x":240,"y":60}],"styleTokenIds":[],"shapeData":{"pvp.planId":"plan-1","pvp.planHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","pvp.connectorId":"flow-1","pvp.ownership":"agent"}}]}""");

        var document = SelectedPageNativeIntentMapper.Map(json.RootElement);

        Assert.Equal(2, document.Nodes.Count);
        Assert.Single(document.Connectors);
        Assert.Equal("input-1", document.Nodes[0].Id);
        Assert.Equal("flow-1", document.Connectors[0].Id);
        var plan = Assert.IsType<VisioFigurePlan>(document.FigurePlan);
        Assert.Empty(plan.Labels!);
        Assert.Equal("Input", Assert.Single(plan.PrimitiveGroups, group => group.Id == "input-1").InlineLabel);
        Assert.Equal("Conv", Assert.Single(plan.PrimitiveGroups, group => group.Id == "module-1").InlineLabel);
    }

    [Fact]
    public void Preserves_page_visual_kind_style_labels_and_routes_in_a_rich_figure_plan()
    {
        var value = Fixture();
        var primitive = value["primitives"]![1]!.AsObject();
        primitive["visualKind"] = "TensorVolume";
        primitive["zIndex"] = 3;
        primitive["style"] = JsonNode.Parse("""{"fill":"#7dd3fc","stroke":"#1e293b","strokeWidthPt":2}""");
        primitive["visual"] = JsonNode.Parse("""{"regionRole":"scale_transition","nativeSupport":"supported","geometry":{"kind":"tensor_volume","frontFace":[{"x":240,"y":40},{"x":320,"y":40},{"x":320,"y":100},{"x":240,"y":100}],"depthFace":[{"x":320,"y":40},{"x":340,"y":20},{"x":340,"y":80},{"x":320,"y":100}]}}""");
        var connector = value["connectors"]![0]!.AsObject();
        connector["zIndex"] = 0;
        connector["style"] = JsonNode.Parse("""{"stroke":"#475569","strokeWidthPt":2}""");

        var document = Map(value);

        var plan = Assert.IsType<VisioFigurePlan>(document.FigurePlan);
        Assert.Equal(1, plan.PageWidthInches, 3);
        Assert.Equal(0.6, plan.PageHeightInches, 3);
        var volume = Assert.Single(plan.PrimitiveGroups, group => group.Id == "module-1");
        Assert.Equal("pvp-tensor-volume", volume.Kind);
        Assert.Equal(["module-1.front", "module-1.top", "module-1.side"], volume.PrimitiveIds);
        Assert.Equal("#7dd3fc", volume.Style!.FillColor);
        Assert.Equal("#1e293b", volume.Style.StrokeColor);
        Assert.Equal(2, volume.Style.StrokeWidthPoints);
        Assert.Contains(plan.Labels!, label => label.GroupId == "module-1" && label.Text == "tensor");
        Assert.Equal("#475569", Assert.Single(plan.Connectors).Style!.StrokeColor);
        Assert.DoesNotContain("Convolution + ReLU", plan.Labels!.Select(label => label.Text));
    }

    [Fact]
    public void Uses_symbol_only_merge_markers_and_an_inline_repeat_badge_label()
    {
        var value = Fixture();
        var marker = value["primitives"]![0]!.AsObject();
        marker["nativeKind"] = "merge-add";
        marker["visualKind"] = "AddMarker";
        marker["zIndex"] = 2;
        marker["label"] = "Residual merge";
        marker["style"] = JsonNode.Parse("""{"fill":"#fee2e2","stroke":"#1e293b","strokeWidthPt":1.4}""");
        marker["visual"] = JsonNode.Parse("""{"regionRole":"merge_add","nativeSupport":"supported","geometry":{"kind":"none"}}""");
        var repeat = value["primitives"]![1]!.AsObject();
        repeat["nativeKind"] = "repeat-badge";
        repeat["visualKind"] = "RepeatBadge";
        repeat["zIndex"] = 3;
        repeat["label"] = "shared × N";
        repeat["style"] = JsonNode.Parse("""{"fill":"#fef3c7","stroke":"#1e293b","strokeWidthPt":1.2}""");
        repeat["visual"] = JsonNode.Parse("""{"regionRole":"repeat_group","nativeSupport":"supported","geometry":{"kind":"none"}}""");

        var plan = Assert.IsType<VisioFigurePlan>(Map(value).FigurePlan);

        Assert.Null(Assert.Single(plan.PrimitiveGroups, group => group.Id == "input-1").InlineLabel);
        Assert.Equal("shared × N", Assert.Single(plan.PrimitiveGroups, group => group.Id == "module-1").InlineLabel);
        Assert.DoesNotContain(plan.Labels!, label => label.GroupId is "input-1" or "module-1");
    }

    [Fact]
    public void Uses_compact_labels_for_semantic_attachment_visuals()
    {
        var stageValue = Fixture();
        stageValue["primitives"]![1]! ["visualKind"] = "TensorStage";
        stageValue["primitives"]![1]! ["label"] = "Spatial scale transition";
        stageValue["primitives"]![1]! ["visual"] = JsonNode.Parse("""{"regionRole":"scale_transition","nativeSupport":"supported","geometry":{"kind":"none"}}""");

        var stagePlan = Assert.IsType<VisioFigurePlan>(Map(stageValue).FigurePlan);
        Assert.Equal("scale", Assert.Single(stagePlan.PrimitiveGroups, group => group.Id == "module-1").InlineLabel);
        Assert.Empty(stagePlan.Labels!);

        var volumeValue = Fixture();
        volumeValue["primitives"]![1]! ["visualKind"] = "TensorVolume";
        volumeValue["primitives"]![1]! ["label"] = "Spatial scale transition";
        volumeValue["primitives"]![1]! ["visual"] = JsonNode.Parse("""{"regionRole":"scale_transition","nativeSupport":"supported","geometry":{"kind":"tensor_volume","frontFace":[{"x":240,"y":40},{"x":320,"y":40},{"x":320,"y":100},{"x":240,"y":100}],"depthFace":[{"x":320,"y":40},{"x":340,"y":20},{"x":340,"y":80},{"x":320,"y":100}]}}""");

        var volumePlan = Assert.IsType<VisioFigurePlan>(Map(volumeValue).FigurePlan);
        Assert.Equal("tensor", Assert.Single(volumePlan.Labels!).Text);
    }

    [Fact]
    public void Rejects_unknown_or_inconsistent_native_shape_fields()
    {
        var unknown = Fixture();
        unknown["outputPath"] = "C:\\forbidden.vsdx";
        Assert.Throws<WorkerProtocolException>(() => Map(unknown));

        var inconsistentShapeData = Fixture();
        inconsistentShapeData["primitives"]![0]! ["shapeData"]!["pvp.planHash"] = new string('b', 64);
        Assert.Throws<WorkerProtocolException>(() => Map(inconsistentShapeData));
    }

    [Fact]
    public void Rejects_native_geometry_outside_the_declared_page()
    {
        var outsidePrimitive = Fixture();
        outsidePrimitive["primitives"]![0]! ["bounds"]!["x"] = 950;
        Assert.Throws<WorkerProtocolException>(() => Map(outsidePrimitive));

        var outsideRoute = Fixture();
        outsideRoute["connectors"]![0]! ["route"]![1]! ["x"] = 1001;
        Assert.Throws<WorkerProtocolException>(() => Map(outsideRoute));
    }

    [Fact]
    public void Rejects_duplicate_connector_identifiers()
    {
        var duplicate = Fixture();
        var connectors = duplicate["connectors"]!.AsArray();
        connectors.Add(connectors[0]!.DeepClone());
        Assert.Throws<WorkerProtocolException>(() => Map(duplicate));
    }

    [Fact]
    public void Rejects_a_native_intent_that_does_not_match_the_sealed_selected_page_binding()
    {
        var value = Fixture();
        using var document = JsonDocument.Parse(value.ToJsonString());
        using var sealedIntent = JsonDocument.Parse("""{"planId":"other-plan","planHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}""");
        var request = new SelectedPageWorkerRequest(
            "request-apply",
            SelectedPageWorkerCommand.ApplyOwnedRegion,
            new SelectedPageWorkerBinding("job-1", "tenant-1", "other-user", "device-1", "workflow-1", "document-1", "page-1", new string('a', 64), new string('b', 64), 7, "agent-region-1"),
            "agent-region-1",
            sealedIntent.RootElement.Clone());

        Assert.Throws<WorkerProtocolException>(() => SelectedPageNativeIntentMapper.Map(document.RootElement, request));
    }

    private static DiagramDocument Map(JsonObject value)
    {
        using var document = JsonDocument.Parse(value.ToJsonString());
        return SelectedPageNativeIntentMapper.Map(document.RootElement);
    }

    private static JsonObject Fixture() => JsonNode.Parse("""{"protocolVersion":"pvp-native-intent-1","planId":"plan-1","planHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","updateIdentity":{"ownerId":"user-1","deviceId":"device-1","workflowId":"workflow-1","documentId":"document-1","pageId":"page-1","expectedRevision":7},"coordinateSpace":{"id":"pvp-du-1","unit":"du","duPerInch":1000,"page":{"x":0,"y":0,"width":1000,"height":600}},"primitives":[{"primitiveId":"input-1","componentId":"input-1","nativeKind":"terminal","label":"Input","bounds":{"x":10,"y":20,"width":100,"height":80},"styleTokenIds":[],"shapeData":{"pvp.planId":"plan-1","pvp.planHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","pvp.primitiveId":"input-1","pvp.componentId":"input-1","pvp.ownership":"agent"}},{"primitiveId":"module-1","componentId":"module-1","nativeKind":"module","label":"Conv","bounds":{"x":240,"y":20,"width":100,"height":80},"styleTokenIds":[],"shapeData":{"pvp.planId":"plan-1","pvp.planHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","pvp.primitiveId":"module-1","pvp.componentId":"module-1","pvp.ownership":"agent"}}],"connectors":[{"connectorId":"flow-1","nativeKind":"flow","sourcePrimitiveId":"input-1","sourcePortId":"input-1.out","targetPrimitiveId":"module-1","targetPortId":"module-1.in","route":[{"x":110,"y":60},{"x":240,"y":60}],"styleTokenIds":[],"shapeData":{"pvp.planId":"plan-1","pvp.planHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","pvp.connectorId":"flow-1","pvp.ownership":"agent"}}]}""")!.AsObject();
}
