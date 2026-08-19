using System.Text.Json;
using System.Text.Json.Serialization;

namespace VisioWorker.Host;

internal static class WorkerHostLoop
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    // v1 is a one-shot CLI contract: no request is a usage failure and a v1 failure is a host failure.
    // v2 is persistent: its failures are reported per line and do not force a nonzero host exit code.
    internal static async Task<int> RunAsync(
        TextReader input,
        TextWriter output,
        WorkerHostLineProcessorOptions options,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(output);
        ArgumentNullException.ThrowIfNull(options);

        await using var processor = new WorkerHostLineProcessor(options);
        var sawNonBlankRequest = false;
        var sawFailedV1Response = false;

        while (await input.ReadLineAsync(cancellationToken).ConfigureAwait(false) is { } line)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;

            sawNonBlankRequest = true;
            var response = await processor.ProcessLineAsync(line.TrimStart('\uFEFF'), cancellationToken).ConfigureAwait(false);
            if (response is WorkerResponse { Status: "failed" }) sawFailedV1Response = true;

            await output.WriteLineAsync(JsonSerializer.Serialize(response, JsonOptions)).ConfigureAwait(false);
            await output.FlushAsync(cancellationToken).ConfigureAwait(false);
        }

        if (!sawNonBlankRequest) return 2;
        return sawFailedV1Response ? 1 : 0;
    }
}
