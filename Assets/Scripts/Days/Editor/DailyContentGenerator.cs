using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using UnityEditor;
using UnityEngine;
using UnityEngine.Networking;

/// <summary>
/// Tools > Reading World > Daily Content Generator.
/// Pick a day and a topic, press Generate, and Claude writes that day's conversations for every character in
/// Resources/DailyContent (all three reading levels), plus definitions for the new highlighted words.
/// Editor only: the API key never goes into the project or a build.
/// </summary>
public class DailyContentGenerator : EditorWindow
{
    const string ApiUrl = "https://api.anthropic.com/v1/messages";
    const string Model = "claude-opus-5-5";
    const string KeyPref = "ReadingWorld.AnthropicApiKey";
    const string ContentPath = "Assets/Resources/DailyContent.asset";
    const string DaysFolder = "Assets/Dialogue/Days";
    const string DefinitionsPath = "Assets/Dialogue/GlossaryDefinitions.json";
    static readonly string[] Levels = { "Ages5to8", "Ages8to11", "Ages12to15" };

    int day = 2;
    string topic = "";
    string apiKey = "";
    bool busy;
    string status = "";
    readonly List<string> log = new();
    Vector2 scroll;

    [MenuItem("Tools/Reading World/Daily Content Generator")]
    static void Open() => GetWindow<DailyContentGenerator>("Daily Content");

    void OnEnable()
    {
        apiKey = EditorPrefs.GetString(KeyPref, "");
        var content = LoadContent();
        if (content != null && content.days.Count > 0) day = Mathf.Max(2, content.days.Max(d => d.day) + 1);
    }

    static string EnvKey => Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY");
    string Key => string.IsNullOrEmpty(EnvKey) ? apiKey : EnvKey;

    // ---------------------------------------------------------------- UI

    void OnGUI()
    {
        var content = LoadContent();
        if (content == null)
        {
            EditorGUILayout.HelpBox($"No DailyContent asset at {ContentPath}.", MessageType.Error);
            return;
        }

        EditorGUILayout.LabelField("Generate a day of conversations", EditorStyles.boldLabel);
        using (new EditorGUI.DisabledScope(busy))
        {
            day = Mathf.Max(2, EditorGUILayout.IntField(new GUIContent("Day", "Day 1 is the hand-written dialogue in the scene."), day));
            EditorGUILayout.LabelField("Topic");
            topic = EditorGUILayout.TextArea(topic, GUILayout.MinHeight(44));

            if (string.IsNullOrEmpty(EnvKey))
            {
                string k = EditorGUILayout.PasswordField(new GUIContent("Anthropic API key", "Saved in this computer's Unity preferences, never in the project."), apiKey);
                if (k != apiKey) { apiKey = k.Trim(); EditorPrefs.SetString(KeyPref, apiKey); }
            }
            else EditorGUILayout.LabelField("API key", "Using ANTHROPIC_API_KEY");

            bool exists = content.days.Any(d => d.day == day);
            if (exists) EditorGUILayout.HelpBox($"Day {day} already exists. Generating will replace it.", MessageType.Warning);

            using (new EditorGUI.DisabledScope(string.IsNullOrWhiteSpace(topic) || string.IsNullOrEmpty(Key)))
                if (GUILayout.Button(busy ? "Generating..." : "Generate", GUILayout.Height(34)))
                    _ = Generate(content);
        }

        if (!string.IsNullOrEmpty(status)) EditorGUILayout.HelpBox(status, MessageType.Info);

        EditorGUILayout.Space();
        EditorGUILayout.LabelField("Days", EditorStyles.boldLabel);
        foreach (var d in content.days.OrderBy(d => d.day))
        {
            using (new EditorGUILayout.HorizontalScope())
            {
                bool live = EditorGUILayout.ToggleLeft($"Day {d.day}: {d.topic}", d.live);
                if (live != d.live)
                {
                    Undo.RecordObject(content, "Toggle day");
                    d.live = live;
                    EditorUtility.SetDirty(content);
                }
                if (GUILayout.Button("Files", GUILayout.Width(50)))
                    EditorGUIUtility.PingObject(AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(DayFolder(d.day)));
            }
        }

        if (log.Count > 0)
        {
            EditorGUILayout.Space();
            scroll = EditorGUILayout.BeginScrollView(scroll, GUILayout.MinHeight(120));
            foreach (var line in log) EditorGUILayout.LabelField(line, EditorStyles.wordWrappedMiniLabel);
            EditorGUILayout.EndScrollView();
        }
    }

