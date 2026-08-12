namespace VisioWorker.Live;

public sealed class WorkerProtocolException : Exception
{
    public WorkerProtocolException(string message) : base(message) { }

    public WorkerProtocolException(string message, Exception innerException) : base(message, innerException) { }
}
