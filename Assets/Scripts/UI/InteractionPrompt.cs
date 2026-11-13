using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;

/// <summary>
/// The "Talk [E]" button. NPCs report when the player is in range; this shows the button for the
/// nearest one, and starts that NPC's conversation on E or when the button is pressed.
/// </summary>
public class InteractionPrompt : MonoBehaviour
{
    static InteractionPrompt instance;

    public static InteractionPrompt Instance
    {
        get
        {
            if (instance == null) instance = FindAnyObjectByType<InteractionPrompt>(FindObjectsInactive.Include);
            return instance;
        }
    }

    [SerializeField] Button button;
    [SerializeField] TMP_Text label;

    readonly List<NPCInteractable> inRange = new();
    NPCInteractable target;

    void Awake()
    {
        instance = this;
        button.onClick.AddListener(Interact);
        button.gameObject.SetActive(false);
    }

    public void SetInRange(NPCInteractable npc, bool isInRange)
    {
        if (isInRange && !inRange.Contains(npc)) inRange.Add(npc);
        else if (!isInRange) inRange.Remove(npc);
    }

    void Update()
    {
        // Nearest NPC in range gets the prompt, so two NPCs standing close together can't both start talking.
        NPCInteractable nearest = null;
        float best = float.MaxValue;
        foreach (var npc in inRange)
        {
            float d = npc.DistanceToPlayer;
            if (d < best) { best = d; nearest = npc; }
        }

        if (nearest != target)
        {
            target = nearest;
            button.gameObject.SetActive(target != null);
            if (target != null)
            {
                bool touch = Touchscreen.current != null && Keyboard.current == null;
                label.text = touch ? "Talk" : "Talk  [E]";
            }
        }

        var kb = Keyboard.current;
        if (target != null && kb != null && kb.eKey.wasPressedThisFrame)
            Interact();
    }

    void Interact()
    {
        if (target != null) target.Interact();
    }
}
