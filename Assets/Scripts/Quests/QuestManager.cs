using System.Collections.Generic;
using UnityEngine;

public enum QuestState { NotStarted, Active, Completed }

/// <summary>
/// Tracks quest state and collected items, and draws a small progress HUD (IMGUI).
/// Created automatically on first use.
/// </summary>
public class QuestManager : MonoBehaviour
{
    static QuestManager instance;

    /// <summary>Raised when a quest is handed in. Listeners (e.g. LibraryManager) can react to it.</summary>
    public static event System.Action<QuestData> QuestCompleted;

    public static QuestManager Instance
    {
        get
        {
            if (instance == null)
            {
                instance = FindAnyObjectByType<QuestManager>();
                if (instance == null)
                    instance = new GameObject("QuestManager").AddComponent<QuestManager>();
            }
            return instance;
        }
    }

    readonly Dictionary<string, QuestState> states = new();
    readonly Dictionary<string, QuestData> activeQuests = new();
    readonly Dictionary<string, int> items = new();
    GUIStyle hudStyle;

    public QuestState GetState(QuestData q) =>
        q != null && states.TryGetValue(q.id, out var s) ? s : QuestState.NotStarted;

    public int GetCount(string itemId) => items.TryGetValue(itemId, out var n) ? n : 0;

    public bool IsReadyToHandIn(QuestData q) =>
        GetState(q) == QuestState.Active && GetCount(q.itemId) >= q.requiredCount;

    public void StartQuest(QuestData q)
    {
        if (q == null || GetState(q) != QuestState.NotStarted) return;
        states[q.id] = QuestState.Active;
        activeQuests[q.id] = q;
    }

    public void CompleteQuest(QuestData q)
    {
        if (!IsReadyToHandIn(q)) return;
        items[q.itemId] = GetCount(q.itemId) - q.requiredCount;
        states[q.id] = QuestState.Completed;
        activeQuests.Remove(q.id);
        QuestCompleted?.Invoke(q);
    }

    /// <summary>Completes a quest that has no items to hand in (e.g. a quiz).</summary>
    public void FinishQuest(QuestData q)
    {
        if (q == null || GetState(q) == QuestState.Completed) return;
        states[q.id] = QuestState.Completed;
        activeQuests.Remove(q.id);
        QuestCompleted?.Invoke(q);
    }

    public void AddItem(string itemId, int amount = 1)
    {
        items[itemId] = GetCount(itemId) + amount;
    }

    void OnGUI()
    {
        if (activeQuests.Count == 0) return;
        float s = Mathf.Max(1f, Screen.height / 720f);
        hudStyle ??= new GUIStyle(GUI.skin.label) { fontStyle = FontStyle.Bold, normal = { textColor = Color.white } };
        hudStyle.fontSize = Mathf.RoundToInt(20 * s);

        float y = 12f * s;
        foreach (var q in activeQuests.Values)
        {
            int have = Mathf.Min(GetCount(q.itemId), q.requiredCount);
            string text = have >= q.requiredCount
                ? $"{q.title}: done - go back and tell them!"
                : $"{q.title}: {have}/{q.requiredCount}";
            // simple shadow for readability
            hudStyle.normal.textColor = Color.black;
            GUI.Label(new Rect(14f * s + 1, y + 1, Screen.width, 30f * s), text, hudStyle);
            hudStyle.normal.textColor = have >= q.requiredCount ? new Color(0.6f, 1f, 0.6f) : Color.white;
            GUI.Label(new Rect(14f * s, y, Screen.width, 30f * s), text, hudStyle);
            y += 30f * s;
        }
    }
}
