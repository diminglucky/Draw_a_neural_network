using System.Text.Json;
using System.Text.Json.Serialization;

namespace VisioWorker.Host;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static async Task<int> Main(string[] args)
    {
        var mode = ReadOption(args, "--mode") ?? "mock";
        var outputRoot = ReadOption(args, "--output-root");
        if (string.IsNullOrWhiteSpace(outputRoot))
        {
            await Console.Error.WriteLineAsync("--output-root is required");
            return 2;
        }

        var line = await Console.In.ReadLineAsync().ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(line))
        {
            await Console.Error.WriteLineAsync("one JSON request line is required");
            return 2;
        }
        line = line.TrimStart('\uFEFF');

        WorkerResponse response;
        try
        {
            var request = JsonSerializer.Deserialize<WorkerRequest>(line, JsonOptions)
                ?? throw new InvalidOperationException("request JSON was empty");
            if (!request.Mode.Equals(mode, StringComparison.OrdinalIgnoreCase))
            {
                request = new WorkerRequest
                {
                    ProtocolVersion = request.ProtocolVersion,
                    RequestId = request.RequestId,
                    JobId = request.JobId,
                    Mode = mode,
                    OutputPath = request.OutputPath,
                    Diagram = request.Diagram,
                };
            }
            response = await new WorkerRequestProcessor(
                outputRoot,
                visible: HasFlag(args, "--visible"),
                attachToRunning: HasFlag(args, "--attach-to-running")
            ).ProcessAsync(request).ConfigureAwait(false);
        }
        catch (Exception error)
        {
            response = new WorkerResponse { Error = new WorkerError { Code = "VISIO_WORKER_PROTOCOL_ERROR", Message = error.Message } };
        }

        await Console.Out.WriteLineAsync(JsonSerializer.Serialize(response, JsonOptions)).ConfigureAwait(false);
        await Console.Out.FlushAsync().ConfigureAwait(false);
        return response.Status == "succeeded" ? 0 : 1;
    }

    private static bool HasFlag(string[] args, string name) => args.Any(argument => string.Equals(argument, name, StringComparison.OrdinalIgnoreCase));

    private static string? ReadOption(string[] args, string name)
    {
        for (var index = 0; index < args.Length - 1; index++)
            if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase)) return args[index + 1];
        return null;
    }
}
