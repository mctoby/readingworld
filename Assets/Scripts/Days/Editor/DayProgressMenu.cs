using UnityEditor;
using UnityEngine;

/// <summary>Editor shortcuts for testing day progress.</summary>
static class DayProgressMenu
{
    [MenuItem("Tools/Reading World/Reset Day Progress")]
    static void ResetProgress()
    {
        GameDay.ResetProgress();
        Debug.Log("Day progress reset: the next Play starts on day 1.");
    }

    [MenuItem("Tools/Reading World/Log Day Progress")]
    static void LogProgress() =>
        Debug.Log($"Days completed: {GameDay.Completed}. The next Play starts on day {GameDay.Completed + 1} if it exists, otherwise the latest day that does.");
}
