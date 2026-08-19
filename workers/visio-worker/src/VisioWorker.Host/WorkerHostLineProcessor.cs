using System.Text.Json;
using System.Text.Json.Serialization;
using VisioWorker.Core;
using VisioWorker.Live;

namespace VisioWorker.Host;

public sealed class WorkerHostLineProcessorOptions
{
    public required string OutputRoot { get; init; }
    public string Mode { get; init; } = "mock";
    public bool Visible { get; init; }
    public bool AttachToRunning { get; init; }
    public IVisioSessionBackend? SessionBackend { get; init; }
    public ISessionRecoveryManifestStore? ManifestStore { get; init; }
    public IWorkerClock? Clock { get; init; }
    public TimeSpan CheckpointInterval { get; init; } = TimeSpan.FromMinutes(15);
    public int Capacity { get; init; } = 4;
    internal Func<VisioComEngineOptions, (IVisioSessionBackend Backend, IAsyncDisposable Engine)>? OwnedEngineFactory { get; init; }
}

internal enum WorkerHostProtocol
{
    V1,
    V2,
}

internal sealed record WorkerHostLineResult(WorkerHostProtocol Protocol, object Response);

public sealed class WorkerHostLineProcessor : IAsyncDisposable
{
    private const int MaximumLineLength = 8 * 1024 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly WorkerHostLineProcessorOptions _options;
    private readonly WorkerRequestProcessor _v1Processor;
    private LongLivedWorkerRuntime? _v2Runtime;
    private IAsyncDisposable? _ownedEngine;
    private bool _disposed;

    public WorkerHostLineProcessor(WorkerHostLineProcessorOptions options)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
        if (string.IsNullOrWhiteSpace(options.OutputRoot)) throw new ArgumentException("output root is required", nameof(options));
        if (options.CheckpointInterval <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(options));
        if (options.Capacity <= 0) throw new ArgumentOutOfRangeException(nameof(options));

