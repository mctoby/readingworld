using System;

[Serializable]
public class DialogueLine
{
    public string speaker;
    public string text;

    // Optional: make this line a multiple-choice question. The conversation only moves on once the
    // reader picks the right answer.
    public string[] choices;      // answer options
    public int correctIndex;      // index into choices of the right answer (0 = first)
    public string hint;           // shown after a wrong pick, e.g. "Not quite. Think about the story!"
    public string correctText;    // optional praise shown after the right pick, e.g. "Yes! Well done."

    public bool IsQuestion => choices != null && choices.Length > 0;
}

/// <summary>Optional quest an NPC can give. Leave out of the JSON for NPCs that only chat.</summary>
[Serializable]
public class QuestData
{
    public string id;            // unique quest id, e.g. "lost_books"
    public string title;         // shown in the HUD, e.g. "Find the lost books"
    public string itemId;        // Collectable.itemId that counts toward this quest
    public int requiredCount;    // how many items are needed

    // "collect" (default): gather requiredCount items, then hand in.
    // "quiz": the quest is the conversation itself - answer every question in "lines" correctly.
    public string type;
    public int rewardBooks;      // books added to the library on completion (0 = use requiredCount)

    // Optional: ids of other quests that must all be completed before this one can be handed in
    // (e.g. the Librarian's quest is "finish everyone else's quest"). Used instead of itemId / requiredCount.
    public string[] requiredQuests;

    public bool IsQuiz => type == "quiz";
    public bool NeedsOtherQuests => requiredQuests != null && requiredQuests.Length > 0;
    public int RewardBooks => rewardBooks > 0 ? rewardBooks : requiredCount;
}

[Serializable]
public class DialogueData
{
    public string npcName;
    public QuestData quest;                 // optional

    public DialogueLine[] lines;            // first meeting / quest offer
    public DialogueLine[] inProgressLines;  // quest accepted, not finished yet
    public DialogueLine[] completeLines;    // items collected, quest handed in
    public DialogueLine[] afterLines;       // quest already done
}
