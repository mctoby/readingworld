using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;

/// <summary>
/// Runs one conversation at a time and drives the dialogue panel on the game's Canvas (see the GameUI prefab).
/// Advance with E / Space / Enter, or click / tap the panel. Lines that are multiple-choice questions
/// show answer buttons (tap, click, or press 1-9) and only continue after the right answer.
/// </summary>
public class DialogueManager : MonoBehaviour
{
    static DialogueManager instance;

    public static DialogueManager Instance
    {
        get
        {
            if (instance == null)
            {
                instance = FindAnyObjectByType<DialogueManager>(FindObjectsInactive.Include);
                if (instance == null)
                    Debug.LogError("No DialogueManager in the scene. Add the GameUI prefab (Assets/Prefabs/GameUI).");
            }
            return instance;
        }
    }

    [Header("UI (set up in the GameUI prefab)")]
    [SerializeField] GameObject panel;
    [SerializeField] Button panelButton;
    [SerializeField] TMP_Text speakerText;
    [SerializeField] TMP_Text bodyText;
    [SerializeField] TMP_Text hintText;
    [SerializeField] GameObject choiceContainer;
    [SerializeField] Button[] choiceButtons;

    [SerializeField] Color hintColor = new Color(1f, 1f, 1f, 0.6f);
    [SerializeField] Color wrongColor = new Color(1f, 0.7f, 0.3f);

    DialogueData current;
    int index;
    int startFrame;
    System.Action onEnd;

    // Question state
    readonly HashSet<int> wrongPicks = new();
    string praiseText;   // set after a correct answer; shown until the reader continues

    public bool IsActive => current != null;

    DialogueLine CurrentLine => current.lines[index];
    bool ShowingQuestion => praiseText == null && CurrentLine.IsQuestion;

    [Header("Juice")]
    [SerializeField] Color correctColor = new Color(0.5f, 1f, 0.55f);
    [SerializeField] Color incorrectColor = new Color(1f, 0.4f, 0.35f);

    PopIn panelPop;

    void Awake()
    {
        instance = this;
        panelPop = panel.GetComponent<PopIn>();
        panel.SetActive(false);
        panelButton.onClick.AddListener(OnPanelClicked);
        for (int i = 0; i < choiceButtons.Length; i++)
        {
            int choice = i;
            choiceButtons[i].onClick.AddListener(() => Pick(choice));
        }
    }

    public void StartDialogue(DialogueData data, System.Action onFinished)
    {
        if (data == null || data.lines == null || data.lines.Length == 0) return;
        current = data;
        index = 0;
        onEnd = onFinished;
        wrongPicks.Clear();
        praiseText = null;
        startFrame = Time.frameCount;   // ignore the key press that opened the conversation
        if (panelPop != null) panelPop.Show(); else panel.SetActive(true);
        Refresh(true);
    }

    void Update()
    {
        if (!IsActive || Time.frameCount == startFrame) return;

        var kb = Keyboard.current;
        if (kb == null) return;

        if (ShowingQuestion)
        {
            // Number keys pick an answer (1 = first choice).
            var choices = CurrentLine.choices;
            for (int i = 0; i < choices.Length && i < 9; i++)
                if (kb[Key.Digit1 + i].wasPressedThisFrame) Pick(i);
        }
        else if (kb.eKey.wasPressedThisFrame || kb.spaceKey.wasPressedThisFrame || kb.enterKey.wasPressedThisFrame)
        {
            Next();
        }
    }

    void OnPanelClicked()
    {
        if (IsActive && !ShowingQuestion) Next();
    }

    void Pick(int choice)
    {
        if (!IsActive || !ShowingQuestion || wrongPicks.Contains(choice)) return;

        var line = CurrentLine;
        var juice = choiceButtons[choice].GetComponent<JuiceButton>();
        if (choice == line.correctIndex)
        {
            // Right answer: green flash, a bump on the button and a little pulse through the whole panel.
            if (juice != null) { juice.Flash(correctColor); juice.Punch(10f); }
            if (panelPop != null) panelPop.Punch(0.04f);
            wrongPicks.Clear();
            if (!string.IsNullOrEmpty(line.correctText))
            {
                praiseText = line.correctText;   // shown next; reader taps to continue
                Refresh();
            }
            else
            {
                Next();
            }
        }
        else
        {
            // Wrong answer: red flash and a head-shake.
            if (juice != null) { juice.Flash(incorrectColor); juice.Shake(); }
            wrongPicks.Add(choice);
            Refresh();
        }
    }

    void Next()
    {
        praiseText = null;
        wrongPicks.Clear();
        index++;
        if (index >= current.lines.Length)
        {
            current = null;
            if (panelPop != null) panelPop.Hide(); else panel.SetActive(false);
            var cb = onEnd;
            onEnd = null;
            cb?.Invoke();
            return;
        }
        Refresh(true);
    }

    // Updates the panel to match the current line / question state.
    // newLine: true when a different line is appearing (answer buttons then pop in one after another).
    void Refresh(bool newLine = false)
    {
        var line = CurrentLine;
        bool question = ShowingQuestion;

        speakerText.text =  string.IsNullOrEmpty(line.speaker) ? "<sketchy>" + current.npcName : "<sketchy>" + line.speaker;
        bodyText.text = praiseText ?? line.text;

        // Any highlighted (red) words in what is now on screen go into the reader's glossary.
        WordGlossary.Instance?.CollectFrom(bodyText.text, speakerText.text);

        choiceContainer.SetActive(question);
        if (question)
        {
            for (int i = 0; i < choiceButtons.Length; i++)
            {
                bool used = i < line.choices.Length;
                choiceButtons[i].gameObject.SetActive(used);
                if (!used) continue;
                choiceButtons[i].interactable = !wrongPicks.Contains(i);
                choiceButtons[i].GetComponentInChildren<TMP_Text>().text = $"{i + 1}.  {line.choices[i]}";
                if (newLine) choiceButtons[i].GetComponent<JuiceButton>()?.Intro(0.15f + i * 0.07f);
            }

            bool wrong = wrongPicks.Count > 0;
            hintText.color = wrong ? wrongColor : hintColor;
            hintText.text = wrong
                ? (string.IsNullOrEmpty(line.hint) ? "Not quite. Try again!" : line.hint)
                : "Pick the answer you think is right";
        }
        else
        {
            bool last = praiseText == null && index >= current.lines.Length - 1;
            bool touch = Touchscreen.current != null && Keyboard.current == null;
            hintText.color = hintColor;
            hintText.text = $"{(touch ? "Tap" : "[E] / click")} to {(last ? "close" : "continue")}";
        }
    }
}
