namespace VisioWorker.Live;

public static class VisioDocumentLifecycle
{
    public static bool ShouldCloseDocumentAfterReadback(bool visible) => !visible;
    public static bool ShouldFitVisibleDocument(bool visible) => visible;
}
