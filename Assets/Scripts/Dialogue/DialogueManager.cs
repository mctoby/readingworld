using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;

/// <summary>
/// Runs one conversation at a time and draws a simple dialogue box (IMGUI, no scene UI needed).
/// Advance with E / Space / Enter, or click / tap anywhere. Lines that are multiple-choice questions
/// show answer buttons (tap, click, or press 1-9) and only continue after the right answer.
/// Created automatically the first time an NPC needs it.
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
                instance = FindAnyObjectByType<DialogueManager>();
                if (instance == null)
                    instance = new GameObject("DialogueManager").AddComponent<DialogueManager>();
            }
            return instance;
        }
    }

    DialogueData current;
    int index;
    System.Action onEnd;
    GUIStyle boxStyle, nameStyle, textStyle, hintStyle, choiceStyle;

    // Question state
    readonly HashSet<int> wrongPicks = new();
    string praiseText;   // set after a correct answer; shown until the reader continues

    public bool IsActive => current != null;

    /// <summary>UI scale so text stays readable on phone-sized, high-res screens.</summary>
    public static float UIScale => Mathf.Max(1f, Screen.height / 720f);

    DialogueLine CurrentLine => current.lines[index];
    bool ShowingQuestion => praiseText == null && CurrentLine.IsQuestion;

    public void StartDialogue(DialogueData data, System.Action onFinished)
    {
        if (data == null || data.lines == null || data.lines.Length == 0) return;
        current = data;
        index = 0;
        onEnd = onFinished;
        ResetQuestionState();
    }

    void ResetQuestionState()
    {
        wrongPicks.Clear();
        praiseText = null;
    }

    void Update()
    {
        if (!IsActive) return;

        var kb = Keyboard.current;

        if (ShowingQuestion)
        {
            // Number keys pick an answer (1 = first choice).
            if (kb != null)
            {
                var choices = CurrentLine.choices;
                for (int i = 0; i < choices.Length && i < 9; i++)
                    if (kb[Key.Digit1 + i].wasPressedThisFrame) Pick(i);
            }
            return;
        }

        // Pointer covers both mouse and touchscreen taps.
        var pointer = Pointer.current;
        bool advance = (kb != null && (kb.eKey.wasPressedThisFrame || kb.spaceKey.wasPressedThisFrame || kb.enterKey.wasPressedThisFrame))
                       || (pointer != null && pointer.press.wasPressedThisFrame);
        if (advance) Next();
    }

    void Pick(int choice)
    {
        if (!ShowingQuestion || wrongPicks.Contains(choice)) return;

        var line = CurrentLine;
        if (choice == line.correctIndex)
        {
            wrongPicks.Clear();
            if (!string.IsNullOrEmpty(line.correctText))
                praiseText = line.correctText;   // shown next; reader taps to continue
            else
                Next();
        }
        else
        {
            wrongPicks.Add(choice);
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
            var cb = onEnd;
            onEnd = null;
            cb?.Invoke();
        }
    }

    void OnGUI()
    {
        if (!IsActive) return;
        BuildStyles();

        float s = UIScale;
        nameStyle.fontSize = Mathf.RoundToInt(22 * s);
        textStyle.fontSize = Mathf.RoundToInt(20 * s);
        hintStyle.fontSize = Mathf.RoundToInt(14 * s);
        choiceStyle.fontSize = Mathf.RoundToInt(20 * s);

        var line = CurrentLine;
        bool question = ShowingQuestion;
        string speaker = string.IsNullOrEmpty(line.speaker) ? current.npcName : line.speaker;
        string body = praiseText ?? line.text;

        float w = Screen.width * 0.8f;
        float h = question ? Screen.height * 0.55f : Screen.height * 0.3f;
        var rect = new Rect((Screen.width - w) / 2f, Screen.height - h - 20f * s, w, h);
        GUI.Box(rect, GUIContent.none, boxStyle);

        float pad = 20f * s;
        GUI.Label(new Rect(rect.x + pad, rect.y + 10f * s, rect.width - pad * 2, 32f * s), speaker, nameStyle);

        if (question)
        {
            float textH = 90f * s;
            GUI.Label(new Rect(rect.x + pad, rect.y + 48f * s, rect.width - pad * 2, textH), body, textStyle);

            float btnH = 46f * s, gap = 8f * s;
            float y = rect.y + 48f * s + textH + 4f * s;
            for (int i = 0; i < line.choices.Length; i++)
            {
                GUI.enabled = !wrongPicks.Contains(i);
                if (GUI.Button(new Rect(rect.x + pad, y, rect.width - pad * 2, btnH), $"{i + 1}.  {line.choices[i]}", choiceStyle))
                    Pick(i);
                y += btnH + gap;
            }
            GUI.enabled = true;

            if (wrongPicks.Count > 0)
            {
                string hint = string.IsNullOrEmpty(line.hint) ? "Not quite. Try again!" : line.hint;
                hintStyle.normal.textColor = new Color(1f, 0.7f, 0.3f);
                GUI.Label(new Rect(rect.x + pad, rect.yMax - 30f * s, rect.width - pad * 2, 24f * s), hint, hintStyle);
                hintStyle.normal.textColor = new Color(1f, 1f, 1f, 0.6f);
            }
        }
        else
        {
            GUI.Label(new Rect(rect.x + pad, rect.y + 48f * s, rect.width - pad * 2, rect.height - 84f * s), body, textStyle);

            bool last = praiseText == null && index >= current.lines.Length - 1;
            bool touch = Touchscreen.current != null && Keyboard.current == null;
            string key = touch ? "Tap" : "[E] / click";
            GUI.Label(new Rect(rect.x + pad, rect.yMax - 30f * s, rect.width - pad * 2, 24f * s),
                $"{key} to {(last ? "close" : "continue")}", hintStyle);
        }
    }

    void BuildStyles()
    {
        if (boxStyle != null) return;
        var tex = new Texture2D(1, 1);
        tex.SetPixel(0, 0, new Color(0f, 0f, 0f, 0.8f));
        tex.Apply();
        boxStyle = new GUIStyle(GUI.skin.box) { normal = { background = tex } };
        nameStyle = new GUIStyle(GUI.skin.label) { fontStyle = FontStyle.Bold, normal = { textColor = new Color(1f, 0.85f, 0.4f) } };
        textStyle = new GUIStyle(GUI.skin.label) { wordWrap = true, richText = true, normal = { textColor = Color.white } };
        hintStyle = new GUIStyle(GUI.skin.label) { alignment = TextAnchor.MiddleRight, normal = { textColor = new Color(1f, 1f, 1f, 0.6f) } };
        choiceStyle = new GUIStyle(GUI.skin.button) { alignment = TextAnchor.MiddleLeft, richText = true };
    }
}
