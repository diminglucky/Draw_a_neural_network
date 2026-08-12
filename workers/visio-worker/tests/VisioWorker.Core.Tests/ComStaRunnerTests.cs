using VisioWorker.Live;

namespace VisioWorker.Core.Tests;

public sealed class ComStaRunnerTests
{
    [Fact]
    public async Task Serializes_actions_on_one_thread()
    {
        await using var runner = new ComStaRunner();
        var threadIds = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => runner.InvokeAsync(() => Environment.CurrentManagedThreadId)));

        Assert.Single(threadIds.Distinct());
    }
}
