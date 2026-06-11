using System.Text.RegularExpressions;
using System.Web;

namespace ItemGenerator.Catalog;

public static class Translations
{
    private static string? ResolveToken(string? token)
    {
        if (token == null || token.Length == 0) return null;
        return (token[0] == '#' ? token[1..] : token).ToLowerInvariant();
    }

    private static bool IsTranslationKey(ItemGeneratorContext ctx, string? token)
    {
        if (token == null || token.Length == 0) return false;
        var resolved = ResolveToken(token);
        if (resolved == null) return false;
        return ctx.CsgoTranslationByLanguage.TryGetValue("english", out var english)
            && english.ContainsKey(resolved);
    }

    public static string? FindTranslation(ItemGeneratorContext ctx, string? token, string language = "english")
    {
        token = ResolveToken(token);
        if (token == null) return null;
        if (!ctx.CsgoTranslationByLanguage.TryGetValue(language, out var translations))
            return null;
        if (!translations.TryGetValue(token, out var value) || value == null)
            return null;
        return StripHtml(value);
    }

    public static string RequireTranslation(ItemGeneratorContext ctx, string? token, string language = "english")
    {
        return FindTranslation(ctx, token, language)
            ?? throw new InvalidOperationException($"Failed to find translation for '{token}' ({language}).");
    }

    public static bool HasTranslation(ItemGeneratorContext ctx, string? token)
    {
        var resolved = ResolveToken(token);
        if (resolved == null) return false;
        return ctx.CsgoTranslationByLanguage.TryGetValue("english", out var english)
            && english.ContainsKey(resolved);
    }

    public static void AddTranslation(ItemGeneratorContext ctx, int id, string property, params string?[] tokens)
    {
        foreach (var (language, items) in ctx.ItemTranslationByLanguage)
        {
            if (!items.TryGetValue(id, out var itemTranslation))
            {
                itemTranslation = new CS2ItemTranslation();
                items[id] = itemTranslation;
            }

            var parts = new List<string>();
            foreach (var token in tokens)
            {
                if (token == null)
                    throw new InvalidOperationException("Translation token is null");
                if (IsTranslationKey(ctx, token))
                    parts.Add(FindTranslation(ctx, token, language) ?? RequireTranslation(ctx, token));
                else
                    parts.Add(token);
            }

            var value = string.Join("", parts).Trim();
            if (value.Length == 0) continue;

            if (property == "name" && language == "english")
                ctx.ItemNames[id] = value;

            SetTranslationProperty(itemTranslation, property, value);
        }
    }

    public static void TryAddTranslation(ItemGeneratorContext ctx, int id, string property, string? token)
    {
        if (IsTranslationKey(ctx, token))
            AddTranslation(ctx, id, property, token!);
    }

    public static void AddFormattedTranslation(ItemGeneratorContext ctx, int id, string property, string? key, params string[] values)
    {
        foreach (var (language, items) in ctx.ItemTranslationByLanguage)
        {
            if (!items.TryGetValue(id, out var itemTranslation))
            {
                itemTranslation = new CS2ItemTranslation();
                items[id] = itemTranslation;
            }

            var template = FindTranslation(ctx, key, language) ?? RequireTranslation(ctx, key, "english");
            var result = Config.FormattedStringRe.Replace(template, match =>
            {
                var index = int.Parse(match.Groups[1].Value) - 1;
                if (index < 0 || index >= values.Length) return match.Value;
                var valueKey = values[index];
                return FindTranslation(ctx, valueKey, language) ?? RequireTranslation(ctx, valueKey, "english");
            });

            SetTranslationProperty(itemTranslation, property, result);
        }
    }

    private static void SetTranslationProperty(CS2ItemTranslation translation, string property, string value)
    {
        switch (property)
        {
            case "name": translation.Name = value; break;
            case "desc": translation.Desc = value; break;
            case "category": translation.Category = value; break;
            case "collectionName": translation.CollectionName = value; break;
            case "collectionDesc": translation.CollectionDesc = value; break;
            case "tournamentDesc": translation.TournamentDesc = value; break;
        }
    }

    private static string StripHtml(string input)
    {
        var result = Regex.Replace(input, "<[^>]+>", "");
        return HttpUtility.HtmlDecode(result) ?? result;
    }
}
