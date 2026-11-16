using System;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Conversations for each day of play after the first. Day 1 is the hand-written dialogue assigned on each NPC
/// in the scene; days 2+ are made with Tools > Reading World > Daily Content Generator and listed here.
/// Lives at Assets/Resources/DailyContent.asset so the game can find it in a build.
/// </summary>
[CreateAssetMenu(menuName = "Reading World/Daily Content", fileName = "DailyContent")]
public class DailyContent : ScriptableObject
{
    [Serializable]
    public class Character
    {
        [Tooltip("Matches the NPC Id set on the NPC's NPCInteractable, e.g. \"tilly\".")]
        public string npcId;
        public string name;
        [Tooltip("The NPC who starts each day and unlocks everyone else (the Librarian).")]
        public bool isHost;
        [TextArea(2, 5)] public string personality;
        [Tooltip("What this character's mission is each day. Ignored for the host.")]
        [TextArea(2, 5)] public string mission;
        [Tooltip("Books added to the library when this character's mission is done.")]
        public int rewardBooks = 3;
    }

    [Serializable]
    public class NpcFiles
    {
        public string npcId;
        public TextAsset ages5to8;
        public TextAsset ages8to11;
        public TextAsset ages12to15;

        public TextAsset[] All => new[] { ages5to8, ages8to11, ages12to15 };
    }

    [Serializable]
    public class Day
    {
        public int day;
        public string topic;
        [Tooltip("Untick to keep this day out of the game without deleting it.")]
        public bool live = true;
        public List<NpcFiles> npcs = new();
    }

    [Tooltip("Who the generator writes for, and what each of them does.")]
    public List<Character> characters = new();

    public List<Day> days = new();

    [Tooltip("Editor only: which day Play mode uses. 0 = count real days of play like a build does.")]
    public int editorPlayDay = 1;

    static DailyContent instance;

    public static DailyContent Instance
    {
        get
        {
            if (instance == null) instance = Resources.Load<DailyContent>("DailyContent");
            return instance;
        }
    }

    /// <summary>
    /// The conversation files for this NPC today, or null to use the NPC's own (day 1) files.
    /// A day with no content of its own repeats the latest day before it.
    /// </summary>
    public static TextAsset[] FilesFor(string npcId)
    {
        var content = Instance;
        if (content == null || string.IsNullOrEmpty(npcId)) return null;

        Day best = null;
        int today = GameDay.Current;
        foreach (var d in content.days)
            if (d.live && d.day >= 2 && d.day <= today && (best == null || d.day > best.day))
                best = d;
        if (best == null) return null;

        foreach (var n in best.npcs)
            if (n.npcId == npcId) return n.All;
        return null;
    }
}

/// <summary>
/// Which day of play this is: 1 on the first date the game is played, 2 on the next date it is played, and so on
/// (days without play don't count). Stored in PlayerPrefs.
/// </summary>
public static class GameDay
{
    const string LastDateKey = "GameDay.LastDate";
    const string CountKey = "GameDay.Count";

    static int current;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
    static void ResetState() => current = 0;

    public static int Current
    {
        get
        {
            if (current > 0) return current;
#if UNITY_EDITOR
            var content = DailyContent.Instance;
            if (content != null && content.editorPlayDay > 0) return current = content.editorPlayDay;
#endif
            string today = DateTime.Now.ToString("yyyy-MM-dd");
            int count = PlayerPrefs.GetInt(CountKey, 0);
            if (PlayerPrefs.GetString(LastDateKey, "") != today)
            {
                count++;
                PlayerPrefs.SetString(LastDateKey, today);
                PlayerPrefs.SetInt(CountKey, count);
                PlayerPrefs.Save();
            }
            return current = Mathf.Max(1, count);
        }
    }
}