    void Log(string line)
    {
        log.Add(line);
        status = line;
        Repaint();
    }

    static DailyContent LoadContent() => AssetDatabase.LoadAssetAtPath<DailyContent>(ContentPath);
    static string DayFolder(int d) => $"{DaysFolder}/Day{d:00}";

    // ---------------------------------------------------------------- Generation

    async Task Generate(DailyContent content)
    {
        if (content.days.Any(d => d.day == day) &&
            !EditorUtility.DisplayDialog("Replace day?", $"Day {day} already exists. Replace its conversations?", "Replace", "Cancel"))
            return;

        var host = content.characters.FirstOrDefault(c => c.isHost);
        var friends = content.characters.Where(c => !c.isHost).ToList();
        if (host == null || friends.Count == 0)
        {
            status = "DailyContent needs one host character and at least one other character.";
            return;
        }

        busy = true;
        log.Clear();
        int genDay = day;
        string genTopic = topic.Trim();
        try
        {
            string system = BuildSystemPrompt(content);
            var results = new Dictionary<string, Generated>();

            // The host goes first so its request writes the prompt cache; the others then read it.
            Log($"Writing {host.name}'s lines for day {genDay}...");
            results[host.npcId] = await GenerateCharacter(system, UserPrompt(host, friends, genDay, genTopic), host.name);

            Log($"Writing {string.Join(", ", friends.Select(f => f.name))}...");
            var done = await Task.WhenAll(friends.Select(f => GenerateCharacter(system, UserPrompt(f, friends, genDay, genTopic), f.name)));
            for (int i = 0; i < friends.Count; i++) results[friends[i].npcId] = done[i];

            WriteDay(content, genDay, genTopic, host, friends, results);
            Log($"Day {genDay} is ready. Read it through before you build: {DayFolder(genDay)}");
        }
        catch (Exception e)
        {
            Log("Failed: " + e.Message);
            Debug.LogException(e);
        }
        finally
        {
            busy = false;
            Repaint();
        }
    }

    // One API call: one character, all three reading levels.
    async Task<Generated> GenerateCharacter(string system, string user, string who)
    {
        string body = "{" +
            $"\"model\":{Q(Model)}," +
            "\"max_tokens\":16000," +
            "\"fallbacks\":\"default\"," +
            "\"output_config\":{\"effort\":\"medium\",\"format\":{\"type\":\"json_schema\",\"schema\":" + Schema + "}}," +
            "\"system\":[{\"type\":\"text\",\"text\":" + Q(system) + ",\"cache_control\":{\"type\":\"ephemeral\"}}]," +
            "\"messages\":[{\"role\":\"user\",\"content\":" + Q(user) + "}]" +
            "}";

        for (int attempt = 1; ; attempt++)
        {
            using var req = new UnityWebRequest(ApiUrl, "POST");
            req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("content-type", "application/json");
            req.SetRequestHeader("x-api-key", Key);
            req.SetRequestHeader("anthropic-version", "2026-10-21");
            req.SetRequestHeader("anthropic-beta", "server-side-fallback-2026-07-01");
            req.timeout = 600;

            await Send(req);
            long code = req.responseCode;
            string text = req.downloadHandler.text;

            // Rate limits, overload and server errors are worth retrying; anything else is a real problem.
            bool retry = req.result == UnityWebRequest.Result.ConnectionError || code == 429 || code >= 500;
            if (retry && attempt < 3)
            {
                Log($"{who}: {(code > 0 ? "HTTP " + code : req.error)}, retrying...");
                await Task.Delay(attempt * 5000);
                continue;
            }
            if (req.result != UnityWebRequest.Result.Success)
            {
                var err = SafeParse<ApiResponse>(text)?.error;
                throw new Exception($"{who}: {(code > 0 ? "HTTP " + code : req.error)} {err?.type} {err?.message}".Trim());
            }

            var resp = JsonUtility.FromJson<ApiResponse>(text);
            if (resp.stop_reason == "refusal") throw new Exception($"{who}: the request was declined. Try rewording the topic.");
            if (resp.stop_reason == "max_tokens") throw new Exception($"{who}: the reply was cut off before it finished.");

            var json = new StringBuilder();
            foreach (var block in resp.content) if (block.type == "text") json.Append(block.text);
            var gen = JsonUtility.FromJson<Generated>(json.ToString());
            if (gen?.levels == null) throw new Exception($"{who}: the reply wasn't in the expected format.");

            var u = resp.usage;
            if (u != null) log.Add($"{who}: done ({u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens} tokens in, {u.cache_read_input_tokens} from cache; {u.output_tokens} out)");
            return gen;
        }
    }

