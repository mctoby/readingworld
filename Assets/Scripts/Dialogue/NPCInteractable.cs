using UnityEngine;

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

    [Header("Locked until")]
    [Tooltip("Id of a quest that must be started (or finished) before this NPC will talk, e.g. the Librarian's \"library_help\". Leave empty to be talkable from the start.")]
    [SerializeField] string unlockedByQuest = "";
    [Tooltip("Speech-bubble icon hidden while this NPC is locked. If empty, a child named 'ChatIcon' is used.")]
    [SerializeField] GameObject talkIcon;

    [SerializeField] float interactRange = 2f;
    [SerializeField] string playerTag = "Player";

    readonly DialogueData[] cache = new DialogueData[3];
    Transform player;
    bool talking;
    System.Action onTalkFinished;

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

    // False until the quest named in 'unlockedByQuest' has been started. Once unlocked, stays unlocked.
    bool unlocked;
    bool Unlocked
    {
        get
        {
            if (!unlocked)
                unlocked = string.IsNullOrEmpty(unlockedByQuest)
                    || QuestManager.Instance.GetState(unlockedByQuest) != QuestState.NotStarted;
            return unlocked;
        }
    }

    void Awake()
    {
        if (!HasDialogue)
            Debug.LogWarning($"{name}: no dialogue JSON assigned.", this);

        baseScale = transform.localScale;
        if (dialogueCamera != null) dialogueCamera.SetActive(false);

        if (talkIcon == null)
        {
            var icon = transform.Find("ChatIcon");
            if (icon != null) talkIcon = icon.gameObject;
        }
    }

    void Start()
    {
        var p = GameObject.FindGameObjectWithTag(playerTag);
        if (p != null) player = p.transform;
        if (talkIcon != null) talkIcon.SetActive(Unlocked);
    }

    bool PlayerInRange =>
        player != null && Vector3.Distance(player.position, transform.position) <= interactRange;

    public float DistanceToPlayer =>
        player != null ? Vector3.Distance(player.position, transform.position) : float.MaxValue;

    bool reportedInRange;
    Vector3 baseScale = Vector3.one;
    Coroutine hop;

    // Tells the Talk prompt whether the player can talk to this NPC right now.
    void Update()
    {
        // Juice: turn to face the player while talking.
        if (talking && player != null)
        {
            Vector3 d = player.position - transform.position;
            d.y = 0f;
            if (d.sqrMagnitude > 0.01f)
                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(d),
                    1f - Mathf.Exp(-8f * Time.deltaTime));
        }

        // The speech bubble appears the moment this NPC becomes talkable.
        bool open = Unlocked;
        if (talkIcon != null && talkIcon.activeSelf != open) talkIcon.SetActive(open);

        bool canTalk = !talking && open && HasDialogue && PlayerInRange;
        if (canTalk == reportedInRange) return;
        reportedInRange = canTalk;
        InteractionPrompt.Instance?.SetInRange(this, canTalk);

        // Juice: a little hop of excitement when the player walks up.
        if (canTalk)
        {
            if (hop != null) StopCoroutine(hop);
            hop = StartCoroutine(Hop());
        }
    }

    // Squash and stretch: a quick "hello!" bounce.
    System.Collections.IEnumerator Hop()
    {
        const float time = 0.45f;
        for (float t = 0f; t < time; t += Time.deltaTime)
        {
            float k = t / time;
            float wave = Mathf.Sin(k * Mathf.PI * 2f) * (1f - k);
            transform.localScale = new Vector3(baseScale.x * (1f - 0.08f * wave), baseScale.y * (1f + 0.12f * wave), baseScale.z * (1f - 0.08f * wave));
            yield return null;
        }
        transform.localScale = baseScale;
        hop = null;
    }

    void OnDisable()
    {
        if (reportedInRange) InteractionPrompt.Instance?.SetInRange(this, false);
        reportedInRange = false;
    }

    /// <summary>Starts the conversation. Called by the Talk prompt (E key or button).</summary>
    public void Interact()
    {
        if (!talking && Unlocked && HasDialogue && PlayerInRange) BeginTalk();
    }

    void BeginTalk()
    {
        var data = Data;
        if (data == null) return;

        talking = true;
        if (dialogueCamera != null) dialogueCamera.SetActive(true);

        // Freeze the player and hide the touch controls so they don't sit over the dialogue box.
        PlayerControlLock.Lock();
        PlayerControlLock.SetPlayerVisible(false);

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
        PlayerControlLock.SetPlayerVisible(true);
        PlayerControlLock.Unlock();
        // Swallow the closing press so it can't instantly retrigger the conversation.
        Invoke(nameof(ResetTalking), 0.2f);
    }

    void ResetTalking() => talking = false;

    void OnDrawGizmosSelected()
    {
        Gizmos.color = Color.yellow;
        Gizmos.DrawWireSphere(transform.position, interactRange);
    }
}
