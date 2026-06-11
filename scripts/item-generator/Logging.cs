using System.Diagnostics;

namespace ItemGenerator;

public static class Logging
{
    public static void Log(string message)
    {
        Console.WriteLine(message);
    }

    public static async Task RunStep(string name, Func<Task> callback, Func<string?>? getSummary = null)
    {
        var sw = Stopwatch.StartNew();
        Log($"{name}...");
        await callback();
        sw.Stop();
        var summary = getSummary?.Invoke();
        var duration = sw.ElapsedMilliseconds < 1000
            ? $"{sw.ElapsedMilliseconds}ms"
            : $"{sw.Elapsed.TotalSeconds:F1}s";
        Log($"{name} done{(summary != null ? $" ({summary})" : "")} in {duration}.");
    }

    public static string FormatCount(int count, string singular, string? plural = null)
    {
        plural ??= $"{singular}s";
        return $"{count} {(count == 1 ? singular : plural)}";
    }
}
