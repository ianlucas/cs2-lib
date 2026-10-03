/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

namespace ItemGenerator.Catalog;

// A highlight is a clip from a Major match, played by the event's souvenir charm. The charm is one
// keychain definition per event; which clip it plays is the "keychain slot 0 highlight" attribute,
// a key into highlight_reels, stored on the weapon or on the detached charm.
public static class Highlights
{
    private const string VideoBaseUrl =
        "https://cdn.steamstatic.com/apps/csgo/videos/highlightreels";

    // The client hardcodes each event's video version (BuildHighlightReelSchemaJSON in libclient).
    private const int DefaultVideoVersion = 1695852000;

    private static readonly Dictionary<int, int> VideoVersions = new()
    {
        [24] = 1752707770,
        [26] = 1782768424,
    };

    public static IEnumerable<HighlightReelRecord> GetReels(ItemGeneratorContext ctx)
    {
        foreach (var entry in KvHelper.GetMergedSection(ctx.GameItems!, "highlight_reels"))
        {
            var reel = entry.Value;
            var key = KvHelper.GetString(reel, "id");
            var eventId = KvHelper.GetInt(reel, "tournament event id");
            var stageId = KvHelper.GetInt(reel, "tournament event stage id");
            var map = KvHelper.GetString(reel, "map");
            var team0Id = KvHelper.GetInt(reel, "tournament event team0 id");
            var team1Id = KvHelper.GetInt(reel, "tournament event team1 id");
            if (
                !int.TryParse(entry.Key, out var index)
                || key == null
                || eventId == null
                || stageId == null
                || map == null
                || team0Id == null
                || team1Id == null
            )
                continue;
            yield return new HighlightReelRecord(
                Index: index,
                Key: key,
                EventId: eventId.Value,
                StageId: stageId.Value,
                Map: map,
                Team0Id: team0Id.Value,
                Team1Id: team1Id.Value
            );
        }
    }

    // The charm each event's highlights play on. Austin and Budapest name it on their souvenir
    // packages' loot lists. Cologne 2026 has no packages, and names it as the base of a keychain
    // definition per highlight.
    public static Dictionary<int, string> GetCharmNames(
        ItemGeneratorContext ctx,
        List<HighlightReelRecord> reels
    )
    {
        var charmNames = new Dictionary<int, string>();
        foreach (var entry in KvHelper.GetMergedSection(ctx.GameItems!, "items"))
        {
            var eventId = Souvenirs.GetEventId(ctx, entry.Value);
            if (
                eventId == null
                || charmNames.ContainsKey(eventId.Value)
                || !Souvenirs.IsPackage(ctx, entry.Value)
            )
                continue;
            var lootListKey = Collections.GetClientLootListKey(ctx, entry.Value);
            var lootList =
                lootListKey != null
                    ? KvHelper.FindInMergedSection(ctx.GameItems!, "client_loot_lists", lootListKey)
                    : null;
            var charmName = KvHelper.GetString(lootList, "match_highlight_reel_keychain");
            if (charmName != null)
                charmNames[eventId.Value] = charmName;
        }

        var eventIdsByKey = reels.ToDictionary(reel => reel.Key, reel => reel.EventId);
        foreach (var entry in KvHelper.GetMergedSection(ctx.GameItems!, "keychain_definitions"))
        {
            var charmName = KvHelper.GetString(entry.Value, "base");
            var reelKey = KvHelper.GetString(entry.Value, "highlight_reel");
            if (
                charmName != null
                && reelKey != null
                && eventIdsByKey.TryGetValue(reelKey, out var eventId)
            )
                charmNames.TryAdd(eventId, charmName);
        }
        return charmNames;
    }

    // Built as the client builds it: the folder is the event, the two team ids in ascending order
    // and the stage, and "ww" is the worldwide clip (the Perfect World client plays "cn").
    public static string GetVideoUrl(HighlightReelRecord reel)
    {
        var low = Math.Min(reel.Team0Id, reel.Team1Id);
        var high = Math.Max(reel.Team0Id, reel.Team1Id);
        var match = $"{reel.EventId:D3}_{low:D3}v{high:D3}_{reel.StageId:D3}";
        var version = VideoVersions.GetValueOrDefault(reel.EventId, DefaultVideoVersion);
        return $"{VideoBaseUrl}/{reel.EventId:D3}/{low:D3}v{high:D3}_{reel.StageId:D3}/{match}_{reel.Map}_{reel.Key}_ww_1080p.webm?v={version}";
    }
}
