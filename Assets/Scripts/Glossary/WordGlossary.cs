using System.Collections;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using TMPro;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;

/// <summary>
/// Collects the highlighted (red) words the reader meets in conversations and shows them in a glossary.
/// The DialogueManager hands every line it shows to <see cref="CollectFrom"/>; any word wrapped in
/// &lt;color=red&gt;...&lt;/color&gt; that hasn't been seen before is added, and a small "New word" popup appears.
/// Each word is shown with its meaning from the Definitions file (Assets/Dialogue/GlossaryDefinitions.json).
/// All the UI lives under the Glossary object on the game's Canvas, so it can be restyled freely -
/// this script only needs the references below to stay assigned.
/// </summary>
public class WordGlossary : MonoBehaviour
{
    static WordGlossary instance;

    public static WordGlossary Instance
    {
        get
        {
            if (instance == null) instance = FindAnyObjectByType<WordGlossary>(FindObjectsInactive.Include);
            return instance;
        }
    }

    [System.Serializable]
    public class Entry
    {
        public string word;       // as shown, e.g. "Lighthouse"
        public string sentence;   // the line it was found in, without colour tags
        public string speaker;    // who said it
    }

    [System.Serializable]
    class SaveData { public List<Entry> entries = new(); }

    [System.Serializable]
    class Definition { public string word; public string definition; }

    [System.Serializable]
    class DefinitionList { public List<Definition> definitions = new(); }

    [Header("Definitions")]
    [Tooltip("JSON list of { \"word\", \"definition\" } pairs. A word without one shows the sentence it was found in instead.")]
    [SerializeField] TextAsset definitionsFile;

    [Header("Open button")]
    [Tooltip("Opens the glossary. Hidden until the first word has been collected.")]
    [SerializeField] Button openButton;
    [SerializeField] TMP_Text openButtonLabel;
    [Tooltip("{0} is the number of words collected.")]
    [SerializeField] string openButtonFormat = "Words: {0}";
    [Tooltip("Keyboard shortcut that opens and closes the glossary.")]
    [SerializeField] Key toggleKey = Key.G;

    [Header("Glossary panel")]
    [Tooltip("The whole glossary window. Starts hidden.")]
    [SerializeField] GameObject panel;
    [SerializeField] Button closeButton;
    [Tooltip("Optional. {0} is the number of words collected.")]
    [SerializeField] TMP_Text countText;
    [SerializeField] string countFormat = "{0} words collected";
    [Tooltip("Parent that the word rows are added to (the scroll view's Content).")]
    [SerializeField] Transform entryContainer;
    [Tooltip("One row of the list. Kept inactive and copied once per word - restyle this to restyle every row.")]
    [SerializeField] GlossaryEntry entryTemplate;

    [Header("New word popup")]
    [Tooltip("Shown for a moment whenever a new word is collected. Starts hidden.")]
    [SerializeField] GameObject popup;
    [SerializeField] TMP_Text popupText;
    [Tooltip("{0} is the new word.")]
    [SerializeField] string popupFormat = "New word: <color=#D93025>{0}</color>";
    [SerializeField] float popupTime = 2f;

    [Header("Options")]
    [Tooltip("Keep collected words when the game is closed and opened again.")]
    [SerializeField] bool rememberBetweenSessions = false;

    const string SaveKey = "GlossaryWords";
    static readonly Regex Highlight = new Regex(@"<color=red>(.+?)</color>", RegexOptions.IgnoreCase);
    static readonly Regex AnyTag = new Regex(@"<[^>]+>");

    readonly Dictionary<string, Entry> entries = new();   // key: the word in lower case
    readonly Dictionary<string, string> definitions = new();
    readonly List<GlossaryEntry> rows = new();
    readonly Queue<string> popupQueue = new();
    Coroutine popupRoutine;
    bool open;

    public int Count => entries.Count;
    public bool IsOpen => open;

    void Awake()
    {
        instance = this;
        if (openButton != null) openButton.onClick.AddListener(Open);
        if (closeButton != null) closeButton.onClick.AddListener(Close);
        if (panel != null) panel.SetActive(false);
        if (popup != null) popup.SetActive(false);
        if (entryTemplate != null) entryTemplate.gameObject.SetActive(false);
        LoadDefinitions();

        if (rememberBetweenSessions && PlayerPrefs.HasKey(SaveKey))
        {
            var saved = JsonUtility.FromJson<SaveData>(PlayerPrefs.GetString(SaveKey));
            if (saved != null)
                foreach (var e in saved.entries) entries[e.word.ToLowerInvariant()] = e;
        }
        RefreshButton(false);
    }

    void Update()
    {
        bool talking = DialogueManager.Instance != null && DialogueManager.Instance.IsActive;
        if (openButton != null) openButton.interactable = !talking;

        var kb = Keyboard.current;
        if (kb == null || !kb[toggleKey].wasPressedThisFrame) return;
        if (open) Close();
        else if (!talking && Count > 0) Open();
    }

