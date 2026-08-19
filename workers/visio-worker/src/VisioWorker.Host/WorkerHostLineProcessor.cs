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
    // Internal test seam: production still creates only VisioComEngine and its typed backend.
    internal Func<VisioComEngineOptions, (IAsyncDisposable Engine, Func<IVisioSessionBackend> CreateSessionBackend)>? OwnedEngineFactory { get; init; }
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

        if (classification.RequiresSafeV1Failure) return FailedV1Result();

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
            var owned = await CreateOwnedEngineAsync(engineOptions).ConfigureAwait(false);
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

    private async Task<(IVisioSessionBackend Backend, IAsyncDisposable Engine)> CreateOwnedEngineAsync(VisioComEngineOptions options)
    {
        var owned = _options.OwnedEngineFactory?.Invoke(options) ?? CreateProductionOwnedEngine(options);
        try
        {
            return (owned.CreateSessionBackend(), owned.Engine);
        }
        catch (Exception initializationFailure)
        {
            try
            {
                await owned.Engine.DisposeAsync().ConfigureAwait(false);
            }
            catch (Exception cleanupFailure)
            {
                throw new AggregateException(initializationFailure, cleanupFailure);
            }

            throw;
        }
    }

    private static (IAsyncDisposable Engine, Func<IVisioSessionBackend> CreateSessionBackend) CreateProductionOwnedEngine(VisioComEngineOptions options)
    {
        var engine = new VisioComEngine(options);
        return (engine, engine.CreateSessionBackend);
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

        var discriminators = new List<JsonElement>();
        foreach (var property in root.EnumerateObject())
        {
            if (!string.Equals(property.Name, "protocolVersion", StringComparison.OrdinalIgnoreCase)) continue;
            discriminators.Add(property.Value);
        }

        // Any numeric v2 marker stays in the strict v2 parser, even if another discriminator is malformed.
        // Every other duplicate is rejected before the case-insensitive legacy v1 deserializer can observe it.
        if (discriminators.Any(IsMathematicallyTwo))
            return new ProtocolClassification(WorkerHostProtocol.V2, RequiresSafeV1Failure: false);
        if (discriminators.Count != 1)
            return new ProtocolClassification(WorkerHostProtocol.V1, RequiresSafeV1Failure: true);

        var onlyDiscriminator = discriminators[0];
        return onlyDiscriminator.ValueKind == JsonValueKind.Number
            && onlyDiscriminator.TryGetInt32(out var onlyVersion)
            && onlyVersion == 1
            ? new ProtocolClassification(WorkerHostProtocol.V1, RequiresSafeV1Failure: false)
            : new ProtocolClassification(WorkerHostProtocol.V1, RequiresSafeV1Failure: true);
    }

    private static bool IsMathematicallyTwo(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Number) return false;

        // Preserve strict parser semantics: this is classification only. Interpret the JSON
        // number lexeme exactly so values such as 2.0 and 2e0 are v2 candidates without
        // admitting a nearby floating-point value through rounding.
        var literal = value.GetRawText().AsSpan();
        var exponentIndex = literal.IndexOfAny('e', 'E');
        var significand = exponentIndex >= 0 ? literal[..exponentIndex] : literal;
        if (significand.IsEmpty || significand[0] == '-') return false;

        var decimalIndex = significand.IndexOf('.');
        var fractionalDigits = decimalIndex >= 0 ? significand.Length - decimalIndex - 1 : 0;
        var nonZeroCount = 0;
        var nonZeroDigit = '\0';
        var trailingZeros = 0;

        foreach (var character in significand)
        {
            if (character == '.') continue;
            if (character == '0')
            {
                if (nonZeroCount > 0) trailingZeros++;
                continue;
            }

            nonZeroCount++;
            nonZeroDigit = character;
            trailingZeros = 0;
        }

        if (nonZeroCount != 1 || nonZeroDigit != '2') return false;
        return ExponentEquals(exponentIndex >= 0 ? literal[(exponentIndex + 1)..] : ReadOnlySpan<char>.Empty, fractionalDigits - trailingZeros);
    }

    private static bool ExponentEquals(ReadOnlySpan<char> exponent, int expected)
    {
        if (exponent.IsEmpty) return expected == 0;

        var negative = false;
        if (exponent[0] is '+' or '-')
        {
            negative = exponent[0] == '-';
            exponent = exponent[1..];
        }

        var firstNonZero = 0;
        while (firstNonZero < exponent.Length && exponent[firstNonZero] == '0') firstNonZero++;
        if (firstNonZero == exponent.Length) return expected == 0;
        if (expected == 0 || negative != (expected < 0)) return false;

        // The maximum possible expected exponent is bounded by MaximumLineLength, so values
        // with more digits cannot equal it and do not need a lossy numeric conversion.
        var expectedMagnitude = Math.Abs(expected);
        var magnitude = 0;
        for (var index = firstNonZero; index < exponent.Length; index++)
        {
            if (magnitude > expectedMagnitude / 10) return false;
            magnitude = (magnitude * 10) + (exponent[index] - '0');
            if (magnitude > expectedMagnitude) return false;
        }

        return magnitude == expectedMagnitude;
    }

    private sealed record ProtocolClassification(WorkerHostProtocol Protocol, bool RequiresSafeV1Failure);

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
