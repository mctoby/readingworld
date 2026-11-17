using System.Collections;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Finishes the day: when the host's quest (the one that needs every other quest done, i.e. handing in to
/// Mr. Page) is completed, the day is saved as complete and the "Day complete" popup is shown.
/// The next time the game starts, <see cref="GameDay"/> moves on to the next day.
/// All of the popup's look lives under this object on the game's Canvas and can be restyled freely.
/// </summary>
public class DayProgress : MonoBehaviour
{
    [Header("Popup")]
    [Tooltip("The whole popup. Starts hidden.")]
    [SerializeField] GameObject popup;
    [SerializeField] TMP_Text titleText;
    [SerializeField] TMP_Text messageText;
    [SerializeField] Button closeButton;
    [Tooltip("Optional: goes back to the main menu.")]
    [SerializeField] Button menuButton;
    [SerializeField] string menuSceneName = "MainMenu";

    [Tooltip("{0} is the day number.")]
    [SerializeField] string titleFormat = "Day {0} complete!";
    [Tooltip("{0} is the day number.")]
    [TextArea(2, 4)]
    [SerializeField] string message = "Well done! You filled the library's shelves.\nCome back tomorrow for more stories.";

    [Tooltip("Pause after the conversation closes before the popup appears, in seconds.")]
    [SerializeField] float delay = 0.6f;

    bool open;

    void Awake()
    {
        if (popup != null) popup.SetActive(false);
        if (closeButton != null) closeButton.onClick.AddListener(Close);
        if (menuButton != null) menuButton.onClick.AddListener(GoToMenu);
    }

    /// <summary>Back to the main menu, which then offers the next day.</summary>
    public void GoToMenu()
    {
        if (open)
        {
            open = false;
            PlayerControlLock.Unlock();
        }
        GameDay.Forget();
        UnityEngine.SceneManagement.SceneManager.LoadScene(menuSceneName);
    }

    void OnEnable() => QuestManager.QuestCompleted += OnQuestCompleted;

    void OnDisable()
    {
        QuestManager.QuestCompleted -= OnQuestCompleted;
        if (open)
        {
            open = false;
            PlayerControlLock.Unlock();
        }
    }

    void OnQuestCompleted(QuestData quest)
    {
        // Only the host's quest is made of other quests, so this is the end of the day.
        if (quest == null || !quest.NeedsOtherQuests) return;

        int day = GameDay.Current;
        GameDay.MarkComplete(day);
        StartCoroutine(ShowAfterTalk(day));
    }

    IEnumerator ShowAfterTalk(int day)
    {
        yield return new WaitForSecondsRealtime(delay);
        while (DialogueManager.Instance != null && DialogueManager.Instance.IsActive) yield return null;

        if (titleText != null) titleText.text = string.Format(titleFormat, day);
        if (messageText != null) messageText.text = string.Format(message, day);

        if (popup != null)
        {
            var pop = popup.GetComponent<PopIn>();
            if (pop != null) pop.Show(); else popup.SetActive(true);
        }
        if (!open)
        {
            open = true;
            PlayerControlLock.Lock();   // free the mouse so the button can be pressed
        }
    }

    public void Close()
    {
        if (!open) return;
        open = false;
        if (popup != null)
        {
            var pop = popup.GetComponent<PopIn>();
            if (pop != null) pop.Hide(); else popup.SetActive(false);
        }
        PlayerControlLock.Unlock();
    }
}
