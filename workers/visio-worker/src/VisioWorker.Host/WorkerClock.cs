namespace VisioWorker.Host;

public interface IWorkerClock
{
    DateTimeOffset UtcNow { get; }
}

public sealed class SystemWorkerClock : IWorkerClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}
