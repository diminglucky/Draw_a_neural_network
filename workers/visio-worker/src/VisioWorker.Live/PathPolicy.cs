namespace VisioWorker.Live;

public static class PathPolicy
{
    public static string ValidateOutputPath(string path, string root)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new WorkerProtocolException("output path is required");
        if (string.IsNullOrWhiteSpace(root)) throw new WorkerProtocolException("output root is required");

        var fullRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var fullPath = Path.GetFullPath(path);
        if (!fullPath.EndsWith(".vsdx", StringComparison.OrdinalIgnoreCase))
            throw new WorkerProtocolException("output path must end with .vsdx");

        var rootWithSeparator = fullRoot + Path.DirectorySeparatorChar;
        if (!fullPath.StartsWith(rootWithSeparator, StringComparison.OrdinalIgnoreCase))
            throw new WorkerProtocolException("output path must remain inside the configured output root");

        return fullPath;
    }
}
