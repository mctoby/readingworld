using System.Collections.Generic;
using System.Text;
using TMPro;
using UnityEngine;

public enum QuestState { NotStarted, Active, Completed }

/// <summary>
/// Tracks quest state and collected items, and shows a small progress HUD on the game's Canvas
/// (see the GameUI prefab). Works without a HUD too, if none is assigned.
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

    [Header("HUD (optional)")]
    [Tooltip("Parent of the HUD text. Shown only while a quest is active.")]
    [SerializeField] GameObject hudRoot;
    [SerializeField] TMP_Text hudText;

    readonly Dictionary<string, QuestState> states = new();
    readonly Dictionary<string, QuestData> activeQuests = new();
    readonly Dictionary<string, int> items = new();
    readonly StringBuilder sb = new();

    void Awake()
    {
        instance = this;
        RefreshHud();
    }

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
        RefreshHud();
    }

    public void CompleteQuest(QuestData q)
    {
        if (!IsReadyToHandIn(q)) return;
        items[q.itemId] = GetCount(q.itemId) - q.requiredCount;
        states[q.id] = QuestState.Completed;
        activeQuests.Remove(q.id);
        RefreshHud();
        QuestCompleted?.Invoke(q);
    }

    /// <summary>Completes a quest that has no items to hand in (e.g. a quiz).</summary>
    public void FinishQuest(QuestData q)
    {
        if (q == null || GetState(q) == QuestState.Completed) return;
        states[q.id] = QuestState.Completed;
        activeQuests.Remove(q.id);
        RefreshHud();
        QuestCompleted?.Invoke(q);
    }

    public void AddItem(string itemId, int amount = 1)
    {
        items[itemId] = GetCount(itemId) + amount;
        RefreshHud();
    }

    void RefreshHud()
    {
        if (hudRoot != null) hudRoot.SetActive(activeQuests.Count > 0);
        if (hudText == null) return;

        sb.Clear();
        foreach (var q in activeQuests.Values)
        {
            int have = Mathf.Min(GetCount(q.itemId), q.requiredCount);
            if (sb.Length > 0) sb.Append('\n');
            if (have >= q.requiredCount)
                sb.Append($"<color=#99FF99>{q.title}: done - go back and tell them!</color>");
            else
                sb.Append($"{q.title}: {have}/{q.requiredCount}");
        }
        // Bump the HUD whenever its text changes (a book collected, a quest ready to hand in).
        string text = sb.ToString();
        bool changed = hudText.text != text && !string.IsNullOrEmpty(hudText.text);
        hudText.text = text;
        if (changed && hudRoot != null && hudRoot.activeInHierarchy)
            hudRoot.GetComponent<PopIn>()?.Punch(0.12f);
    }
}
