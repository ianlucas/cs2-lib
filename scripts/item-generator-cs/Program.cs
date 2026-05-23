using ItemGenerator;
using ItemGenerator.Catalog;
using ItemGenerator.Emit;
using ItemGenerator.GameFiles;
using ItemGenerator.Upload;
using static ItemGenerator.Logging;

var mode = Config.DetectMode();
var ctx = new ItemGeneratorContext { Mode = mode };
Log($"Starting item generator in {mode} mode.");

await RunStep("Preparing workspace", () => AssetWorkspace.PrepareWorkspace(ctx),
    () => $"{ctx.StaticAssets.Count} static images, {ctx.ExistingImages.Count} reusable images");

await RunStep("Loading CS2 source data", () => SourceDataLoader.LoadSourceData(ctx),
    () => $"{ctx.CsgoTranslationByLanguage.Count} languages, {ctx.PaintKits.Count} paint kits, {ctx.GraffitiTints.Count} graffiti tints");

await RunStep("Building item catalog", () => CatalogBuilder.BuildCatalog(ctx),
    () => $"{ctx.Items.Count} items, {ctx.NeededVpkPaths.Count} VPK assets, {ctx.ImagesToProcess.Count} image tasks, {ctx.ModelsToProcess.Count} model tasks");

await RunStep("Processing assets", () => AssetProcessor.ProcessAssets(ctx));

await RunStep("Emitting outputs", () => OutputWriter.EmitOutputs(ctx),
    () => $"{ctx.Items.Count} items, {ctx.ItemTranslationByLanguage.Count} translation files");

await RunStep("Uploading assets", () => CdnUploader.UploadAssets(ctx));

Log("Finished.");
