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
