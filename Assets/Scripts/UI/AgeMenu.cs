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

    void Start()
    {
        for (int i = 0; i < ageButtons.Length; i++)
        {
            int age = minAge + i;
            var label = ageButtons[i].GetComponentInChildren<TMP_Text>();
            if (label != null) label.text = age.ToString();
            ageButtons[i].onClick.AddListener(() => Choose(age));
        }

        if (infoText != null) infoText.text = "";
        panel.SetActive(true);
        PlayerControlLock.Lock();
    }

    void Choose(int age)
    {
        ReadingSettings.Level = ReadingSettings.LevelForAge(age);
        Debug.Log($"Age {age} chosen: reading level {ReadingSettings.Level}");
        panel.SetActive(false);
        PlayerControlLock.Unlock();
    }
}
