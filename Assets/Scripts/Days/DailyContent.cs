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

        [Tooltip("Quiz: the mission is questions inside the conversation.\nCollect: the reader finds items in the world (the NPC's Quest Objects) and brings them back.")]
        public MissionType missionType = MissionType.Quiz;
        [Tooltip("Collect missions: the Item Id of the Collectables to find, e.g. \"book\".")]
        public string itemId = "book";
        [Tooltip("Collect missions: how many to find. Should match the number of Quest Objects on the NPC in the scene.")]
        public int itemCount = 3;
    }

    public enum MissionType { Quiz, Collect }

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

    [Tooltip("Editor only: force Play mode to use this day. 0 = use the saved progress, like a build does.")]
    public int editorPlayDay = 0;

    static DailyContent instance;

    public static DailyContent Instance
    {
        get
        {
            if (instance == null) instance = Resources.Load<DailyContent>("DailyContent");
            return instance;
        }
    }

    /// <summary>The latest live generated day that is no later than 'target', or 1 (the hand-written day) if there is none.</summary>
    public int LatestDayUpTo(int target)
    {
        int best = 1;
        foreach (var d in days)
            if (d.live && d.day >= 2 && d.day <= target && d.day > best) best = d.day;
        return best;
    }

    /// <summary>Every day that can be played, in order: day 1 (hand-written) and each live generated day.</summary>
    public List<int> PlayableDays()
    {
        var list = new List<int> { 1 };
        foreach (var d in days)
            if (d.live && d.day >= 2 && !list.Contains(d.day)) list.Add(d.day);
        list.Sort();
        return list;
    }

    /// <summary>The topic of a generated day, or null.</summary>
    public string TopicFor(int day)
    {
        foreach (var d in days)
            if (d.day == day) return d.topic;
        return null;
    }

    /// <summary>The conversation files for this NPC today, or null to use the NPC's own (day 1) files.</summary>
    public static TextAsset[] FilesFor(string npcId)
    {
        var content = Instance;
        if (content == null || string.IsNullOrEmpty(npcId)) return null;

        int today = GameDay.Current;
        if (today < 2) return null;
        foreach (var d in content.days)
        {
            if (d.day != today || !d.live) continue;
            foreach (var n in d.npcs)
                if (n.npcId == npcId) return n.All;
        }
        return null;
    }
}

/// <summary>
/// Which day the game is on. A day is finished by handing in to the host (Mr. Page) after every mission; that is
/// saved, and the next time the game starts it moves on to the next day. If that day hasn't been made yet, the
/// latest day that exists is played again. Progress is stored in PlayerPrefs.
/// </summary>
public static class GameDay
{
    const string CompletedKey = "GameDay.Completed";

    static int current;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
    static void ResetState() => current = 0;

    /// <summary>The highest day the player has finished (0 = none yet).</summary>
    public static int Completed => PlayerPrefs.GetInt(CompletedKey, 0);

    /// <summary>The day being played this session. Fixed when first asked, so it doesn't change mid-session.</summary>
    public static int Current
    {
        get
        {
            if (current > 0) return current;
            var content = DailyContent.Instance;
#if UNITY_EDITOR
            if (content != null && content.editorPlayDay > 0) return current = content.editorPlayDay;
#endif
            int next = Completed + 1;
            return current = content != null ? content.LatestDayUpTo(next) : 1;
        }
    }

    /// <summary>Raised when the day being played is switched (by the start-of-day popup).</summary>
    public static event Action Changed;

    /// <summary>Plays 'day' this session instead. NPCs reload their conversations for it.</summary>
    public static void Choose(int day)
    {
        if (day < 1 || day == Current) return;
        current = day;
        Changed?.Invoke();
    }

    /// <summary>Records that 'day' has been finished. Never moves progress backwards.</summary>
    public static void MarkComplete(int day)
    {
        if (day <= Completed) return;
        PlayerPrefs.SetInt(CompletedKey, day);
        PlayerPrefs.Save();
    }

    /// <summary>Forgets all progress: the next start is day 1 again.</summary>
    public static void ResetProgress()
    {
        PlayerPrefs.DeleteKey(CompletedKey);
        PlayerPrefs.Save();
        current = 0;
    }
}
