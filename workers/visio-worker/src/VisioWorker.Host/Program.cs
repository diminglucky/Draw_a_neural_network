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

        await using var processor = new WorkerHostLineProcessor(new WorkerHostLineProcessorOptions
        {
            OutputRoot = outputRoot,
            Mode = mode,
            Visible = HasFlag(args, "--visible"),
            AttachToRunning = HasFlag(args, "--attach-to-running"),
        });
        while (await Console.In.ReadLineAsync().ConfigureAwait(false) is { } line)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var response = await processor.ProcessLineAsync(line.TrimStart('\uFEFF')).ConfigureAwait(false);
            await Console.Out.WriteLineAsync(JsonSerializer.Serialize(response, JsonOptions)).ConfigureAwait(false);
            await Console.Out.FlushAsync().ConfigureAwait(false);
        }
        return 0;
    }

    private static bool HasFlag(string[] args, string name) => args.Any(argument => string.Equals(argument, name, StringComparison.OrdinalIgnoreCase));

    private static string? ReadOption(string[] args, string name)
    {
        for (var index = 0; index < args.Length - 1; index++)
            if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase)) return args[index + 1];
        return null;
    }
}
