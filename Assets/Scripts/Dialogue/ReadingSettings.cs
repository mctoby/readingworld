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
