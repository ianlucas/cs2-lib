/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

using System.Text.RegularExpressions;
using ValveKeyValue;

namespace ItemGenerator.Catalog;

// What a souvenir package puts on the item it drops. The item server applies these and the schema
// does not say how, so the rules here are the publicly documented ones: the two teams of the match
// and the event each give a sticker, joined by the round MVP's autograph from Cologne 2015 and by
// the map's sticker, in the autograph's place, from Stockholm 2021. See docs/souvenirs.md.
public static partial class Souvenirs
{
    private const string PackagePrefab = "weapon_case_souvenirpkg";

    // Stockholm 2021.
    private const int FirstMapStickerEventId = 18;

    // Copenhagen 2024, the first Major played in CS2. Maps redrawn for CS2 have a second sticker.
    private const int FirstCs2EventId = 22;

    // The events whose sticker cannot be told from the kit names: Cologne 2014's three are named
    // a, b and c, and DreamHack 2014 has no gold one.
    private static readonly Dictionary<int, string[]> EventStickerNames = new()
    {
        [4] = ["cologne2014_esl_c"],
        [5] = ["dhw2014_dhw_foil"],
    };

    public static bool IsPackage(ItemGeneratorContext ctx, KVObject item)
    {
        return GetPrefabChain(ctx, item).Any(prefab => prefab.Name == PackagePrefab);
    }

    // Newer packages take the attribute from a per-event prefab instead of carrying it.
    public static int? GetEventId(ItemGeneratorContext ctx, KVObject item)
    {
        foreach (
            var definition in GetPrefabChain(ctx, item).Select(p => p.Definition).Prepend(item)
        )
        {
            var attribute = KvHelper.GetChild(
                KvHelper.GetChild(definition, "attributes"),
                "tournament event id"
            );
            var eventId = KvHelper.GetInt(attribute, "value");
            if (eventId != null)
                return eventId;
        }
        return null;
    }

    // Each team's sticker at the event, by team id. Katowice 2014 and Cologne 2014 have no gold team
    // stickers; their souvenirs take the foil.
    public static SortedDictionary<int, int> GetTeamStickerIds(
        ItemGeneratorContext ctx,
        int eventId
    )
    {
        var teamKits = ctx
            .StickerKits.Where(kit => kit.EventId == eventId && !kit.IsAutograph && kit.TeamId > 0)
            .ToList();
        var teamStickerIds = new SortedDictionary<int, int>();
        foreach (var suffix in new[] { "_gold", "_foil" })
        {
            foreach (var kit in teamKits.Where(kit => kit.Name.EndsWith(suffix)))
                teamStickerIds.TryAdd(kit.TeamId!.Value, kit.Id);
            if (teamStickerIds.Count > 0)
                break;
        }
        return teamStickerIds;
    }

    public static void Populate(
        ItemGeneratorContext ctx,
        CS2Item container,
        KVObject item,
        int eventId
    )
    {
        var kits = ctx.StickerKits.Where(kit => kit.EventId == eventId).ToList();
        var eventKits = kits.Where(kit => !kit.IsAutograph && (kit.TeamId ?? 0) == 0).ToList();
        container.SouvenirEventStickerIds = NullIfEmpty(
            GetEventKits(eventId, eventKits).Select(kit => kit.Id).ToList()
        );

        var teamStickerIds = GetTeamStickerIds(ctx, eventId);
        var hasMapSticker = eventId >= FirstMapStickerEventId;
        container.SouvenirTeamStickerIds = NullIfEmpty(
            teamStickerIds
                .Select(team =>
                    kits.Where(kit =>
                            !hasMapSticker
                            && kit.IsAutograph
                            && kit.TeamId == team.Key
                            && kit.Name.EndsWith("_gold")
                        )
                        .Select(kit => kit.Id)
                        .Prepend(team.Value)
                        .ToList()
                )
                .ToList()
        );

        var map = MapRegex().Match(KvHelper.GetString(item, "name") ?? "");
        if (!map.Success)
            return;
        var mapName = map.Groups[1].Value;
        if (hasMapSticker)
            container.SouvenirMapStickerId = (
                (eventId >= FirstCs2EventId ? FindKit(ctx, $"{mapName}_cs2_gold") : null)
                ?? FindKit(ctx, $"{mapName}_gold")
            )?.Id;

        // A highlight names the playoff match it was cut from; the matches themselves are not in the
        // schema. Its team stickers come from GetTeamStickerIds too, so both are the package's.
        container.SouvenirHighlightIds = NullIfEmpty(
            ctx.HighlightReels.Where(entry =>
                    entry.Value.EventId == eventId
                    && entry.Value.Map == mapName
                    && ctx.Items[entry.Key].TeamStickerIds != null
                )
                .OrderBy(entry => entry.Value.Index)
                .Select(entry => entry.Key)
                .ToList()
        );
    }

    // DreamHack 2013 souvenirs carry any one of the event's stickers and nothing else.
    private static List<StickerKitRecord> GetEventKits(int eventId, List<StickerKitRecord> kits)
    {
        if (EventStickerNames.TryGetValue(eventId, out var names))
            return kits.Where(kit => names.Contains(kit.Name)).ToList();
        var gold = kits.Where(kit => kit.Name.Contains("_gold")).ToList();
        return gold.Count > 0 ? gold : kits;
    }

    private static StickerKitRecord? FindKit(ItemGeneratorContext ctx, string name)
    {
        return ctx.StickerKits.FirstOrDefault(kit => kit.Name == name);
    }

    private static IEnumerable<(string Name, KVObject Definition)> GetPrefabChain(
        ItemGeneratorContext ctx,
        KVObject item
    )
    {
        var seen = new HashSet<string>();
        var pending = new Queue<string>(SplitPrefabs(item));
        while (pending.TryDequeue(out var name))
        {
            if (!seen.Add(name))
                continue;
            var definition = KvHelper.FindInMergedSection(ctx.GameItems!, "prefabs", name);
            if (definition == null)
                continue;
            yield return (name, definition);
            foreach (var parent in SplitPrefabs(definition))
                pending.Enqueue(parent);
        }
    }

    private static string[] SplitPrefabs(KVObject definition)
    {
        return (KvHelper.GetString(definition, "prefab") ?? "").Split(
            ' ',
            StringSplitOptions.RemoveEmptyEntries
        );
    }

    private static List<T>? NullIfEmpty<T>(List<T> list)
    {
        return list.Count > 0 ? list : null;
    }

    [GeneratedRegex(@"_promo_(de_[a-z0-9]+)$")]
    private static partial Regex MapRegex();
}
