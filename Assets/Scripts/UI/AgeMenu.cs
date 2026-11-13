using System.Collections;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Start-of-game menu: the player taps their age and <see cref="ReadingSettings.Level"/> is set to the matching
/// reading group. The player is frozen while the menu is open.
/// </summary>
public class AgeMenu : MonoBehaviour
{
    [SerializeField] GameObject panel;
    [Tooltip("One button per age, in order, starting at Min Age.")]
    [SerializeField] Button[] ageButtons;
    [SerializeField] int minAge = 5;
    [Tooltip("Optional: shows which reading group was chosen.")]
    [SerializeField] TMP_Text infoText;

    bool chosen;

    void Start()
    {
        for (int i = 0; i < ageButtons.Length; i++)
        {
            int age = minAge + i;
            var button = ageButtons[i];
            var label = button.GetComponentInChildren<TMP_Text>();
            if (label != null) label.text = age.ToString();
            button.onClick.AddListener(() => Choose(age, button));
        }

        if (infoText != null) infoText.text = "";
        panel.SetActive(true);
        PlayerControlLock.Lock();

        // Buttons pop in one after another, after the box has appeared.
        for (int i = 0; i < ageButtons.Length; i++)
            ageButtons[i].GetComponent<JuiceButton>()?.Intro(0.35f + i * 0.05f);
    }

    void Choose(int age, Button picked)
    {
        if (chosen) return;
        chosen = true;
        ReadingSettings.Level = ReadingSettings.LevelForAge(age);
        Debug.Log($"Age {age} chosen: reading level {ReadingSettings.Level}");
        StartCoroutine(Finish(picked));
    }

    // Let the tapped button celebrate for a moment, then close the menu and release the player.
    IEnumerator Finish(Button picked)
    {
        foreach (var b in ageButtons) if (b != picked) b.interactable = false;
        var juice = picked.GetComponent<JuiceButton>();
        if (juice != null) { juice.Flash(Color.white); juice.Punch(12f); }

        yield return new WaitForSecondsRealtime(0.35f);

        var pop = panel.GetComponent<PopIn>();
        if (pop != null) pop.Hide(); else panel.SetActive(false);
        PlayerControlLock.Unlock();
    }
}
