using UnityEngine;
using UnityEngine.InputSystem;

/// <summary>
/// Put on an NPC. When the player is within range and presses E (or taps the on-screen Talk button),
/// the NPC's JSON conversation starts, the NPC's dialogue camera is enabled, the touchscreen controls
/// are hidden and the player is frozen until the conversation ends.
/// The conversation file used depends on the reader's chosen <see cref="ReadingSettings.Level"/>.
/// </summary>
public class NPCInteractable : MonoBehaviour
{
    [Header("Conversation (one JSON per reading level)")]
    [Tooltip("Ages 5-8 (the default level). Highlight key words with <color=red>word</color>.")]
    [SerializeField] TextAsset dialogueAges5to8;
    [Tooltip("Ages 8-11.")]
    [SerializeField] TextAsset dialogueAges8to11;
    [Tooltip("Ages 12-15.")]
    [SerializeField] TextAsset dialogueAges12to15;

    [Header("Scene")]
    [Tooltip("Inactive child Cinemachine camera, enabled while talking.")]
    [SerializeField] GameObject dialogueCamera;

    [Tooltip("Objects (e.g. collectable books) that start inactive and are enabled when this NPC's quest is accepted.")]
    [SerializeField] GameObject[] questObjects;

    [SerializeField] float interactRange = 2f;
    [SerializeField] string playerTag = "Player";

    readonly DialogueData[] cache = new DialogueData[3];
    Transform player;
    bool talking;
    System.Action onTalkFinished;
    GUIStyle buttonStyle;

    // The conversation for the current reading level. If that level has no file, the nearest level that does is used.
    DialogueData Data
    {
        get
        {
            int level = (int)ReadingSettings.Level;
            if (cache[level] != null) return cache[level];

            var assets = new[] { dialogueAges5to8, dialogueAges8to11, dialogueAges12to15 };
            for (int d = 0; d < 3; d++)
            {
                foreach (int i in new[] { level - d, level + d })
                {
                    if (i < 0 || i > 2 || assets[i] == null) continue;
                    cache[level] = JsonUtility.FromJson<DialogueData>(assets[i].text);
                    return cache[level];
                }
            }
            return null;
        }
    }

    bool HasDialogue => dialogueAges5to8 != null || dialogueAges8to11 != null || dialogueAges12to15 != null;

    void Awake()
    {
        if (!HasDialogue)
            Debug.LogWarning($"{name}: no dialogue JSON assigned.", this);

        if (dialogueCamera != null) dialogueCamera.SetActive(false);
    }

    void Start()
    {
        var p = GameObject.FindGameObjectWithTag(playerTag);
        if (p != null) player = p.transform;
    }

    bool PlayerInRange =>
        player != null && Vector3.Distance(player.position, transform.position) <= interactRange;

    void Update()
    {
        if (talking || !HasDialogue || !PlayerInRange) return;

        var kb = Keyboard.current;
        if (kb != null && kb.eKey.wasPressedThisFrame)
            BeginTalk();
    }

    void BeginTalk()
    {
        var data = Data;
        if (data == null) return;

        talking = true;
        if (dialogueCamera != null) dialogueCamera.SetActive(true);

        // Freeze the player and hide the touch controls so they don't sit over the dialogue box.
        PlayerControlLock.Lock();

        var lines = PickLines(data, out onTalkFinished);
        var convo = new DialogueData { npcName = data.npcName, lines = lines };
        DialogueManager.Instance.StartDialogue(convo, EndTalk);
    }

    // Chooses what the NPC says based on quest progress, and what should happen when it ends.
    DialogueLine[] PickLines(DialogueData data, out System.Action onFinished)
    {
        onFinished = null;
        var quest = data.quest;
        if (quest == null || string.IsNullOrEmpty(quest.id))
            return data.lines;

        var qm = QuestManager.Instance;

        // Quiz quests: the conversation is the quest. Reaching the end means every question was answered.
        if (quest.IsQuiz)
        {
            if (qm.GetState(quest) == QuestState.Completed)
                return OrDefault(data, data.afterLines);
            onFinished = () => qm.FinishQuest(quest);
            return data.lines;
        }

        switch (qm.GetState(quest))
        {
            case QuestState.NotStarted:
                onFinished = () =>
                {
                    qm.StartQuest(quest);
                    if (questObjects != null)
                        foreach (var o in questObjects) if (o != null) o.SetActive(true);
                };
                return data.lines;

            case QuestState.Active:
                if (qm.IsReadyToHandIn(quest))
                {
                    onFinished = () => qm.CompleteQuest(quest);
                    return OrDefault(data, data.completeLines);
                }
                return OrDefault(data, data.inProgressLines);

            default: // Completed
                return OrDefault(data, data.afterLines);
        }
    }

    static DialogueLine[] OrDefault(DialogueData data, DialogueLine[] lines) =>
        lines != null && lines.Length > 0 ? lines : data.lines;

    void EndTalk()
    {
        var cb = onTalkFinished;
        onTalkFinished = null;
        cb?.Invoke();

        if (dialogueCamera != null) dialogueCamera.SetActive(false);
        PlayerControlLock.Unlock();
        // Swallow the closing press so it can't instantly retrigger the conversation.
        Invoke(nameof(ResetTalking), 0.2f);
    }

    void ResetTalking() => talking = false;

    void OnGUI()
    {
        if (talking || !HasDialogue || !PlayerInRange) return;

        float s = DialogueManager.UIScale;
        buttonStyle ??= new GUIStyle(GUI.skin.button);
        buttonStyle.fontSize = Mathf.RoundToInt(24 * s);

        // Tappable Talk button (works with mouse and touch); E also works on keyboard.
        float w = 220f * s, h = 64f * s;
        var rect = new Rect((Screen.width - w) / 2f, Screen.height * 0.6f, w, h);
        if (GUI.Button(rect, "Talk  [E]", buttonStyle))
            BeginTalk();
    }

    void OnDrawGizmosSelected()
    {
        Gizmos.color = Color.yellow;
        Gizmos.DrawWireSphere(transform.position, interactRange);
    }
}
