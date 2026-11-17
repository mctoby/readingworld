using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Start-of-game popup: shows which day is about to be played ("Day 2", plus its topic) and lets the player
/// step to another day with the arrow buttons before pressing Play. Appears once the age menu has closed.
/// All of its look lives under this object on the game's Canvas and can be restyled freely.
/// </summary>
public class DayStartPopup : MonoBehaviour
{
    [Header("Popup")]
    [Tooltip("The whole popup. Starts hidden.")]
    [SerializeField] GameObject popup;
    [SerializeField] TMP_Text titleText;
    [SerializeField] TMP_Text topicText;
    [SerializeField] Button prevButton;
    [SerializeField] Button nextButton;
    [SerializeField] Button playButton;

    [Header("Text")]
    [Tooltip("{0} is the day number.")]
    [SerializeField] string titleFormat = "Day {0}";
    [Tooltip("{0} is the day's topic.")]
    [SerializeField] string topicFormat = "Today's topic: {0}";
    [Tooltip("Shown as the topic of day 1 (the hand-written day).")]
    [SerializeField] string day1Topic = "The Library";

    [Header("Behaviour")]
    [Tooltip("Waits until this is hidden before appearing, e.g. the age menu's panel.")]
    [SerializeField] GameObject waitFor;
    [Tooltip("Only allow days up to the one the player has reached (no skipping ahead).")]
    [SerializeField] bool onlyReachedDays = false;
    [Tooltip("Show the popup even when there is only one day to play.")]
    [SerializeField] bool showWhenOnlyOneDay = true;

    readonly List<int> days = new();
    int index;
    bool open;

    void Awake()
    {
        if (popup != null) popup.SetActive(false);
        if (prevButton != null) prevButton.onClick.AddListener(() => Step(-1));
        if (nextButton != null) nextButton.onClick.AddListener(() => Step(1));
        if (playButton != null) playButton.onClick.AddListener(Play);
    }

    IEnumerator Start()
    {
        var content = DailyContent.Instance;
        days.AddRange(content != null ? content.PlayableDays() : new List<int> { 1 });

        int today = GameDay.Current;
        if (!days.Contains(today)) { days.Add(today); days.Sort(); }
        if (onlyReachedDays) days.RemoveAll(d => d > Mathf.Max(today, GameDay.Completed + 1));
        index = days.IndexOf(today);

        if (days.Count < 2 && !showWhenOnlyOneDay) yield break;

        // Let the age menu go first.
        yield return null;
        while (waitFor != null && waitFor.activeInHierarchy) yield return null;

        Refresh();
        if (popup != null)
        {
            var pop = popup.GetComponent<PopIn>();
            if (pop != null) pop.Show(); else popup.SetActive(true);
        }
        open = true;
        PlayerControlLock.Lock();
    }

    void Step(int dir)
    {
        index = Mathf.Clamp(index + dir, 0, days.Count - 1);
        Refresh();
        var pop = popup != null ? popup.GetComponent<PopIn>() : null;
        if (pop != null) pop.Punch(0.05f);
    }

    void Refresh()
    {
        int day = days[index];
        if (titleText != null) titleText.text = string.Format(titleFormat, day);

        string topic = day == 1 ? day1Topic : DailyContent.Instance?.TopicFor(day);
        if (topicText != null) topicText.text = string.IsNullOrEmpty(topic) ? "" : string.Format(topicFormat, topic);

        bool many = days.Count > 1;
        if (prevButton != null) { prevButton.gameObject.SetActive(many); prevButton.interactable = index > 0; }
        if (nextButton != null) { nextButton.gameObject.SetActive(many); nextButton.interactable = index < days.Count - 1; }
    }

    public void Play()
    {
        if (!open) return;
        open = false;
        GameDay.Choose(days[index]);

        if (popup != null)
        {
            var pop = popup.GetComponent<PopIn>();
            if (pop != null) pop.Hide(); else popup.SetActive(false);
        }
        PlayerControlLock.Unlock();
    }

    void OnDisable()
    {
        if (!open) return;
        open = false;
        PlayerControlLock.Unlock();
    }
}
