using System.Text.Json;
using System.Text.Json.Serialization;
using VisioWorker.Live;

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
        => await RunAsync(input, output, options, WaitOneMinuteAsync, cancellationToken).ConfigureAwait(false);

    internal static async Task<int> RunAsync(
        TextReader input,
        TextWriter output,
        WorkerHostLineProcessorOptions options,
        Func<CancellationToken, Task> waitForCheckpointTickAsync,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(output);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(waitForCheckpointTickAsync);

        await using var processor = new WorkerHostLineProcessor(options);
        using var lifecycleCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var scheduler = RunCheckpointSchedulerAsync(processor, waitForCheckpointTickAsync, lifecycleCancellation.Token);
        var sawNonBlankRequest = false;
        var sawFailedV1Response = false;

        try
        {
            while (true)
            {
                var nextLine = input.ReadLineAsync(lifecycleCancellation.Token).AsTask();
                if (await Task.WhenAny(nextLine, scheduler).ConfigureAwait(false) == scheduler)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    await scheduler.ConfigureAwait(false);
                    throw new WorkerProtocolException("Worker checkpoint scheduler stopped unexpectedly.");
                }

                var line = await nextLine.ConfigureAwait(false);
                if (line is null) break;
                if (string.IsNullOrWhiteSpace(line)) continue;

                sawNonBlankRequest = true;
                var result = await processor.ProcessLineWithMetadataAsync(line.TrimStart('\uFEFF'), lifecycleCancellation.Token).ConfigureAwait(false);
                if (result.Protocol == WorkerHostProtocol.V1 && result.Response is WorkerResponse { Status: "failed" }) sawFailedV1Response = true;

                await output.WriteLineAsync(JsonSerializer.Serialize(result.Response, JsonOptions)).ConfigureAwait(false);
                await output.FlushAsync(lifecycleCancellation.Token).ConfigureAwait(false);
            }

            if (!sawNonBlankRequest) return 2;
            return sawFailedV1Response ? 1 : 0;
        }
        finally
        {
            lifecycleCancellation.Cancel();
            await scheduler.ConfigureAwait(false);
        }
    }

    private static Task WaitOneMinuteAsync(CancellationToken cancellationToken) => Task.Delay(TimeSpan.FromMinutes(1), cancellationToken);

    private static async Task RunCheckpointSchedulerAsync(
        WorkerHostLineProcessor processor,
        Func<CancellationToken, Task> waitForCheckpointTickAsync,
        CancellationToken cancellationToken)
    {
        try
        {
            while (true)
            {
                await waitForCheckpointTickAsync(cancellationToken).ConfigureAwait(false);
                await processor.CheckpointIdleSessionsAsync(cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
    }
}
