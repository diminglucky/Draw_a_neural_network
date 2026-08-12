using System.Collections.Concurrent;
using System.Runtime.InteropServices;

namespace VisioWorker.Live;

public sealed class ComStaRunner : IAsyncDisposable
{
    private const uint CoInitApartmentThreaded = 0x2;
    private readonly BlockingCollection<Action> _work = new();
    private readonly TaskCompletionSource<bool> _started = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly Thread _thread;
    private int _disposed;

    public ComStaRunner()
    {
        _thread = new Thread(Run)
        {
            IsBackground = true,
            Name = "synapse-visio-com",
        };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
    }

    public async Task<T> InvokeAsync<T>(Func<T> action)
    {
        ArgumentNullException.ThrowIfNull(action);
        await _started.Task.ConfigureAwait(false);
        ObjectDisposedException.ThrowIf(_disposed != 0, this);

        var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            _work.Add(() =>
            {
                try { completion.SetResult(action()); }
                catch (Exception error) { completion.SetException(error); }
            });
        }
        catch (InvalidOperationException)
        {
            throw new ObjectDisposedException(nameof(ComStaRunner));
        }
        return await completion.Task.ConfigureAwait(false);
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        _work.CompleteAdding();
        await Task.Run(_thread.Join).ConfigureAwait(false);
        _work.Dispose();
    }

    private void Run()
    {
        var initialized = false;
        try
        {
            var result = CoInitializeEx(IntPtr.Zero, CoInitApartmentThreaded);
            if (result < 0) throw new COMException("CoInitializeEx failed", result);
            initialized = true;
            _started.SetResult(true);
            foreach (var action in _work.GetConsumingEnumerable()) action();
        }
        catch (Exception error)
        {
            _started.TrySetException(error);
        }
        finally
        {
            if (initialized) CoUninitialize();
        }
    }

    [DllImport("ole32.dll")]
    private static extern int CoInitializeEx(IntPtr reserved, uint coInit);

    [DllImport("ole32.dll")]
    private static extern void CoUninitialize();
}
