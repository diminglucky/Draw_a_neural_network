using VisioWorker.Live;

namespace VisioWorker.Core.Tests;

public sealed class PathPolicyTests
{
    [Theory]
    [InlineData("C:\\exports\\..\\outside.vsdx")]
    [InlineData("C:\\exports\\result.json")]
    public void Rejects_output_paths_outside_the_vsdx_root(string path)
    {
        Assert.Throws<WorkerProtocolException>(() => PathPolicy.ValidateOutputPath(path, "C:\\exports"));
    }

    [Fact]
    public void Accepts_a_vsdx_path_inside_the_root()
    {
        var path = PathPolicy.ValidateOutputPath("C:\\exports\\job-1.vsdx", "C:\\exports");
        Assert.Equal(Path.GetFullPath("C:\\exports\\job-1.vsdx"), path, ignoreCase: true);
    }
}
