namespace VisioWorker.Host;

internal static class Program
{
    public static async Task<int> Main(string[] args)
    {
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