    /// <summary>Adds every highlighted word in 'richText' that hasn't been collected yet.</summary>
    public void CollectFrom(string richText, string speaker = null)
    {
        if (string.IsNullOrEmpty(richText)) return;

        bool added = false;
        foreach (Match m in Highlight.Matches(richText))
        {
            string word = AnyTag.Replace(m.Groups[1].Value, "").Trim();
            if (!HasLetter(word)) continue;   // e.g. the "_____" gap in a missing-word question

            string key = word.ToLowerInvariant();
            if (entries.ContainsKey(key)) continue;

            string shown = char.ToUpperInvariant(key[0]) + key.Substring(1);
            entries[key] = new Entry { word = shown, sentence = AnyTag.Replace(richText, "").Trim(), speaker = speaker };
#if UNITY_EDITOR
            if (GetDefinition(key) == null)
                Debug.LogWarning($"Glossary: no definition for \"{key}\". Add it to {(definitionsFile != null ? definitionsFile.name : "the definitions file")}.", this);
#endif
            popupQueue.Enqueue(shown);
            added = true;
        }
        if (!added) return;

        Save();
        RefreshButton(true);
        if (open) Rebuild();
        if (popupRoutine == null && popup != null && isActiveAndEnabled) popupRoutine = StartCoroutine(ShowPopups());
    }

    /// <summary>The meaning of a word, or null if the definitions file doesn't have it.</summary>
    public string GetDefinition(string word) =>
        !string.IsNullOrEmpty(word) && definitions.TryGetValue(word.ToLowerInvariant(), out var d) ? d : null;

    void LoadDefinitions()
    {
        definitions.Clear();
        if (definitionsFile == null) return;
        var list = JsonUtility.FromJson<DefinitionList>(definitionsFile.text);
        if (list?.definitions == null) return;
        foreach (var d in list.definitions)
            if (!string.IsNullOrEmpty(d.word) && !string.IsNullOrEmpty(d.definition))
                definitions[d.word.Trim().ToLowerInvariant()] = d.definition.Trim();
    }

    static bool HasLetter(string s)
    {
        foreach (char c in s) if (char.IsLetter(c)) return true;
        return false;
    }

    public void Open()
    {
        if (open || panel == null) return;
        open = true;
        Rebuild();
        Show(panel);
        PlayerControlLock.Lock();   // freeze the player and free the mouse while reading
    }

    public void Close()
    {
        if (!open) return;
        open = false;
        Hide(panel);
        PlayerControlLock.Unlock();
    }

    void OnDisable()
    {
        popupRoutine = null;
        if (open)
        {
            open = false;
            PlayerControlLock.Unlock();
        }
    }

    // Fills the list: one copy of the template per word, in alphabetical order.
    void Rebuild()
    {
        if (entryTemplate == null || entryContainer == null) return;

        var sorted = new List<Entry>(entries.Values);
        sorted.Sort((a, b) => string.Compare(a.word, b.word, System.StringComparison.OrdinalIgnoreCase));

        while (rows.Count < sorted.Count)
            rows.Add(Instantiate(entryTemplate, entryContainer));

        for (int i = 0; i < rows.Count; i++)
        {
            bool used = i < sorted.Count;
            rows[i].gameObject.SetActive(used);
            if (used) rows[i].Set(sorted[i], GetDefinition(sorted[i].word));
        }

        if (countText != null) countText.text = string.Format(countFormat, Count);
    }

    void RefreshButton(bool bump)
    {
        if (openButtonLabel != null) openButtonLabel.text = string.Format(openButtonFormat, Count);
        if (openButton == null) return;

        bool wasShown = openButton.gameObject.activeSelf;
        openButton.gameObject.SetActive(Count > 0);
        if (bump && wasShown) openButton.GetComponent<JuiceButton>()?.Punch(10f);
    }

    // One popup per new word, one after another.
    IEnumerator ShowPopups()
    {
        while (popupQueue.Count > 0)
        {
            if (popupText != null) popupText.text = string.Format(popupFormat, popupQueue.Dequeue());
            Show(popup);
            yield return new WaitForSecondsRealtime(popupTime);
            Hide(popup);
            yield return new WaitForSecondsRealtime(0.25f);
        }
        popupRoutine = null;
    }

    static void Show(GameObject go)
    {
        var pop = go.GetComponent<PopIn>();
        if (pop != null) pop.Show(); else go.SetActive(true);
    }

    static void Hide(GameObject go)
    {
        var pop = go.GetComponent<PopIn>();
        if (pop != null) pop.Hide(); else go.SetActive(false);
    }

    void Save()
    {
        if (!rememberBetweenSessions) return;
        var data = new SaveData();
        data.entries.AddRange(entries.Values);
        PlayerPrefs.SetString(SaveKey, JsonUtility.ToJson(data));
        PlayerPrefs.Save();
    }
}
