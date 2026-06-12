using ItemGenerator;
using ItemGenerator.Catalog;
using ItemGenerator.Depot;
using ItemGenerator.Emit;
using ItemGenerator.GameFiles;
using ItemGenerator.Upload;
using static ItemGenerator.Logging;

var envPath = Path.Combine(Directory.GetCurrentDirectory(), ".env");
if (File.Exists(envPath))
{
    foreach (var line in File.ReadAllLines(envPath))
    {
        var trimmed = line.Trim();
        if (trimmed.Length == 0 || trimmed.StartsWith('#')) continue;
        var eq = trimmed.IndexOf('=');
        if (eq < 0) continue;
        var key = trimmed[..eq].Trim();
        var value = trimmed[(eq + 1)..].Trim().Trim('"');
        Environment.SetEnvironmentVariable(key, value);
    }
}

var mode = Config.DetectMode();
var ctx = new ItemGeneratorContext { Mode = mode };
Log($"Starting item generator in {mode} mode.");

try
{
    await RunStep("Preparing workspace", () => AssetWorkspace.PrepareWorkspace(ctx),
        () => $"{ctx.StaticAssets.Count} static images");

    await RunStep("Loading CS2 source data", () => SourceDataLoader.LoadSourceData(ctx),
        () => $"{ctx.CsgoTranslationByLanguage.Count} languages, {ctx.PaintKits.Count} paint kits, {ctx.GraffitiTints.Count} graffiti tints");

    await RunStep("Building item catalog", () => CatalogBuilder.BuildCatalog(ctx),
        () => $"{ctx.Items.Count} items, {ctx.NeededVpkPaths.Count} VPK assets, {ctx.ImagesToProcess.Count} image tasks, {ctx.ModelsToProcess.Count} model tasks");

    await RunStep("Processing assets", () => AssetProcessor.ProcessAssets(ctx));

    await RunStep("Emitting outputs", () => OutputWriter.EmitOutputs(ctx),
        () => $"{ctx.Items.Count} items, {ctx.ItemTranslationByLanguage.Count} translation files");

    await RunStep("Uploading assets", () => CdnUploader.UploadAssets(ctx));

    // Only now that the full run succeeded do we record the processed depot version.
    await DepotDownloaderService.CommitAssetsManifest(ctx);

    Log("Finished.");
}
catch (DepotUpToDateException ex)
{
    // Nothing new to process: log and exit cleanly so CI reports a green no-op.
    Log(ex.Message);
}