        _v1Processor = new WorkerRequestProcessor(options.OutputRoot, options.Visible, options.AttachToRunning);
    }

    public async Task<object> ProcessLineAsync(string line, CancellationToken cancellationToken = default) =>
        (await ProcessLineWithMetadataAsync(line, cancellationToken).ConfigureAwait(false)).Response;

    internal async Task<WorkerHostLineResult> ProcessLineWithMetadataAsync(string line, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (string.IsNullOrWhiteSpace(line)) return FailedV1Result();

        ProtocolClassification classification;
        try
        {
            classification = ReadProtocolVersion(line);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            return FailedV1Result();
        }

        if (classification.IsDuplicateV1Discriminator) return FailedV1Result();

        return classification.Protocol switch
        {
            WorkerHostProtocol.V1 => new WorkerHostLineResult(WorkerHostProtocol.V1, await ProcessV1Async(line, cancellationToken).ConfigureAwait(false)),
            WorkerHostProtocol.V2 => new WorkerHostLineResult(WorkerHostProtocol.V2, await ProcessV2Async(line, cancellationToken).ConfigureAwait(false)),
            _ => FailedV1Result(),
        };
    }

    internal Task CheckpointIdleSessionsAsync(CancellationToken cancellationToken = default) =>
        _v2Runtime?.CheckpointIdleSessionsAsync(cancellationToken) ?? Task.CompletedTask;

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;

        Exception? runtimeFailure = null;
        try
        {
            if (_v2Runtime is not null) await _v2Runtime.DisposeAsync().ConfigureAwait(false);
        }
        catch (Exception error)
        {
            runtimeFailure = error;
        }

        try
        {
            if (_ownedEngine is not null) await _ownedEngine.DisposeAsync().ConfigureAwait(false);
        }
        catch (Exception engineFailure) when (runtimeFailure is not null)
        {
            throw new AggregateException(runtimeFailure, engineFailure);
        }

        if (runtimeFailure is not null) throw runtimeFailure;
    }

    private async Task<WorkerResponse> ProcessV1Async(string line, CancellationToken cancellationToken)
    {
        try
        {
            var request = JsonSerializer.Deserialize<WorkerRequest>(line, JsonOptions)
                ?? throw new WorkerProtocolException("request JSON was empty");
            if (!request.Mode.Equals(_options.Mode, StringComparison.OrdinalIgnoreCase)) request = request.WithMode(_options.Mode);
            return await _v1Processor.ProcessAsync(request, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            return FailedV1();
        }
    }

    private async Task<WorkerV2Response> ProcessV2Async(string line, CancellationToken cancellationToken)
    {
        WorkerV2Request? request = null;
        try
        {
            request = WorkerV2RequestParser.Parse(line, _options.OutputRoot);
            return await (await GetOrCreateV2RuntimeAsync().ConfigureAwait(false)).ProcessAsync(request, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            return new WorkerV2Response(request?.RequestId ?? "unknown", "failed", Error: "Invalid or failed Worker v2 request.");
        }
    }

    private async Task<LongLivedWorkerRuntime> GetOrCreateV2RuntimeAsync()
    {
        if (_v2Runtime is not null) return _v2Runtime;

        var backend = _options.SessionBackend;
        if (backend is not null)
        {
            var injectedRuntime = new LongLivedWorkerRuntime(
                backend,
                _options.ManifestStore ?? new SessionRecoveryManifestStore(_options.OutputRoot),
                _options.Clock ?? new SystemWorkerClock(),
                _options.CheckpointInterval,
                _options.Capacity);
            _v2Runtime = injectedRuntime;
            return injectedRuntime;
        }

        if (!_options.Mode.Equals("live", StringComparison.OrdinalIgnoreCase))
            throw new WorkerProtocolException("Protocol v2 requires live mode or an injected session backend.");

        IAsyncDisposable? createdEngine = null;
        try
        {
            var engineOptions = new VisioComEngineOptions(
                AttachToRunning: _options.AttachToRunning,
                Visible: _options.Visible,
                OutputRoot: _options.OutputRoot);
            var owned = _options.OwnedEngineFactory?.Invoke(engineOptions) ?? await CreateOwnedEngineAsync(engineOptions).ConfigureAwait(false);
            createdEngine = owned.Engine;
            var runtime = new LongLivedWorkerRuntime(
                owned.Backend,
                _options.ManifestStore ?? new SessionRecoveryManifestStore(_options.OutputRoot),
                _options.Clock ?? new SystemWorkerClock(),
                _options.CheckpointInterval,
                _options.Capacity);

            _ownedEngine = createdEngine;
            _v2Runtime = runtime;
            return runtime;
        }
        catch (Exception initializationFailure)
        {
            if (createdEngine is null) throw;
            try
            {
                await createdEngine.DisposeAsync().ConfigureAwait(false);
            }
            catch (Exception cleanupFailure)
            {
                throw new AggregateException(initializationFailure, cleanupFailure);
            }

            throw;
        }
    }

    private static async Task<(IVisioSessionBackend Backend, IAsyncDisposable Engine)> CreateOwnedEngineAsync(VisioComEngineOptions options)
    {
        var engine = new VisioComEngine(options);
        try
        {
            return (engine.CreateSessionBackend(), engine);
        }
        catch (Exception initializationFailure)
        {
            try
            {
                await engine.DisposeAsync().ConfigureAwait(false);
            }
            catch (Exception cleanupFailure)
            {
                throw new AggregateException(initializationFailure, cleanupFailure);
            }

            throw;
        }
    }

    private static ProtocolClassification ReadProtocolVersion(string line)
    {
        if (line.Length > MaximumLineLength) throw new WorkerProtocolException("Worker request is too large.");
        using var document = JsonDocument.Parse(line, new JsonDocumentOptions
        {
            AllowTrailingCommas = false,
            CommentHandling = JsonCommentHandling.Disallow,
            MaxDepth = 64,
        });
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object) throw new WorkerProtocolException("Worker request must be a JSON object.");

        var versions = new List<int>();
        foreach (var property in root.EnumerateObject())
        {
            if (!string.Equals(property.Name, "protocolVersion", StringComparison.OrdinalIgnoreCase)) continue;
            if (property.Value.ValueKind == JsonValueKind.Number && property.Value.TryGetInt32(out var value)) versions.Add(value);
        }

        if (versions.Count == 0)
            throw new WorkerProtocolException("protocolVersion must be an integer.");
        if (versions.Contains(2)) return new ProtocolClassification(WorkerHostProtocol.V2, IsDuplicateV1Discriminator: false);
        if (versions.Count > 1) return new ProtocolClassification(WorkerHostProtocol.V1, IsDuplicateV1Discriminator: true);
        return new ProtocolClassification(versions[0] == 2 ? WorkerHostProtocol.V2 : WorkerHostProtocol.V1, IsDuplicateV1Discriminator: false);
    }

    private sealed record ProtocolClassification(WorkerHostProtocol Protocol, bool IsDuplicateV1Discriminator);

    private static WorkerHostLineResult FailedV1Result() => new(WorkerHostProtocol.V1, FailedV1());

    private static WorkerResponse FailedV1() => new()
    {
        Error = new WorkerError
        {
            Code = "VISIO_WORKER_PROTOCOL_ERROR",
            Message = "Invalid Worker request.",
        },
    };
}
