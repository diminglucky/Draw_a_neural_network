using System.Text;

namespace VisioWorker.Host;

public static class WorkerStandardStreams
{
    private static readonly Encoding JsonLinesEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);

    public static void Configure(
        Action<Encoding> setInputEncoding,
        Action<Encoding> setOutputEncoding,
        Action<TextWriter> setErrorWriter,
        Func<Stream> openStandardError)
    {
        ArgumentNullException.ThrowIfNull(setInputEncoding);
        ArgumentNullException.ThrowIfNull(setOutputEncoding);
        ArgumentNullException.ThrowIfNull(setErrorWriter);
        ArgumentNullException.ThrowIfNull(openStandardError);
        setInputEncoding(JsonLinesEncoding);
        setOutputEncoding(JsonLinesEncoding);
        setErrorWriter(new StreamWriter(openStandardError(), JsonLinesEncoding) { AutoFlush = true });
    }
}

internal static class Program
{
    public static async Task<int> Main(string[] args)
    {
        WorkerStandardStreams.Configure(
            encoding => Console.InputEncoding = encoding,
            encoding => Console.OutputEncoding = encoding,
            writer => Console.SetError(writer),
            Console.OpenStandardError);
        var mode = ReadOption(args, "--mode") ?? "mock";
        var outputRoot = ReadOption(args, "--output-root");
        if (string.IsNullOrWhiteSpace(outputRoot))
        {
            await Console.Error.WriteLineAsync("--output-root is required");
            return 2;
        }

        return await WorkerHostLoop.RunAsync(Console.In, Console.Out, new WorkerHostLineProcessorOptions
        {
            OutputRoot = outputRoot,
            Mode = mode,
            Visible = HasFlag(args, "--visible"),
            AttachToRunning = HasFlag(args, "--attach-to-running"),
        }).ConfigureAwait(false);
    }

    private static bool HasFlag(string[] args, string name) => args.Any(argument => string.Equals(argument, name, StringComparison.OrdinalIgnoreCase));

    private static string? ReadOption(string[] args, string name)
    {
        for (var index = 0; index < args.Length - 1; index++)
            if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase)) return args[index + 1];
        return null;
    }
}
