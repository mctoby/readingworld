using UnityEngine;

public enum ReadingLevel
{
    Ages5to8 = 0,
    Ages8to11 = 1,
    Ages12to15 = 2
}

/// <summary>
/// The reader's chosen reading level. Defaults to the lowest (ages 5-8) and is remembered between sessions.
/// Change it from anywhere with <c>ReadingSettings.Level = ReadingLevel.Ages8to11;</c>
/// </summary>
public static class ReadingSettings
{
    const string Key = "ReadingLevel";

    /// <summary>Maps an age to its reading group: 5-8, 9-11 and 12+ (the groups overlap at 8 and 11, so the younger group claims them).</summary>
    public static ReadingLevel LevelForAge(int age) =>
        age <= 8 ? ReadingLevel.Ages5to8 : age <= 11 ? ReadingLevel.Ages8to11 : ReadingLevel.Ages12to15;

    public static ReadingLevel Level
    {
        get => (ReadingLevel)Mathf.Clamp(PlayerPrefs.GetInt(Key, (int)ReadingLevel.Ages5to8), 0, 2);
        set
        {
            PlayerPrefs.SetInt(Key, (int)value);
            PlayerPrefs.Save();
        }
    }
}