    static Task Send(UnityWebRequest req)
    {
        var done = new TaskCompletionSource<bool>();
        req.SendWebRequest().completed += _ => done.TrySetResult(true);
        return done.Task;
    }

    static T SafeParse<T>(string json) where T : class
    {
        try { return JsonUtility.FromJson<T>(json); } catch { return null; }
    }

    // ---------------------------------------------------------------- Prompts

    static string BuildSystemPrompt(DailyContent content)
    {
        var sb = new StringBuilder();
        sb.AppendLine(@"You write dialogue for Reading World, a cosy 3D game that helps children practise reading. The player walks around a small camp and talks to friendly characters. Each conversation is shown one line at a time in a speech box.

The game has three reading levels, and you always write all three versions of a conversation:
- ages5to8: short, simple sentences (about 12 words or fewer per line), everyday words, one idea per line.
- ages8to11: longer sentences, some richer vocabulary, light humour.
- ages12to15: fluent, more complex sentences and ambitious vocabulary, never patronising.
The three versions tell the same content at different reading levels; they are not translations of each other line for line.

Writing rules:
- Warm, kind and encouraging. Nothing frightening, violent, romantic, rude or sad beyond gentle worry. No real brands, celebrities, websites or places that identify a real person.
- British English spelling.
- Plain text only, except highlighted words. Highlight important vocabulary by wrapping it exactly like <color=red>word</color>. Aim for one highlighted word or short phrase per line, never more than two. The reader collects every highlighted word in a glossary, so choose words worth learning at that reading level.
- A line can be a multiple-choice question. Give it 3 answer choices (4 at most), the zero-based index of the right one in correctIndex, a gentle hint for a wrong pick (starting ""Not quite."") and a short correctText shown after the right pick. For a line that isn't a question, use an empty choices list, correctIndex 0 and empty hint and correctText.
- Questions must have exactly one clearly right answer that a reader at that level can work out from what the character said.
- For missing-word questions, put the gap in the line as <color=red>_____</color> (five underscores) and repeat the full sentence with the answer highlighted in correctText.
- Do not write the character's name in front of each line; the game shows the speaker.

In ""definitions"", give a definition for every word or phrase you highlighted (not the _____ gap): the word in lower case exactly as highlighted, and one short, child-friendly sentence explaining what it means as it is used in the conversation.

Here are the characters:");
        foreach (var c in content.characters)
            sb.AppendLine($"- {c.name} (id {c.npcId}){(c.isHost ? ", the host" : "")}: {c.personality}");

        sb.AppendLine();
        sb.AppendLine("Here is day 1 of the game, hand-written, to show the style and format. Match its tone, pacing and length; don't reuse its stories or questions.");
        foreach (var guid in AssetDatabase.FindAssets("t:TextAsset", new[] { "Assets/Dialogue" }))
        {
            string path = AssetDatabase.GUIDToAssetPath(guid);
            string file = Path.GetFileName(path);
            if (!path.EndsWith(".json") || path.StartsWith(DaysFolder) || file == Path.GetFileName(DefinitionsPath)) continue;
            if (!Levels.Any(l => file.Contains(l))) continue;   // skip the old single-level file
            sb.AppendLine($"<example file=\"{file}\">");
            sb.AppendLine(File.ReadAllText(path).Trim());
            sb.AppendLine("</example>");
        }
        return sb.ToString();
    }

    static string UserPrompt(DailyContent.Character c, List<DailyContent.Character> friends, int day, string topic)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"Write day {day} for {c.name}. Today's topic is:");
        sb.AppendLine($"<topic>{topic}</topic>");
        sb.AppendLine();
        if (c.isHost)
        {
            string names = string.Join(", ", friends.Select(f => f.name));
            sb.AppendLine($@"{c.name} opens the day. In ""lines"", greet the reader, bring in today's topic in a way that fits {c.name}'s story, and send the reader to help {names}, who each need help with something today (mention all of them by name). No questions in these lines.
""inProgressLines"": a short reminder (2 lines) for when the reader comes back before helping everyone.
""completeLines"": {c.name} is delighted that everyone has been helped (2-3 lines).
""afterLines"": one cheerful line for any later visit.
""questTitle"": a short title for today's goal shown in the quest list, e.g. ""Help {c.name}"".");
        }
        else
        {
            sb.AppendLine($@"{c.name}'s mission today, themed around the topic: {c.mission}
""lines"": a greeting, a line explaining the mission and that finishing it sends {c.rewardBooks} new books to the library, then the mission itself including its questions, then a thank-you line once every question is answered.
""inProgressLines"" and ""completeLines"": empty lists.
""afterLines"": one line for a later visit.
""questTitle"": a short title shown in the quest list, e.g. ""{c.name}'s quiz"".");
        }
        return sb.ToString();
    }

    // Structured output: the reply always matches this shape.
    const string Schema = @"{""type"":""object"",""additionalProperties"":false,""required"":[""levels"",""definitions""],""properties"":{" +
        @"""levels"":{""type"":""object"",""additionalProperties"":false,""required"":[""ages5to8"",""ages8to11"",""ages12to15""],""properties"":{" +
            @"""ages5to8"":{""$ref"":""#/$defs/dialogue""},""ages8to11"":{""$ref"":""#/$defs/dialogue""},""ages12to15"":{""$ref"":""#/$defs/dialogue""}}}," +
        @"""definitions"":{""type"":""array"",""items"":{""type"":""object"",""additionalProperties"":false,""required"":[""word"",""definition""],""properties"":{""word"":{""type"":""string""},""definition"":{""type"":""string""}}}}}," +
        @"""$defs"":{" +
            @"""line"":{""type"":""object"",""additionalProperties"":false,""required"":[""text"",""choices"",""correctIndex"",""hint"",""correctText""],""properties"":{""text"":{""type"":""string""},""choices"":{""type"":""array"",""items"":{""type"":""string""}},""correctIndex"":{""type"":""integer""},""hint"":{""type"":""string""},""correctText"":{""type"":""string""}}}," +
            @"""lines"":{""type"":""array"",""items"":{""$ref"":""#/$defs/line""}}," +
            @"""dialogue"":{""type"":""object"",""additionalProperties"":false,""required"":[""questTitle"",""lines"",""inProgressLines"",""completeLines"",""afterLines""],""properties"":{""questTitle"":{""type"":""string""},""lines"":{""$ref"":""#/$defs/lines""},""inProgressLines"":{""$ref"":""#/$defs/lines""},""completeLines"":{""$ref"":""#/$defs/lines""},""afterLines"":{""$ref"":""#/$defs/lines""}}}" +
        @"}}";

    // ---------------------------------------------------------------- Writing the files

    void WriteDay(DailyContent content, int d, string dayTopic, DailyContent.Character host,
        List<DailyContent.Character> friends, Dictionary<string, Generated> results)
    {
        string folder = DayFolder(d);
        Directory.CreateDirectory(folder);
        string hostQuest = $"day{d}_{host.npcId}";
        var friendQuests = friends.Select(f => $"day{d}_{f.npcId}").ToArray();

        var entry = new DailyContent.Day { day = d, topic = dayTopic, live = true };
        var paths = new List<(DailyContent.NpcFiles files, string[] paths)>();
        var newDefinitions = new Dictionary<string, string>();
        var highlighted = new HashSet<string>();

        foreach (var c in content.characters)
        {
            if (!results.TryGetValue(c.npcId, out var gen)) continue;
            var levels = new[] { gen.levels.ages5to8, gen.levels.ages8to11, gen.levels.ages12to15 };
            var filePaths = new string[3];

            for (int i = 0; i < 3; i++)
            {
                var g = levels[i];
                if (g == null || g.lines == null || g.lines.Length == 0) throw new Exception($"{c.name} {Levels[i]}: no lines were written.");

                var data = new DialogueData
                {
                    npcName = c.name,
                    lines = Convert(g.lines, c.name, $"{c.name} {Levels[i]}"),
                    inProgressLines = Convert(g.inProgressLines, c.name, null),
                    completeLines = Convert(g.completeLines, c.name, null),
                    afterLines = Convert(g.afterLines, c.name, null),
                };
                if (c.isHost)
                    data.quest = new QuestData { id = hostQuest, title = g.questTitle, requiredQuests = friendQuests };
                else
                {
                    data.quest = new QuestData { id = $"day{d}_{c.npcId}", title = g.questTitle, type = "quiz", rewardBooks = c.rewardBooks };
                    data.unlockedByQuest = hostQuest;
                    if (!data.lines.Any(l => l.IsQuestion)) log.Add($"Warning: {c.name} {Levels[i]} has no questions.");
                }

                foreach (var set in new[] { data.lines, data.inProgressLines, data.completeLines, data.afterLines })
                    foreach (var l in set)
                        foreach (var w in Highlights(l.text).Concat(Highlights(l.correctText)))
                            highlighted.Add(w);

                string name = Regex.Replace(c.name, @"[^A-Za-z0-9]+", "");
                filePaths[i] = $"{folder}/{name}_Day{d:00}_{Levels[i]}.json";
                File.WriteAllText(filePaths[i], JsonUtility.ToJson(data, true));
            }

            if (gen.definitions != null)
                foreach (var def in gen.definitions)
                    if (!string.IsNullOrWhiteSpace(def.word) && !string.IsNullOrWhiteSpace(def.definition))
                        newDefinitions[def.word.Trim().ToLowerInvariant()] = def.definition.Trim();

            paths.Add((new DailyContent.NpcFiles { npcId = c.npcId }, filePaths));
        }

        AssetDatabase.Refresh();
        foreach (var (files, p) in paths)
        {
            files.ages5to8 = AssetDatabase.LoadAssetAtPath<TextAsset>(p[0]);
            files.ages8to11 = AssetDatabase.LoadAssetAtPath<TextAsset>(p[1]);
            files.ages12to15 = AssetDatabase.LoadAssetAtPath<TextAsset>(p[2]);
            entry.npcs.Add(files);
        }

        Undo.RecordObject(content, "Generate day");
        content.days.RemoveAll(x => x.day == d);
        content.days.Add(entry);
        content.days.Sort((a, b) => a.day.CompareTo(b.day));
        EditorUtility.SetDirty(content);
        AssetDatabase.SaveAssets();

        MergeDefinitions(newDefinitions, highlighted);
    }

    // Generated lines -> the game's DialogueLine, with a little tidying.
    DialogueLine[] Convert(GenLine[] lines, string speaker, string context)
    {
        if (lines == null) return new DialogueLine[0];
        var result = new List<DialogueLine>();
        foreach (var g in lines)
        {
            if (string.IsNullOrWhiteSpace(g.text)) continue;
            var line = new DialogueLine { speaker = speaker, text = g.text.Trim() };
            var choices = g.choices?.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()).ToArray();
            if (choices != null && choices.Length >= 2)
            {
                line.choices = choices;
                line.correctIndex = g.correctIndex;
                line.hint = g.hint;
                line.correctText = g.correctText;
                if (g.correctIndex < 0 || g.correctIndex >= choices.Length)
                {
                    log.Add($"Warning: {context}: a question's answer number was out of range, so it was set to the first choice. Check: \"{line.text}\"");
                    line.correctIndex = 0;
                }
            }
            result.Add(line);
        }
        return result.ToArray();
    }

    static readonly Regex Highlight = new(@"<color=red>(.+?)</color>", RegexOptions.IgnoreCase);

    static IEnumerable<string> Highlights(string text)
    {
        if (string.IsNullOrEmpty(text)) yield break;
        foreach (Match m in Highlight.Matches(text))
        {
            string w = Regex.Replace(m.Groups[1].Value, "<[^>]+>", "").Trim().ToLowerInvariant();
            if (w.Any(char.IsLetter)) yield return w;
        }
    }

    // Adds definitions for words the glossary doesn't know yet. Existing definitions are never changed.
    void MergeDefinitions(Dictionary<string, string> fresh, HashSet<string> highlighted)
    {
        var file = File.Exists(DefinitionsPath)
            ? JsonUtility.FromJson<DefinitionList>(File.ReadAllText(DefinitionsPath)) ?? new DefinitionList()
            : new DefinitionList();
        var known = new HashSet<string>(file.definitions.Select(x => x.word.ToLowerInvariant()));

        int added = 0;
        foreach (var kv in fresh)
        {
            if (known.Contains(kv.Key)) continue;
            file.definitions.Add(new GenDefinition { word = kv.Key, definition = kv.Value });
            known.Add(kv.Key);
            added++;
        }
        file.definitions.Sort((a, b) => string.Compare(a.word, b.word, StringComparison.OrdinalIgnoreCase));
        File.WriteAllText(DefinitionsPath, JsonUtility.ToJson(file, true));
        AssetDatabase.ImportAsset(DefinitionsPath);

        var missing = highlighted.Where(w => !known.Contains(w)).OrderBy(w => w).ToList();
        log.Add($"Glossary: {added} new definitions added.");
        if (missing.Count > 0) log.Add("Warning: no definition for: " + string.Join(", ", missing) + ". Add them to GlossaryDefinitions.json.");
    }

    // JSON string literal.
    static string Q(string s)
    {
        var sb = new StringBuilder(s.Length + 2);
        sb.Append('"');
        foreach (char ch in s)
        {
            switch (ch)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (ch < 0x20) sb.Append("\\u").Append(((int)ch).ToString("x4"));
                    else sb.Append(ch);
                    break;
            }
        }
        return sb.Append('"').ToString();
    }

    // ---------------------------------------------------------------- JSON shapes

    [Serializable] class ApiResponse { public ApiBlock[] content; public string stop_reason; public ApiUsage usage; public ApiError error; }
    [Serializable] class ApiBlock { public string type; public string text; }
    [Serializable] class ApiUsage { public int input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens; }
    [Serializable] class ApiError { public string type; public string message; }

    [Serializable] class GenLine { public string text; public string[] choices; public int correctIndex; public string hint; public string correctText; }
    [Serializable] class GenDialogue { public string questTitle; public GenLine[] lines, inProgressLines, completeLines, afterLines; }
    [Serializable] class GenLevels { public GenDialogue ages5to8, ages8to11, ages12to15; }
    [Serializable] class GenDefinition { public string word; public string definition; }
    [Serializable] class Generated { public GenLevels levels; public GenDefinition[] definitions; }
    [Serializable] class DefinitionList { public List<GenDefinition> definitions = new(); }
}
